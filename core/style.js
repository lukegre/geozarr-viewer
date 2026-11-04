// Colourmaps, per-variable style state, colour expressions, ticks. Ported from the reference: cmaps/cmapGroups,
// resolveCmap, defaultStyle, loadStyle, styleOf, stopsOf, effectiveLog, gradientCss, niceTicks, niceLogTicks, colorExpr.
// Data (COLORMAPS, COLORMAP_GROUPS, RAMP) lives in colormaps.js. The pure functions come first; createStyle builds app.style.

const rgba = (c) => [c[0], c[1], c[2], 1];
const cmapLabel = (name) => name.replace(/^cm[or]\./, '');

// D-43: the variable's cmap (from the attrs): an exact key, else "<key>_r" = the key reversed, else viridis.
function resolveCmap(v, cmaps) {
  const name = v.cmap;
  if (name == null) return {cmap: 'viridis', reversed: !!v.reversed};
  if (cmaps[name]) return {cmap: name, reversed: !!v.reversed};
  if (/_r$/.test(name) && cmaps[name.slice(0, -2)]) return {cmap: name.slice(0, -2), reversed: !v.reversed};
  console.warn(`${v.name}: unknown cmap ${JSON.stringify(name)}, using viridis`);
  return {cmap: 'viridis', reversed: !!v.reversed};
}
const defaultStyle = (v, cmaps) => ({...resolveCmap(v, cmaps), vmin: v.vmin, vmax: v.vmax});
const stopsOf = (st, cmaps, ramp) => { const s = cmaps[st.cmap] || ramp; return st.reversed ? [...s].reverse() : s; };
// D-54: the log scale needs a positive Min; the stored flag is kept while it is not.
const effectiveLog = (st) => !!st.log && st.vmin > 0;
const gradientCss = (stops) => 'linear-gradient(to right,' +
  stops.map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${100 * i / (stops.length - 1)}%`).join(',') + ')';

// Groups to list in a picker: a group whose source is switched off still lists the current map (D-42), so a select
// never loses its value. show: {core, cmocean, cmasher} -> boolean. Returns [{label, names}].
function listedGroups(groups, show, current) {
  const out = [];
  for (const g of groups) {
    const names = show[g.source] ? g.names : g.names.filter((n) => n === current);
    if (names.length) out.push({label: g.label, source: g.source, names});
  }
  return out;
}

// Mirrors preview._nice_ticks (Python); keep the two in sync. Shared cases:
//   (0, 1) -> 0,.2,.4,.6,.8,1    (280, 470) -> 300,350,400,450    (-3.3, 31.7) -> 0,10,20,30
//   (0.0013, 0.0021) -> .0014,.0016,.0018,.002    (1e6, 9.3e6) -> 2e6,4e6,6e6,8e6
//   (5, 5.5) -> 5,5.1,...,5.5    (2, 3) -> 2,2.2,...,3
function niceTicks(vmin, vmax) {
  const clean = (x) => +Number(x).toPrecision(10);
  const span = vmax - vmin;
  if (!(span > 0 && Number.isFinite(span))) return [clean(vmin)];
  const base = Math.floor(Math.log10(span));
  let best = null;
  for (let exp = base - 2; exp < base + 2; exp++) {
    for (const mant of [1, 2, 5]) {
      const step = mant * 10 ** exp;
      const k0 = Math.ceil(vmin / step - 1e-9), k1 = Math.floor(vmax / step + 1e-9);
      const n = k1 - k0 + 1;
      if (n < 4 || n > 6) continue;
      const score = Math.abs(n - 5) - step * 1e-12 / span;
      if (!best || score < best.score) {
        best = {score, ticks: Array.from({length: n}, (_, i) => clean((k0 + i) * step))};
      }
    }
  }
  return best ? best.ticks : Array.from({length: 5}, (_, i) => clean(vmin + span * i / 4));
}

// Ticks of a log scale: 1-2-5 x 10^k inside [vmin, vmax], only 1 x 10^k when that gives more than 6, vmin and vmax
// when fewer than 2 fit. Shared cases: (1, 10) -> 1,2,5,10    (3, 80) -> 5,10,20,50    (1, 1000) -> 1,10,100,1000
function niceLogTicks(vmin, vmax) {
  const clean = (x) => +Number(x).toPrecision(10);
  const within = (mants) => {
    const out = [];
    for (let k = Math.floor(Math.log10(vmin)); k <= Math.ceil(Math.log10(vmax)); k++) {
      for (const m of mants) {
        const t = m * 10 ** k;
        if (t >= vmin * (1 - 1e-9) && t <= vmax * (1 + 1e-9)) out.push(clean(t));
      }
    }
    return out;
  };
  let ticks = within([1, 2, 5]);
  if (ticks.length > 6) ticks = within([1]);
  return ticks.length >= 2 ? ticks : [clean(vmin), clean(vmax)];
}

// OpenLayers colour expression of a variable: categorical `match`, else `interpolate` over the colourmap stops.
function colorExpr(v, st, cmaps, ramp = RAMP) {
  if (v.categorical) {
    const expr = ['match', ['band', 1]];
    for (const [val, c] of v.palette) expr.push(val, rgba(c));
    expr.push([0, 0, 0, 0]);
    return expr;
  }
  const stops = stopsOf(st, cmaps, ramp);
  const expr = ['interpolate', ['linear'], ['band', 1]];
  const n = stops.length;
  // no log operator in OL expressions: the log scale puts the stops at geometric values instead (D-54)
  const at = effectiveLog(st)
    ? (f) => st.vmin * (st.vmax / st.vmin) ** f
    : (f) => st.vmin + (st.vmax - st.vmin) * f;
  stops.forEach((c, i) => expr.push(at(i / (n - 1)), rgba(c)));
  return expr;
}

const SOURCES = ['core', 'cmocean', 'cmasher'];
const SOURCE_KEYS = {core: 'cmaps-matplotlib', cmocean: 'cmaps-cmocean', cmasher: 'cmaps-cmasher'};

// app.style: per-variable style state (cmap, reversed, vmin, vmax, log). `explicit` marks ranges set by the user, the
// URL or the attrs (D-53): the automatic Auto on add skips those. Changes emit `style:changed(name)`.
function createStyle(app) {
  const cmaps = COLORMAPS, groups = COLORMAP_GROUPS;
  const styles = {}, explicit = new Set();
  const storeKey = (name) => `style:${app.cfg.title}:${name}`;

  // D-42/D-47: each source (core = matplotlib, cmocean, cmasher) is listed only while on; matplotlib defaults to on,
  // the others to off; at least one source stays on. Looking a map up (`cmaps`) never depends on it.
  const show = Object.fromEntries(SOURCES.map((src) => {
    const stored = app.storage.get(SOURCE_KEYS[src]);
    return [src, src === 'core' ? stored !== '0' : stored === '1'];
  }));
  if (!Object.values(show).some(Boolean)) show.core = true;  // stored state with no source on (not written back)

  const varOf = (name) => app.varOf(name);
  function load(v) {
    try {
      const raw = app.storage.get(storeKey(v.name));
      const s = raw ? JSON.parse(raw) : null;
      if (s && cmaps[s.cmap] && Number.isFinite(s.vmin) && Number.isFinite(s.vmax) && s.vmin < s.vmax) {
        explicit.add(v.name);
        return {cmap: s.cmap, reversed: !!s.reversed, vmin: s.vmin, vmax: s.vmax, log: !!s.log};
      }
    } catch (_) { /* corrupt entry: use the defaults */ }
    return defaultStyle(v, cmaps);
  }

  const style = {
    cmaps, groups, ramp: RAMP, sources: show, cmapLabel,
    // current style of a variable (a copy; change it with set)
    get(name) {
      const v = varOf(name);
      if (!v) return null;
      return {...(styles[name] || (styles[name] = load(v)))};
    },
    // Merge a patch. `explicit` (default true) marks the range as user-set and, with `persist`, stores it. Rejects (false)
    // an empty/invalid range or an unknown colourmap. The automatic Auto on add passes {explicit: false}.
    set(name, patch, {explicit: mark = true, persist = true} = {}) {
      const v = varOf(name);
      if (!v || v.categorical) return false;
      const next = {...style.get(name), ...patch};
      if (!cmaps[next.cmap] || !(Number.isFinite(next.vmin) && Number.isFinite(next.vmax) && next.vmin < next.vmax)) return false;
      styles[name] = next;
      if (mark) {
        explicit.add(name);
        if (persist) app.storage.set(storeKey(name), JSON.stringify(next));
      }
      app.bus.emit('style:changed', name);
      app.url.sync();
      return true;
    },
    // forget the stored/explicit style: back to the variable's defaults
    reset(name) {
      const v = varOf(name);
      if (!v) return;
      app.storage.remove(storeKey(name));
      explicit.delete(name);
      styles[name] = defaultStyle(v, cmaps);
      app.bus.emit('style:changed', name);
      app.url.sync();
    },
    isExplicit: (name) => explicit.has(name),
    stopsOf: (st) => stopsOf(st, cmaps, RAMP),
    gradientCss, effectiveLog, niceTicks, niceLogTicks,
    colorExpr(name) {
      const v = varOf(name);
      return colorExpr(v, v.categorical ? null : style.get(name), cmaps, RAMP);
    },
    // groups to list in a picker for the current map (see listedGroups)
    listedGroups: (current) => listedGroups(groups, show, current),
    // Switch a colourmap source on/off (D-42); the last one cannot be switched off. Emits `cmaps:changed`.
    setSourceShown(source, on) {
      if (!SOURCES.includes(source)) return false;
      if (!on && !SOURCES.some((s) => s !== source && show[s])) return false;
      show[source] = !!on;
      app.storage.set(SOURCE_KEYS[source], on ? '1' : '0');
      app.bus.emit('cmaps:changed', {...show});
      return true;
    },
  };
  return style;
}
