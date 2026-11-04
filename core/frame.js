// Data of the current frame (loaded tiles of the current dimension slice): Auto and Min/Max ranges, pixel sampling.
// Ported from the reference: frameTiles, scanTile, frameValues, frameExtent, minMaxRange, symmetricCmap, autoRange,
// sampleLayer. The pure functions take a variable's layer group `vl` = {layers, sources} (see layers.js).
const AUTO_MAX = 200000;  // values collected for Auto at most

// Loaded tiles of the variable's current dimension slice (D-48), as [{tile, g}] with g the gutter. Same tile
// cache as sampleLayer (no store I/O): only tiles whose `key` is the source's current key (D-41) and only the
// highest loaded zoom among them, every world copy included. Shared by frameValues (Auto) and frameExtent (Min/Max).
function frameTiles(vl) {
  const tiles = [];
  let z = -1;
  if (vl) vl.layers.forEach((layer, i) => {
    const cache = layer.getRenderer?.()?.tileRepresentationCache;
    if (!cache) return;
    const key = vl.sources[i].getKey();
    cache.forEach((rep) => {
      const tile = rep && rep.loaded && rep.tile;
      if (!tile || tile.key !== key || tile.getState() !== 2) return;  // 2 = TileState.LOADED
      const tz = tile.tileCoord[0];
      if (tz > z) { z = tz; tiles.length = 0; }
      if (tz === z) tiles.push({tile, g: rep.gutter || 0});
    });
  });
  return tiles;
}

// Calls fn(value) for the band-0 value of every `step`-th pixel (rows and columns) of one tile. Gutter and alpha as
// in sampleLayer (last band when there are several, 0 = nodata); non-finite values are skipped.
function scanTile({tile, g}, step, fn) {
  const data = tile.getData();
  const [w, h] = tile.getSize();
  if (!data || !data.length) return;
  const bands = Math.max(1, Math.round(data.length / ((w + 2 * g) * (h + 2 * g))));
  for (let row = 0; row < h; row += step) {
    for (let col = 0; col < w; col += step) {
      const px = ((row + g) * (w + 2 * g) + col + g) * bands;
      if (bands > 1 && !data[px + bands - 1]) continue;
      const val = data[px];
      if (Number.isFinite(val)) fn(val);
    }
  }
}

// Band-0 values of the loaded tiles of the current slice (frameTiles), for the Auto range. A common 2-D stride keeps
// at most ~AUTO_MAX values. Returns a Float64Array (empty when nothing is loaded).
function frameValues(vl) {
  const tiles = frameTiles(vl);
  let total = 0;
  for (const t of tiles) { const [w, h] = t.tile.getSize(); total += w * h; }
  const step = Math.max(1, Math.ceil(Math.sqrt(total / AUTO_MAX)));
  const out = new Float64Array(tiles.reduce((n, t) => {
    const [w, h] = t.tile.getSize();
    return n + Math.ceil(w / step) * Math.ceil(h / step);
  }, 0));
  let n = 0;
  for (const t of tiles) scanTile(t, step, (val) => { out[n++] = val; });
  return out.subarray(0, n);
}

// {min, max} of every pixel of the loaded tiles of the current slice (D-51), or null without finite values (with
// `positive`, without values > 0: the log scale of D-54 needs a positive range).
// Streams over the tiles with stride 1 (no subsampling, no copy), so the true extremes are found.
function frameExtent(vl, positive) {
  let min = Infinity, max = -Infinity;
  for (const t of frameTiles(vl)) {
    scanTile(t, 1, (val) => {
      if (positive && !(val > 0)) return;
      if (val < min) min = val;
      if (val > max) max = val;
    });
  }
  return min <= max ? {min, max} : null;
}

// {vmin, vmax} for the Min/Max button (D-51); vmax = vmin + 1 when the data is constant; null without finite limits.
function minMaxRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {vmin: min, vmax: max > min ? max : min + 1};
}

// Colourmap for a symmetric Auto range (D-49): a diverging map (any group labelled "... Diverging", so matplotlib,
// cmocean and cmasher) is kept with its Reversed state, every other map becomes RdBu reversed (red = high).
function symmetricCmap(cmap, reversed, groups) {
  const diverging = groups.some((g) => /Diverging$/.test(g.label) && g.names.includes(cmap));
  return diverging ? {cmap, reversed} : {cmap: 'RdBu', reversed: true};
}

// {vmin, vmax} from the 2nd and 98th percentiles (linear interpolation, as the default limits, D-43), or null
// without finite values. Mirrored to [-m, m] when lo < 0 < hi and the smaller magnitude is at least half the
// larger (`symmetric: true`); vmax = vmin + 1 when the range is empty. With `positive` (log scale, D-54) only
// values > 0 count, so the range stays positive.
function autoRange(values, positive) {
  const v = Float64Array.from(Array.from(values).filter((x) => Number.isFinite(x) && (!positive || x > 0))).sort();
  if (!v.length) return null;
  const pct = (p) => {
    const x = p * (v.length - 1), i = Math.floor(x);
    return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * (x - i) : v[i];
  };
  let lo = pct(0.02), hi = pct(0.98);
  const a = Math.abs(lo), b = Math.abs(hi);
  const symmetric = lo < 0 && hi > 0 && Math.min(a, b) / Math.max(a, b) >= 0.5;
  if (symmetric) { hi = Math.max(a, b); lo = -hi; }
  if (!(hi > lo)) hi = lo + 1;
  return {vmin: lo, vmax: hi, symmetric};
}

// Raw band-0 value under `coordinate`, read from the layer renderer's loaded-tile cache (null if none/NaN).
// WebGLTileLayer.getData is not usable: with the jsdelivr +esm bundles the GeoZarr source's DataTile
// is not the DataTile class WebGLTile checks with instanceof, and the source itself caches no tiles.
// Edge tiles are smaller than the grid tile size, so pixels are addressed by resolution, not extent.
// The renderer keeps tiles of earlier dimension slices (the source key changes with `dimensions`), so only
// tiles whose `key` is the source's current key are used; until those are loaded there is no value (D-41).
function sampleLayer(layer, source, coordinate) {
  const cache = layer.getRenderer?.()?.tileRepresentationCache;
  const grid = source.getTileGrid();
  if (!cache || !grid) return null;
  const [cx, cy] = coordinate;
  let best = null;
  cache.forEach((rep) => {
    const tile = rep && rep.loaded && rep.tile;
    if (!tile || tile.key !== source.getKey() || tile.getState() !== 2) return;  // 2 = TileState.LOADED
    const tc = tile.tileCoord;
    if (best && best.z >= tc[0]) return;
    const ext = grid.getTileCoordExtent(tc);
    const res = grid.getResolution(tc[0]);
    const col = Math.floor((cx - ext[0]) / res), row = Math.floor((ext[3] - cy) / res);
    const [w, h] = tile.getSize();
    if (col < 0 || row < 0 || col >= w || row >= h) return;
    best = {z: tc[0], tile, col, row, g: rep.gutter || 0, w, h};
  });
  if (!best) return null;
  const {tile, col, row, g, w, h} = best;
  const data = tile.getData();
  if (!data || !data.length) return null;
  const bands = Math.max(1, Math.round(data.length / ((w + 2 * g) * (h + 2 * g))));
  const px = ((row + g) * (w + 2 * g) + col + g) * bands;
  if (bands > 1 && !data[px + bands - 1]) return null;  // last band is alpha; 0 = nodata
  const val = data[px];
  return Number.isFinite(val) ? val : null;
}

// app.frame: the helpers above bound to the app's layers and styles.
function createFrame(app) {
  const group = (name) => app.layers.group(name);
  const frame = {
    // band-0 values of the current frame (Float64Array, subsampled to ~AUTO_MAX)
    values: (name) => frameValues(group(name)),
    // {min, max} of the current frame or null; `positive` for log scales
    extent: (name, positive) => frameExtent(group(name), positive),
    // Value of every visible variable under a view-projection coordinate, top-most first: [{name, value}].
    // Global data has three world copies (0, -360, +360); the first finite value wins.
    sample(coordinate) {
      const out = [];
      for (const name of [...app.state.selected].reverse()) {
        const vl = group(name);
        if (!vl || app.state.hidden.has(name)) continue;
        let value = null;
        for (let i = 0; i < vl.layers.length; i++) {
          try { value = sampleLayer(vl.layers[i], vl.sources[i], coordinate); } catch (_) { value = null; }  // not rendered yet
          if (value !== null) break;
        }
        if (value !== null) out.push({name, value});
      }
      return out;
    },
    // Auto range for the variable's current frame, applied through app.style (D-48/D-49): 2-98 % percentiles, and a
    // diverging colourmap when the signs balance. `auto: true` is the automatic run after a layer is added (D-53),
    // which neither stores nor marks the range as explicit. Returns false (style kept) when no data is loaded.
    autoStyle(name, {auto = false} = {}) {
      const st = app.style.get(name);
      const r = st && autoRange(frame.values(name), !!st.log);
      if (!r) return false;
      const patch = {vmin: r.vmin, vmax: r.vmax};
      if (r.symmetric) Object.assign(patch, symmetricCmap(st.cmap, st.reversed, app.style.groups));
      return app.style.set(name, patch, {explicit: !auto, persist: !auto});
    },
    // Min/Max of the current frame (D-51); the colourmap is untouched. Returns false without loaded data.
    minMaxStyle(name) {
      const st = app.style.get(name);
      const e = st && frame.extent(name, !!st.log);
      const r = e && minMaxRange(e.min, e.max);
      return !!r && app.style.set(name, r);
    },
  };
  return frame;
}
