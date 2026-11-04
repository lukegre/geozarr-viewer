// Map and data layers. Ported from the reference: normLon, shiftGrid, makeLayers (world copies, D-26), viewFor, makeLayer,
// addVariable/removeVariable/restackLayers, toggleVar/toggleVisibility/moveVariable, setDim, autoOnAdd (D-53),
// initCenterLon, initBasemap (layers only; the selector is the basemap component). The sidebar/card DOM is not here.

const normLon = (x) => { const l = ((x + 180) % 360 + 360) % 360 - 180; return Number.isFinite(l) ? l : 0; };

// Global data (any centre longitude, 0 included): two extra copies of the data layer, shifted by
// ±360° (their tile grids are offset, so chunk indices are unchanged). Not wrapX (see D-24, D-26).
function shiftGrid(grid, dx) {
  const e = grid.getExtent();
  return new WMTSTileGrid({
    extent: [e[0] + dx, e[1], e[2] + dx, e[3]],
    origins: grid.getResolutions().map((_, z) => { const o = grid.getOrigin(z); return [o[0] + dx, o[1]]; }),
    resolutions: grid.getResolutions(),
    matrixIds: grid.getMatrixIds(),
    tileSizes: grid.getResolutions().map((_, z) => grid.getTileSize(z)),
  });
}

// View options for the map: global data is bounded to one world centred on `lon`; x, y, z in the URL pin the view.
function viewOptions(opts, cfg, lon, params) {
  const x = Number(params.get('x')), y = Number(params.get('y')), z = Number(params.get('z'));
  const pinned = params.has('z') && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  const b = cfg.bbox;
  if (cfg.global) {
    opts = {...opts, center: [lon, (b[1] + b[3]) / 2], extent: [lon - 180, b[1], lon + 180, b[3]]};
  }
  return pinned ? {...opts, center: [x, y], zoom: z} : opts;
}

const BASEMAPS = [['light', 'Light'], ['dark', 'Dark'], ['osm', 'OSM'], ['none', 'None']];

function createLayers(app) {
  const {state, bus} = app;
  const vlayers = new globalThis.Map();  // name -> {layers, sources}; only selected, visible variables (hidden ones load nothing, D-52)
  const autoPending = new Set();
  const varOf = (name) => app.varOf(name);
  const selVars = () => state.selected.map(varOf);
  const opacityOf = (name) => (state.opacity[name] === undefined ? 1 : state.opacity[name]);
  const unionDims = () => {  // extra dims of the selected variables: selection order, then each variable's dim order
    const out = [];
    for (const v of selVars()) for (const d of v.dims) if (!out.includes(d)) out.push(d);
    return out;
  };

  // One keyless source (OSM); Light/Dark are CSS filters on each layer's own canvas (theme.css).
  const basemaps = {};
  for (const id of ['light', 'dark', 'osm']) basemaps[id] = new TileLayer({className: `bm-${id}`, source: new OSM(), visible: false});

  function makeLayer(v) {
    const cfg = app.cfg;
    const dimensions = {};
    for (const n of v.dims) dimensions[n] = clamp(state.dims[n] || 0, 0, cfg.dims[n].size - 1);
    const opts = {url: new URL(cfg.store_url, location.href).href, bands: [v.name], transition: 0};
    if (cfg.crs.projection) opts.projection = cfg.crs.projection;
    if (v.dims.length) opts.dimensions = dimensions;
    const source = new GeoZarr(opts);
    source.addEventListener?.('error', (e) => bus.emit('error', e));
    return {source, layer: new WebGLTileLayer({source, style: {color: app.style.colorExpr(v.name)}, opacity: opacityOf(v.name)})};
  }

  function makeLayers(v) {
    const offsets = app.cfg.global ? [0, -360, 360] : [0];
    const made = offsets.map((dx) => {
      const m = makeLayer(v);
      if (dx) {
        const shift = () => {
          if (m.source.getState() !== 'ready' || m.source.gpmShifted) return;
          m.source.tileGrid = shiftGrid(m.source.tileGrid, dx);
          m.source.gpmShifted = true;
        };
        m.source.on('change', shift);
        shift();
      }
      return m;
    });
    return {sources: made.map((m) => m.source), layers: made.map((m) => m.layer)};
  }

  // Auto range on add (D-53): once the map has rendered the new layer, run Auto, unless the range was set
  // explicitly (stored, URL, attrs, edited) or the variable is categorical. An empty render (no tiles in view yet) is
  // retried on the next two; a variable removed, hidden or edited meanwhile is skipped.
  function autoOnAdd(name) {
    const v = varOf(name);
    if (v.categorical || v.limits_from_attrs || app.style.isExplicit(name) || autoPending.has(name)) return;
    autoPending.add(name);
    const attempt = (left) => state.map.once('rendercomplete', () => {
      const live = state.selected.includes(name) && !state.hidden.has(name) && !app.style.isExplicit(name);
      if (live && !app.frame.autoStyle(name, {auto: true}) && left > 1) return attempt(left - 1);
      autoPending.delete(name);
    });
    attempt(3);
  }

  // Add or remove one variable's layer group; other variables' layers are left untouched.
  // A hidden variable gets no layers; the caller restacks after adding.
  function addVariable(name) {
    if (state.hidden.has(name)) return;
    vlayers.set(name, makeLayers(varOf(name)));
    autoOnAdd(name);  // runs once the caller's restack has put the layers on the map and they rendered
  }
  function removeVariable(name) {
    const vl = vlayers.get(name);
    if (!vl) return;
    for (const l of vl.layers) { state.map.getLayers().remove(l); l.dispose?.(); }
    vlayers.delete(name);
  }
  // Put the existing layers on the map in stacking order (hidden variables have none).
  function restack() {
    const layers = state.map.getLayers();
    for (const n of state.selected) for (const layer of vlayers.get(n)?.layers || []) layers.remove(layer);
    for (const n of state.selected) for (const layer of vlayers.get(n)?.layers || []) layers.push(layer);
  }

  // reference moveVariable: put `name` in the selection (before = the variable it goes in front of in the top-first
  // list; null = bottom) or take it out.
  function moveVariable(name, selected, before = null) {
    const i = state.selected.indexOf(name);
    if (!selected && i < 0) return;
    if (selected && before === name) return;
    if (i >= 0) state.selected.splice(i, 1);
    if (selected) {
      // top-first for the UI, state.selected is bottom-first for the map
      const order = [...state.selected].reverse();
      const index = before === null ? order.length : order.indexOf(before);
      order.splice(index < 0 ? order.length : index, 0, name);
      state.selected = order.reverse();
      if (i < 0) addVariable(name);
      restack();  // reuses existing layers (and their sources/styles) in the new stacking order
    } else {
      state.hidden.delete(name);
      removeVariable(name);
    }
    app.url.sync();
    bus.emit('selection:changed', [...state.selected]);
  }

  const layers = {
    basemaps: BASEMAPS,
    unionDims, opacityOf,
    group: (name) => vlayers.get(name),
    // Add a variable to the map. `before`: the selected variable it goes in front of (top-first list); default: on top.
    // Selecting an already selected variable without `before` does nothing.
    select(name, before) {
      if (!varOf(name)) return;
      if (state.selected.includes(name) && before === undefined) return;
      moveVariable(name, true, before === undefined ? (state.selected.filter((n) => n !== name).at(-1) || null) : before);
    },
    deselect: (name) => moveVariable(name, false),
    // reorder a selected variable (same `before` rule as select)
    move(name, before = null) { if (state.selected.includes(name)) moveVariable(name, true, before); },
    setVisible(name, on) {
      if (!state.selected.includes(name) || state.hidden.has(name) === !on) return;
      if (on) { state.hidden.delete(name); addVariable(name); restack(); }
      else { state.hidden.add(name); removeVariable(name); }
      bus.emit('visibility:changed', name);
      app.url.sync();
    },
    setDim(name, i) {
      state.dims[name] = i;
      app.url.sync();
      for (const [vn, vl] of vlayers) {
        if (!varOf(vn).dims.includes(name)) continue;
        for (const src of vl.sources) src.updateDimensions({[name]: i});
      }
      bus.emit('dims:changed', {dim: name, index: i});
    },
    setOpacity(name, x) {
      const v = clamp(Number(x), 0, 1);
      if (!Number.isFinite(v)) return;
      state.opacity[name] = v;
      for (const l of vlayers.get(name)?.layers || []) l.setOpacity(v);
      app.url.sync();
      bus.emit('opacity:changed', name);
    },
    setBasemap(id) {
      if (!BASEMAPS.some(([k]) => k === id)) return;
      state.basemap = id;
      for (const [k, l] of Object.entries(basemaps)) l.setVisible(k === id);
      bus.emit('basemap:changed', id);
    },
    // Rebuilding the view in place is unreliable (a blank map), so reload with the new centre.
    setCenterLon(lon) {
      lon = normLon(+lon);
      if (!app.cfg.global || lon === state.centerLon) return;
      app.storage.set(`centerlon:${app.cfg.title}`, String(lon));
      bus.emit('centerlon:changed', lon);
      const url = new URL(location.href);
      url.searchParams.set('lon', String(lon));
      for (const k of ['x', 'y', 'z']) url.searchParams.delete(k);
      location.replace(url.href);
    },
    // Called once by the app after the config loaded and the URL was read: register the CRS, create the visible
    // variables' layers and the map.
    start() {
      const cfg = app.cfg;
      state.centerLon = cfg.global
        ? normLon(+(app.params.get('lon') ?? app.storage.get(`centerlon:${cfg.title}`) ?? 0)) : 0;
      // The CRS has to be registered before the GeoZarr source resolves it.
      if (cfg.crs.proj4) { proj4.defs(cfg.crs.name, cfg.crs.proj4); register(proj4); }
      layers.setBasemap(state.basemap);
      for (const name of state.selected) if (!state.hidden.has(name)) vlayers.set(name, makeLayers(varOf(name)));
      const dataLayers = state.selected.flatMap((n) => vlayers.get(n)?.layers || []);
      const lon = state.centerLon;
      let view;
      if (app.blank) {
        const b = cfg.bbox;
        const opts = viewOptions({projection: cfg.crs.code, center: [lon, 0], zoom: 2, showFullExtent: true,
          extent: [lon - 180, b[1], lon + 180, b[3]]}, cfg, lon, app.params);
        // A Promise<ViewOptions>: a View built here fails Map's instanceof check (separate +esm bundles).
        view = Promise.resolve(opts);
      } else {
        // With no visible layer, a temporary source supplies the view; it is disposed and never added to the map.
        const detached = !vlayers.size;
        const initial = vlayers.values().next().value || makeLayers(varOf(state.selected[0]) || cfg.variables[0]);
        view = getView(initial.sources[0], withLowerResolutions(1), withHigherResolutions(2), withExtentCenter(), withZoom(2))
          .then((o) => viewOptions(o, cfg, lon, app.params))
          .finally(() => { if (detached) for (const l of initial.layers) l.dispose?.(); });
        view.catch((e) => bus.emit('error', e));
      }
      state.map = new Map({target: app.mapEl, layers: [...Object.values(basemaps), ...dataLayers], view});
      state.map.on('moveend', app.url.sync);
      state.map.on('rendercomplete', () => { for (const n of vlayers.keys()) bus.emit('layer:rendered', n); });
      bus.on('style:changed', (name) => {
        for (const l of vlayers.get(name)?.layers || []) l.setStyle({color: app.style.colorExpr(name)});
      });
      for (const name of state.selected) if (vlayers.has(name)) autoOnAdd(name);  // visible variables only (D-53)
      bus.emit('map:ready', state.map);
    },
  };

  // lon/lat helpers for readouts: coordinates are in the view projection and, for global data, may sit on a world copy.
  app.geo = {
    // [lon, lat] (lon in [-180, 180)) of a view coordinate, or null when it cannot be transformed
    lonLat(coord) {
      const [x, y] = coord;
      const [lon, lat] = toLonLat([app.cfg.global ? normLon(x) : x, y], state.map.getView().getProjection());
      return Number.isFinite(lon) && Number.isFinite(lat) ? [normLon(lon), lat] : null;
    },
    // whether a view coordinate is inside the data extent
    inExtent(coord) {
      let [x, y] = coord;
      const b = app.cfg.bbox;
      if (app.cfg.global) x = normLon(x);  // map shows +-360 copies of the world
      return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
    },
  };
  return layers;
}
