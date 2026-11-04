// Shareable URL: a registry of {read(params), write(params)} entries. The core registers store, var/hidden, dims, style
// and view (lon, x, y, z); components register their own with app.url.register. Ported from the reference: dimToParam,
// dimFromParam, styleParams, applyUrlState, syncUrl. URL values win over remembered (localStorage) ones, so a shared
// link reproduces the view.

const dimToParam = (d, i, dims) => {
  const iso = dims[d].iso;
  return iso && iso[i] ? iso[i].replace(/T00:00:00(\.0+)?Z$/, '') : String(i);
};
function dimFromParam(d, raw, dims) {
  const {iso, size} = dims[d];
  if (iso && /^\d{4}-/.test(raw)) {  // a date prefix; a bare number is an index (the reference matched it as a prefix too)
    const i = iso.findIndex((t) => t && t.startsWith(raw));
    if (i >= 0) return i;
  }
  const i = Number(raw);
  return Number.isInteger(i) && i >= 0 && i < size ? i : null;
}

// Style/opacity parameters: plain names for one selected variable, `<param>.<var>` for several.
// getStyle(name) -> style, opacityOf(name) -> number. Returns [[key, value], ...].
function styleParamsOf(vars, getStyle, opacityOf) {
  const multi = vars.length > 1, out = [];
  for (const v of vars) {
    const key = (k) => (multi ? `${k}.${v.name}` : k);
    if (!v.categorical) {
      const st = getStyle(v.name);
      out.push([key('cmap'), st.cmap]);
      if (st.reversed) out.push([key('rev'), '1']);
      if (st.log) out.push([key('log'), '1']);
      out.push([key('vmin'), String(+Number(st.vmin).toPrecision(6))]);
      out.push([key('vmax'), String(+Number(st.vmax).toPrecision(6))]);
    }
    if (opacityOf(v.name) !== 1) out.push([key('opacity'), String(opacityOf(v.name))]);
  }
  return out;
}

// On load a plain parameter applies to the first selected variable (idx 0), `<param>.<var>` to the named one.
// base: the variable's current style. Returns {style: full style or null when the URL changes nothing valid,
// explicit: whether the range/colourmap came from the URL (D-53), opacity: number or null}.
function readStyleParams(params, name, idx, base, cmaps) {
  const get = (k) => (params.has(`${k}.${name}`) ? params.get(`${k}.${name}`) : (idx === 0 && params.has(k) ? params.get(k) : null));
  const op = get('opacity');
  const opacity = op !== null && op !== '' && Number(op) >= 0 && Number(op) <= 1 ? Number(op) : null;
  const st = {...base};
  let changed = false;
  const cm = get('cmap');
  if (cm && cmaps[cm]) { st.cmap = cm; st.reversed = false; changed = true; }  // the URL always writes `rev` when set, so absent = off
  const rv = get('rev');
  if (rv !== null) { st.reversed = rv === '1'; changed = true; }
  const lg = get('log');
  if (lg !== null) { st.log = lg === '1'; changed = true; }
  const lo = get('vmin'), hi = get('vmax');
  if (lo !== null && lo !== '' && Number.isFinite(Number(lo))) { st.vmin = Number(lo); changed = true; }
  if (hi !== null && hi !== '' && Number.isFinite(Number(hi))) { st.vmax = Number(hi); changed = true; }
  if (!changed || !(st.vmin < st.vmax)) return {style: null, explicit: false, opacity};
  const explicit = ['cmap', 'rev', 'vmin', 'vmax'].some((k) => get(k) !== null && get(k) !== '');
  return {style: st, explicit, opacity};
}

// "/path?store=s3://b/x&var=a,b": URLSearchParams escapes / : , which are harmless and unreadable in a query.
const urlString = (pathname, q) =>
  `${pathname}?${q.toString().replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')}`;

// app.url: register(key, {read(params), write(params)}), read() (once, after the config loaded), sync() (debounced).
function createUrl(app) {
  const entries = [];
  let timer = null;
  return {
    register(key, entry) { entries.push([key, entry]); },
    read(params = app.params) {
      for (const [key, e] of entries) {
        try { e.read?.(params); } catch (err) { console.error(`url "${key}" read failed`, err); }
      }
    },
    sync() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = new URLSearchParams();
        for (const [key, e] of entries) {
          try { e.write?.(q); } catch (err) { console.error(`url "${key}" write failed`, err); }
        }
        try { history.replaceState(null, '', urlString(location.pathname, q)); } catch (_) { /* sandboxed frame */ }
      }, 150);
    },
  };
}

// The core's own URL entries: store, selection (var, hidden), dims, style (+ opacity), view (lon, x, y, z).
function registerCoreUrl(app) {
  const {state} = app;
  app.url.register('store', {
    write(q) {
      const cfg = app.cfg;
      if (app.blank) { if (app.spec.store) q.set('store', ''); return; }  // `?store=` keeps a page with a default store blank
      q.set('store', cfg.source);
      if (cfg.endpoint && /^s3:\/\//i.test(cfg.source)) q.set('endpoint', cfg.endpoint);
    },
  });
  app.url.register('selection', {
    read(p) {
      if (app.blank) return;
      const names = [];
      for (const n of (p.get('var') || '').split(',')) if (app.varOf(n) && !names.includes(n)) names.push(n);
      if (names.length || p.get('var') === '') state.selected = names;
      for (const name of (p.get('hidden') || '').split(',')) if (state.selected.includes(name)) state.hidden.add(name);
    },
    write(q) {
      if (app.blank) return;
      q.set('var', state.selected.join(','));
      const hidden = state.selected.filter((n) => state.hidden.has(n));
      if (hidden.length) q.set('hidden', hidden.join(','));
    },
  });
  app.url.register('dims', {
    read(p) {
      if (app.blank) return;
      for (const d of Object.keys(app.cfg.dims)) {
        const raw = p.get(d);
        if (raw === null) continue;
        const i = dimFromParam(d, raw, app.cfg.dims);
        if (i !== null) state.dims[d] = i;
      }
    },
    write(q) {
      if (app.blank) return;
      for (const d of app.layers.unionDims()) q.set(d, dimToParam(d, state.dims[d] || 0, app.cfg.dims));
    },
  });
  app.url.register('style', {
    read(p) {
      if (app.blank) return;
      state.selected.forEach((name, idx) => {
        const v = app.varOf(name);
        const r = readStyleParams(p, name, idx, app.style.get(name) || {}, app.style.cmaps);
        if (r.opacity !== null) state.opacity[name] = r.opacity;
        if (!v.categorical && r.style) app.style.set(name, r.style, {explicit: r.explicit, persist: false});
      });
    },
    write(q) {
      if (app.blank) return;
      const vars = state.selected.map((n) => app.varOf(n));
      for (const [k, val] of styleParamsOf(vars, (n) => app.style.get(n), (n) => app.layers.opacityOf(n))) q.set(k, val);
    },
  });
  app.url.register('view', {
    write(q) {
      if (app.cfg.global) q.set('lon', String(state.centerLon));
      const view = state.map && state.map.getView();
      const c = view && view.getCenter && view.getCenter();
      if (c && Number.isFinite(view.getZoom())) {
        q.set('x', c[0].toPrecision(6)); q.set('y', c[1].toPrecision(6));
        q.set('z', view.getZoom().toFixed(2));
      }
    },
  });
}
