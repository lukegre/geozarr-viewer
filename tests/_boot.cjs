// Smoke-test harness: assemble a preset, run the page's module script in a vm against a fake DOM and fake OpenLayers
// classes (no browser, no network) and hand back the booted `app`. It catches wiring errors (undefined names, wrong
// call order, events not fired); real rendering still needs a browser.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {ROOT} = require('./_load.cjs');

// Minimal selector support for closest(): comma lists of `.class`, `[data-x]` / `[data-x="v"]` and tag names.
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const sel = part.trim();
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (attr) {
      const key = attr[1].startsWith('data-') ? attr[1].slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase()) : null;
      const v = key ? el.dataset[key] : el.attrs[attr[1]];
      return v !== undefined && (attr[2] === undefined || v === attr[2]);
    }
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1)) || el.className.split(/\s+/).includes(sel.slice(1));
    return el.tag === sel;
  });
}

class El {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.style = {}; this.listeners = {}; this.parent = null;
    this.hidden = false; this.className = ''; this.textContent = ''; this.innerHTML = ''; this.options = []; this.value = '';
    this.checked = false; this.disabled = false; this.open = false;
    const cls = new Set();
    this.classList = {add: (...c) => c.forEach((x) => cls.add(x)), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => ((on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c))};
  }
  adopt(nodes) { for (const n of nodes) if (n instanceof El) { n.parent?.detach(n); n.parent = this; } return nodes; }
  detach(n) { this.children = this.children.filter((c) => c !== n); n.parent = null; }
  append(...n) { this.children.push(...this.adopt(n)); }
  appendChild(n) { this.append(n); return n; }
  prepend(...n) { this.children.unshift(...this.adopt(n)); }
  replaceChildren(...n) { this.children.forEach((c) => { if (c instanceof El) c.parent = null; }); this.children = this.adopt(n); }
  remove() { this.parent?.detach(this); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.parent) if (matches(x, sel)) return x; return null; }
  hasChildNodes() { return this.children.length > 0; }
  get isConnected() { return this.contains(this) && (this.root === true || !!this.parent?.isConnected); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
  getBoundingClientRect() { return {left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0}; }
  add(opt) { this.options.push(opt); if (!this.value) this.value = opt.value; }
  get firstChild() { return this.children[0]; }
  getViewport() { return new El(); }
  fire(type, ev = {}) { for (const f of this.listeners[type] || []) f(ev); }
}

function fakeOl(log) {
  class FakeLayer {
    constructor(o = {}) { this.o = o; this.visible = o.visible; this.style = o.style; this.opacity = o.opacity; this.disposed = false; }
    setStyle(s) { this.style = s; log.styles.push(s); }
    setOpacity(x) { this.opacity = x; }
    setVisible(v) { this.visible = v; }
    dispose() { this.disposed = true; }
    getRenderer() { return null; }
  }
  class FakeSource {
    constructor(o) {
      this.o = o; this.dims = o.dimensions; this.updates = [];
      this.tileGrid = {getExtent: () => [-180, -90, 180, 90], getResolutions: () => [1, 0.5], getOrigin: () => [-180, 90],
        getMatrixIds: () => ['0', '1'], getTileSize: () => 256};
    }
    getState() { return 'ready'; }
    on() {}
    addEventListener() {}
    getKey() { return 'k'; }
    updateDimensions(d) { this.updates.push(d); }
    getTileGrid() { return null; }
  }
  class FakeMap {
    constructor(o) {
      this.o = o; this.layers = [...o.layers]; this.handlers = {}; this.onces = {};
      this.coll = {remove: (l) => { this.layers = this.layers.filter((x) => x !== l); }, push: (l) => { this.layers.push(l); }};
      log.maps.push(this);
    }
    getLayers() { return this.coll; }
    on(e, f) { (this.handlers[e] ||= []).push(f); }
    once(e, f) { (this.onces[e] ||= []).push(f); }
    getView() { return {getProjection: () => 'EPSG:4326', getCenter: () => [1, 2], getZoom: () => 3}; }
    getViewport() { return new El(); }
    fire(e, ev) { for (const f of this.handlers[e] || []) f(ev); }
    fireOnce(e) { const fs_ = this.onces[e] || []; this.onces[e] = []; fs_.forEach((f) => f()); }
  }
  const noop = () => () => {};
  return {Map: FakeMap, WMTSTileGrid: class {}, getView: async () => ({zoom: 2}), withExtentCenter: noop, withHigherResolutions: noop,
    withLowerResolutions: noop, withZoom: noop, WebGLTileLayer: FakeLayer, TileLayer: FakeLayer, GeoZarr: FakeSource, OSM: class {},
    register: () => {}, toLonLat: (c) => c, proj4: {defs() {}}, OlFetchStore: class { async get() {} async getRange() {} }};
}

const FAKE_CFG = {
  title: 'demo.zarr', source: 's3://b/demo.zarr', store_url: 'https://h.org/b/demo.zarr', endpoint: 'https://h.org',
  variables: [
    {name: 'sst', dims: ['time'], categorical: false, units: 'K', long_name: 'Sea surface temperature', display_name: 'SST', vmin: 280, vmax: 300, ticks: [], limits_from_attrs: false, attrs: {}},
    {name: 'chl', dims: ['time'], categorical: false, units: 'mg m-3', long_name: '', display_name: 'chl', vmin: 0, vmax: 5, ticks: [], limits_from_attrs: false, attrs: {}},
  ],
  dims: {time: {size: 3, labels: ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', '2020-01-03T00:00:00Z'],
    iso: ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', '2020-01-03T00:00:00Z']}},
  attrs: {}, levels: 3, bbox: [-180, -90, 180, 90], global: true, basemap_default: true,
  crs: {code: 'EPSG:4326', name: 'EPSG:4326', proj4: null, projection: null},
};

// preset: name of presets/<name>.toml; search: location.search; openStore: 'cfg' (FAKE_CFG), 'error' or undefined (real)
async function boot({preset = 'minimal', search = '', openStore, specToml} = {}) {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gv-boot-'));
  let specFile = path.join(ROOT, 'presets', `${preset}.toml`);
  if (specToml) { specFile = path.join(tmp, 'spec.toml'); fs.writeFileSync(specFile, specToml); }
  const out = path.join(tmp, 'page.html');
  const r = spawnSync('python3', [path.join(ROOT, 'scripts', 'assemble.py'), specFile, '-o', out], {encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`assemble failed: ${r.stderr}`);
  const html = fs.readFileSync(out, 'utf8');
  const specJson = /<script id="spec" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  let src = /<script type="module">\n([\s\S]*?)<\/script>/.exec(html)[1];
  src = src.replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '');
  if (openStore === 'cfg') src = src.replace(/const openStore = .*\n/, 'const openStore = async () => JSON.parse(JSON.stringify(window.__fakeCfg));\n');
  if (openStore === 'error') src = src.replace(/const openStore = .*\n/, "const openStore = async () => { throw storeError('boom', 'try again', 'not_found'); };\n");
  src = src.replace('bootViewer().catch((e) => { console.error(e); });', 'return bootViewer();');

  const log = {maps: [], styles: [], urls: [], events: [], errors: []};
  const els = {};
  const el = (key) => (els[key] ||= Object.assign(new El(), {root: true}));
  const docListeners = {};
  // one fake <section class="gv-group"> (with its body as first child) per group run in the spec, like the assembler emits
  const groupEls = [];
  {
    const sp = JSON.parse(specJson);
    let prev = null;
    for (const c of sp.components) {
      const key = `${c.slot}|${c.group}`;
      if (c.group && key !== prev) {
        const sec = Object.assign(new El('section'), {className: 'gv-group'});
        sec.dataset.gvGroup = c.group; sec.dataset.icon = sp.groups[c.group].icon;
        const body = new El('div'); body.id = `gv-group-${groupEls.length + 1}`; body.className = 'gv-group-body';
        sec.append(body); groupEls.push(sec);
      }
      if (c.group) prev = key; else if (c.slot) prev = null;
    }
  }
  class FakeObserver { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} }
  const store = new Map();
  const win = {__fakeCfg: FAKE_CFG, dispatchEvent() {}, addEventListener() {}};
  const ctx = vm.createContext({
    console: {...console, error: (...a) => log.errors.push(a.map((x) => x?.stack || String(x))), warn() {}}, URL, URLSearchParams, Float64Array, Promise, JSON, Date,
    setTimeout, clearTimeout, Event: class {}, MutationObserver: FakeObserver, ResizeObserver: FakeObserver, CSS: {escape: (x) => String(x)}, Option: class { constructor(label, value) { this.label = label; this.value = value; } },
    window: win, addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800,
    document: {title: '', documentElement: {dataset: {}},
      getElementById: (id) => (id === 'spec' ? {textContent: specJson} : el(`id:${id}`)),
      querySelector: (sel) => el(`q:${sel}`),
      querySelectorAll: (sel) => (sel === '.gv-group' ? groupEls : []),
      addEventListener: (t, f) => (docListeners[t] ||= []).push(f),
      removeEventListener: (t, f) => { docListeners[t] = (docListeners[t] || []).filter((x) => x !== f); },
      createElement: (tag) => new El(tag)},
    location: {search, href: `http://localhost:8780/index.html${search}`, origin: 'http://localhost:8780', pathname: '/index.html', protocol: 'http:',
      assign(u) { log.assigned = u; }, replace(u) { log.replaced = u; }},
    history: {replaceState: (_s, _t, u) => log.urls.push(u)},
    localStorage: {getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k)},
  });
  win.document = ctx.document;
  const ol = fakeOl(log);
  const fn = vm.runInContext(`(async function(Map, WMTSTileGrid, getView, withExtentCenter, withHigherResolutions, withLowerResolutions, withZoom, WebGLTileLayer, TileLayer, GeoZarr, OSM, register, toLonLat, proj4, OlFetchStore){\n${src}\n})`, ctx, {filename: 'page-module.js'});
  await fn(ol.Map, ol.WMTSTileGrid, ol.getView, ol.withExtentCenter, ol.withHigherResolutions, ol.withLowerResolutions, ol.withZoom,
    ol.WebGLTileLayer, ol.TileLayer, ol.GeoZarr, ol.OSM, ol.register, ol.toLonLat, ol.proj4, ol.OlFetchStore);
  const app = win.gvApp;
  return {app, log, els, ctx, html, docListeners, groupEls, store, spec: JSON.parse(specJson)};
}

module.exports = {boot, El, FAKE_CFG};
