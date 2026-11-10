// Builds `app`, runs the component inits, loads the store and boots the map. The assembler puts this file after the
// other core files and before the components, and ends the script with `bootViewer();`.

// Components register themselves (one call each); bootViewer inits them in spec order.
const COMPONENTS = {};
function registerComponent(def) { COMPONENTS[def.name] = def; }

// theme = auto | light | dark: data-theme on <html> (theme.css: auto follows prefers-color-scheme)
function applyTheme(theme) {
  document.documentElement.dataset.theme = ['light', 'dark'].includes(theme) ? theme : 'auto';
}

// Core owns the sidebar collapse toggle (a layout option): button + vertical title ("spine") when collapsed.
function initLayout(app) {
  const root = $('gv-app');
  const side = root.querySelector('.gv-sidebar');
  if (!side || !app.spec.layout.sidebar_collapsible) return;
  root.setAttribute('data-collapsible', '');
  const btn = h('button', 'gv-sbtoggle');
  btn.type = 'button';
  btn.innerHTML = ICON.prev;
  const spine = h('button', 'gv-spine');
  spine.type = 'button';
  spine.append(h('span'));
  side.prepend(btn, spine);
  const set = (collapsed) => {
    root.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    app.storage.set('sidebar-collapsed', collapsed ? '1' : '0');
    window.dispatchEvent(new Event('resize'));  // the map resizes with its column
  };
  btn.addEventListener('click', () => set(!root.classList.contains('collapsed')));
  spine.addEventListener('click', () => set(false));
  spine.firstChild.textContent = app.spec.title || 'GeoZarr viewer';
  set(app.storage.get('sidebar-collapsed') === '1');
}

// Core owns the sidebar resize handle (layout option sidebar_resizable): drag the inner edge, the width is stored per
// browser; double-click resets it to the spec width. The handle is hidden while the sidebar is collapsed.
const SB_MIN = 120, SB_MAX = 900;
function initSidebarResize(app) {
  const root = $('gv-app');
  const side = root.querySelector('.gv-sidebar');
  if (!side || !app.spec.layout.sidebar_resizable) return;
  const right = root.dataset.sidebar === 'right';
  const clampW = (w) => Math.round(Math.max(SB_MIN, Math.min(SB_MAX, window.innerWidth - 200, w)));
  const setW = (w) => { root.style.setProperty('--gv-sb-width', w + 'px'); window.dispatchEvent(new Event('resize')); };
  const handle = h('div', 'gv-sbresize');
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'Drag to resize, double-click to reset';
  side.append(handle);
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = {x: e.clientX, w: side.getBoundingClientRect().width};
    handle.setPointerCapture(e.pointerId);
    root.classList.add('resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    setW(clampW(drag.w + (e.clientX - drag.x) * (right ? -1 : 1)));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    root.classList.remove('resizing');
    app.storage.set('sidebar-width', String(Math.round(side.getBoundingClientRect().width)));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { app.storage.remove('sidebar-width'); setW(app.spec.layout.sidebar_width); });
  const stored = +app.storage.get('sidebar-width');
  if (stored > 0) setW(clampW(stored));
}

// Collapsible groups (spec `group`): the assembler emits <section class="gv-group" data-gv-group> with the body
// as its only child; this adds the header button (icon, title, chevron). The state is stored per group name (D-46).
function initGroups(app) {
  for (const section of document.querySelectorAll('.gv-group')) {
    const name = section.dataset.gvGroup;
    const info = (app.spec.groups || {})[name] || {};
    const body = section.firstChild;
    const head = h('button', 'gv-group-head');
    head.type = 'button';
    head.setAttribute('aria-controls', body.id);
    if (info.icon !== 'none') { const ic = h('span', 'gv-group-icon'); ic.innerHTML = ICON.gear; head.append(ic); }
    head.append(h('span', 'gv-group-title', name));
    const chev = h('span', 'gv-group-chev');
    chev.innerHTML = ICON.chevDown;
    head.append(chev);
    const set = (collapsed, save) => {
      body.hidden = collapsed;
      section.classList.toggle('collapsed', collapsed);
      head.setAttribute('aria-expanded', String(!collapsed));
      if (save) app.storage.set('group:' + name, collapsed ? '1' : '0');
    };
    head.addEventListener('click', () => set(!body.hidden, true));
    section.prepend(head);
    const stored = app.storage.get('group:' + name);
    set(stored === null ? !!info.collapsed : stored === '1', false);
  }
}

// Errors (store failed to open, tile errors, component errors): one dismissible toast on the map.
function initErrors(app) {
  const wrap = document.querySelector('.gv-mapwrap');
  const box = h('div', 'gv-toast');
  box.setAttribute('role', 'alert');
  box.hidden = true;
  box.title = 'Click to dismiss';
  box.addEventListener('click', () => { box.hidden = true; });
  wrap.append(box);
  app.bus.on('error', (e) => {
    console.error(e);
    const err = e && e.error ? e.error : e;  // an ErrorEvent carries the error
    let hint = err && err.hint || '';
    if (location.protocol === 'file:') hint = (hint ? hint + ' ' : '') + 'This page was opened from disk; serve it with `scripts/serve.py` instead.';
    box.innerHTML = `<div class="msg">${codeify(String(err && err.message || err))}</div>` + (hint ? `<div class="hint">${codeify(hint)}</div>` : '');
    box.hidden = false;
  });
}

async function bootViewer() {
  const spec = JSON.parse(document.getElementById('spec').textContent);
  applyTheme(spec.theme);
  const app = {
    spec, params: new URLSearchParams(location.search),
    cfg: blankConfig(), blank: true, startupError: null,
    state: {selected: [], hidden: new Set(), dims: {}, roles: {}, opacity: {}, centerLon: 0, map: null,
      labelMode: 'name', basemap: 'dark'},
    bus: createBus(), storage: makeStorage('gv:'),
    mapEl: $('gv-map'),
    slot: (name) => document.querySelector(`[data-slot="${name}"]`),
    varOf: (name) => app.cfg.variables.find((v) => v.name === name),
  };
  // D-44: variables are shown by array name or, when it has one, by long name. Not in the URL.
  app.state.labelMode = app.storage.get('label-mode') === 'long' ? 'long' : 'name';
  app.label = (v) => {
    if (typeof v === 'string') v = app.varOf(v) || {name: v};
    return app.state.labelMode === 'long' && v.long_name?.trim() ? (v.display_name || v.long_name) : v.name;
  };
  app.setLabelMode = (mode) => {
    app.state.labelMode = mode === 'long' ? 'long' : 'name';
    app.storage.set('label-mode', app.state.labelMode);
    app.bus.emit('labels:changed', app.state.labelMode);
  };
  // Open another store: validate it, then reload the page on it (a fresh URL drops the old settings).
  app.openStore = async (src, endpoint = '') => {
    await openStore(src, endpoint, spec.relay);
    const url = new URL(location.pathname, location.href);
    url.searchParams.set('store', src);
    if (endpoint) url.searchParams.set('endpoint', endpoint);
    location.assign(url.href);
  };
  app.url = createUrl(app);
  app.style = createStyle(app);
  app.layers = createLayers(app);
  app.frame = createFrame(app);
  registerCoreUrl(app);
  window.gvApp = app;  // for debugging and embedding scripts

  noHeadSuffixReads(OlFetchStore);  // D-56
  initLayout(app);
  initSidebarResize(app);
  initGroups(app);
  initErrors(app);

  // components first: they subscribe to config:loaded / map:ready, which fire below
  for (const c of spec.components) {
    const def = COMPONENTS[c.name];
    const root = document.querySelector(`[data-gv-component="${c.name}"]`);
    if (!def || !root) { app.bus.emit('error', new Error(`component "${c.name}" is not available in this page`)); continue; }
    try { def.init(app, root, c.options || {}); } catch (e) { app.bus.emit('error', e); }
  }

  // store: ?store= wins over the spec; `?store=` (empty) is the blank viewer even on a page with a default store
  const wanted = app.params.get('store');
  const src = wanted !== null ? wanted : (spec.store || '');
  const endpoint = wanted !== null ? (app.params.get('endpoint') || '') : (spec.endpoint || '');
  let cfg = blankConfig();
  if (src) {
    try { cfg = await openStore(src, endpoint, spec.relay); } catch (e) { app.startupError = e; app.bus.emit('error', e); }
  }
  app.cfg = cfg;
  app.blank = !cfg.variables.length;
  document.title = spec.title || (app.blank ? 'GeoZarr viewer' : `${cfg.title} | GeoZarr viewer`);
  if (!app.blank) app.state.selected = [cfg.variables[0].name];
  app.url.read();
  app.bus.emit('config:loaded', cfg);
  app.layers.start();
  app.url.sync();
}
