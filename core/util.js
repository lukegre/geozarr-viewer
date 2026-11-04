// Shared helpers: DOM, formatting, icons, namespaced storage. Reference: the helpers around `h`, `fmt`, `ICON`, `store`.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const codeify = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
const fmt = (x) => String(+Number(x).toPrecision(6));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const unitsOf = (v) => v.units_display ?? v.units ?? '';

// h('div', 'cls', 'text') -> element
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const ICON = {
  eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5zM2 2l12 12" fill="none" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor"/></svg>',
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevDown: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".9" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h7M13 4h1M2 12h1M7 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="11" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

// Namespaced localStorage (keys get the prefix) with an in-memory fallback when storage is unavailable
// (private windows, blocked site data, file:// in some browsers).
function makeStorage(prefix = 'gv:', backend) {
  const mem = new globalThis.Map();  // `Map` is the OpenLayers class in the page module
  let ls = backend;
  if (ls === undefined) { try { ls = localStorage; } catch (_) { ls = null; } }
  const guard = (fn, fallback) => { try { return ls ? fn(ls) : fallback(); } catch (_) { return fallback(); } };
  return {
    get: (key) => guard((s) => s.getItem(prefix + key), () => (mem.has(prefix + key) ? mem.get(prefix + key) : null)),
    set: (key, value) => guard((s) => s.setItem(prefix + key, String(value)), () => { mem.set(prefix + key, String(value)); }),
    remove: (key) => guard((s) => s.removeItem(prefix + key), () => { mem.delete(prefix + key); }),
  };
}
