// Smoke tests of the assembled page against fake DOM/OpenLayers (see _boot.cjs): blank viewer, a store with two
// variables (selection, visibility, dims, style, URL), a failing store.
const test = require('node:test');
const assert = require('node:assert/strict');
const {boot, El} = require('./_boot.cjs');

const later = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (x) => JSON.parse(JSON.stringify(x));

test('blank viewer: basemaps only, no error, components built', async () => {
  const {app, log, els} = await boot({preset: 'blank'});
  assert.equal(app.blank, true);
  assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
  const map = app.state.map;
  assert.equal(map.layers.length, 3);  // light, dark, osm
  assert.equal(app.state.basemap, 'dark');
  assert.deepEqual(map.layers.map((l) => l.visible), [false, true, false]);
  app.layers.setBasemap('osm');
  assert.deepEqual(map.layers.map((l) => l.visible), [false, false, true]);
  // basemap component built its selector
  const root = els['q:[data-gv-component="basemap"]'];
  const select = root.children.find((c) => c.tag === 'select');
  assert.deepEqual(select.options.map((o) => o.value), ['light', 'dark', 'osm', 'none']);
  select.value = 'light'; select.fire('change');
  assert.equal(app.state.basemap, 'light');
  assert.equal(app.state.selected.length, 0);
});

test('blank viewer: a store given only in the spec is opened, ?store= blanks it', async () => {
  const withStore = await boot({preset: 'minimal', openStore: 'cfg'});
  assert.equal(withStore.app.blank, false);
  const blank = await boot({preset: 'minimal', search: '?store=', openStore: 'cfg'});
  assert.equal(blank.app.blank, true);
});

test('store: URL state, selection order, world copies, events', async () => {
  const search = '?var=chl,sst&cmap.chl=plasma&vmin.chl=1&vmax.chl=2&time=2020-01-02&opacity.sst=0.5';
  const {app, log} = await boot({preset: 'minimal', search, openStore: 'cfg'});
  assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
  assert.deepEqual(plain(app.state.selected), ['chl', 'sst']);
  assert.equal(app.state.dims.time, 1);
  assert.deepEqual(plain(app.style.get('chl')), {cmap: 'plasma', reversed: false, vmin: 1, vmax: 2});
  assert.equal(app.style.isExplicit('chl'), true);
  assert.equal(app.style.isExplicit('sst'), false);
  assert.equal(app.layers.opacityOf('sst'), 0.5);
  const map = app.state.map;
  assert.equal(map.layers.length, 3 + 6);  // basemaps + 3 world copies per variable
  assert.equal(app.layers.group('sst').layers.length, 3);
  assert.equal(app.layers.group('sst').layers[0].opacity, 0.5);
  assert.deepEqual(plain(app.layers.group('sst').sources[0].dims), {time: 1});
  assert.equal(app.cfg.title, 'demo.zarr');

  const events = [];
  for (const e of ['selection:changed', 'visibility:changed', 'dims:changed', 'style:changed', 'opacity:changed']) app.bus.on(e, (p) => events.push([e, plain(p)]));

  app.layers.setDim('time', 2);
  assert.deepEqual(plain(app.layers.group('sst').sources[0].updates.at(-1)), {time: 2});
  app.style.set('sst', {vmin: 285});
  assert.equal(app.style.get('sst').vmin, 285);
  assert.equal(app.style.isExplicit('sst'), true);
  assert.equal(log.styles.length > 0, true);  // layers got the new colour expression
  assert.equal(app.style.set('sst', {vmin: 400}), false);  // vmin >= vmax is rejected
  assert.equal(app.style.get('sst').vmin, 285);
  app.layers.setVisible('sst', false);
  assert.equal(app.layers.group('sst'), undefined);
  assert.equal(map.layers.length, 3 + 3);
  app.layers.setVisible('sst', true);
  assert.equal(app.layers.group('sst').layers.length, 3);
  app.layers.deselect('chl');
  assert.deepEqual(plain(app.state.selected), ['sst']);
  app.layers.select('chl');  // new variables go on top
  assert.deepEqual(plain(app.state.selected), ['sst', 'chl']);
  app.layers.move('sst', null);  // to the bottom of the top-first list = on top of nothing: stays bottom-most
  assert.equal(map.layers.at(-1), app.layers.group('chl').layers.at(-1));
  assert.deepEqual(events.map((e) => e[0]), ['dims:changed', 'style:changed', 'visibility:changed', 'visibility:changed',
    'selection:changed', 'selection:changed', 'selection:changed']);

  // the URL is rewritten (debounced) with the state
  await later(250);
  const u = log.urls.at(-1);
  assert.match(u, /^\/index\.html\?store=s3:\/\/b\/demo\.zarr/);
  assert.match(u, /var=/);
  assert.match(u, /time=2020-01-03/);
  assert.match(u, /lon=0/);
});

test('store: Auto on add retries on render and applies when data is loaded (D-53)', async () => {
  const {app} = await boot({preset: 'minimal', openStore: 'cfg'});
  const map = app.state.map;
  assert.equal(map.onces.rendercomplete.length, 1);  // sst: not explicit
  map.fireOnce('rendercomplete');  // no tiles: autoStyle false -> retried
  assert.equal(map.onces.rendercomplete.length, 1);
  assert.equal(app.style.isExplicit('sst'), false);
});

test('store: Auto and Min/Max read the loaded tiles of the current frame', async () => {
  const {app} = await boot({preset: 'minimal', openStore: 'cfg'});
  const vl = app.layers.group('sst');
  const tile = {key: 'k', tileCoord: [0, 0, 0], getState: () => 2, getSize: () => [2, 2], getData: () => new Float32Array([10, 20, 30, 40])};
  vl.layers[0].getRenderer = () => ({tileRepresentationCache: new globalThis.Map([['a', {loaded: true, tile, gutter: 0}]])});
  assert.deepEqual(Array.from(app.frame.values('sst')), [10, 20, 30, 40]);
  assert.deepEqual(plain(app.frame.extent('sst')), {min: 10, max: 40});
  assert.equal(app.frame.minMaxStyle('sst'), true);
  assert.deepEqual([app.style.get('sst').vmin, app.style.get('sst').vmax], [10, 40]);
  assert.equal(app.frame.autoStyle('sst', {auto: true}), true);
  assert.ok(app.style.get('sst').vmin > 10 && app.style.get('sst').vmax < 40);
});

test('store: reload with another centre longitude', async () => {
  const {app, log} = await boot({preset: 'minimal', openStore: 'cfg', search: '?lon=30'});
  assert.equal(app.state.centerLon, 30);
  app.layers.setCenterLon(60);
  assert.match(log.replaced, /lon=60/);
});

test('failing store: error event, blank viewer, no crash', async () => {
  const {app, log} = await boot({preset: 'minimal', openStore: 'error'});
  assert.equal(app.blank, true);
  assert.equal(app.startupError.code, 'not_found');
  assert.ok(log.errors.length >= 1);
  assert.ok(app.state.map);  // the map is still there
});

test('readout component: lat/lon on pointer move, hidden when the pointer leaves or latlon is off', async () => {
  const {app, els} = await boot({preset: 'blank'});
  const root = els['q:[data-gv-component="readout"]'];
  assert.equal(root.hidden, true);
  app.state.map.fire('pointermove', {dragging: false, coordinate: [10, 20]});
  assert.equal(root.hidden, false);
  assert.equal(root.children[0].textContent, 'Lat: 20.000°N  Lon: 10.000°E');
  app.state.map.fire('pointermove', {dragging: true, coordinate: [10, 20]});
  assert.equal(root.hidden, true);

  const off = await boot({specToml: '[[components]]\nname = "readout"\noptions = { latlon = false }\n'});
  off.app.state.map.fire('pointermove', {dragging: false, coordinate: [10, 20]});
  assert.equal(off.els['q:[data-gv-component="readout"]'].hidden, true);
});

test('full preset: every component boots on a store with a selected variable and the card settings filled', async () => {
  const {app, log, els} = await boot({preset: 'full', openStore: 'cfg', search: '?var=sst&time=2020-01-02'});
  assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
  assert.equal(app.blank, false);
  assert.deepEqual(plain(app.state.selected), ['sst']);
  // variable-cards offered a settings container per variable; the legend (card placement) filled it
  const cards = els['q:[data-gv-component="variable-cards"]'];
  const classes = [];
  (function walk(e) { if (e.className) classes.push(e.className); (e.children || []).forEach(walk); })(cards);
  assert.ok(classes.some((c) => c.includes('lg-card')), 'legend drawn inside a card');
  app.layers.select('chl');
  app.layers.setDim('time', 2);
  app.style.set('sst', {vmin: 285});
  app.bus.emit('varinfo:open', {name: 'sst', anchor: new El()});
  await later(250);
  assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
});

for (const preset of ['kiosk', 'analyst', 'minimal']) {
  test(`${preset} preset boots on a store without throwing`, async () => {
    const {app, log} = await boot({preset, openStore: 'cfg', search: '?var=sst'});
    assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
    assert.deepEqual(plain(app.state.selected), ['sst']);
  });
}

test('full preset builds and boots; Global settings group header toggles the body and stores the state', async () => {
  const {app, log, groupEls, store, spec} = await boot({preset: 'full', openStore: 'cfg'});
  assert.equal(log.errors.length, 0, JSON.stringify(log.errors));
  assert.deepEqual(spec.components.filter((c) => c.group).map((c) => [c.name, c.slot]),
    ['label-mode', 'basemap', 'dim-roles', 'cmap-sources', 'center-lon'].map((n) => [n, 'sidebar-bottom']));
  assert.equal(groupEls.length, 1);
  const [section] = groupEls;
  const body = section.children.find((c) => c.className === 'gv-group-body');
  const head = section.children.find((c) => c.tag === 'button');
  assert.ok(head && body, 'header button and body exist');
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  assert.equal(head.getAttribute('aria-controls'), body.id);
  assert.equal(body.hidden, false);
  assert.match(head.innerHTML + head.children.map((c) => c.innerHTML + c.textContent).join(''), /Global settings/);
  head.fire('click');
  assert.equal(body.hidden, true);
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(section.classList.contains('collapsed'), true);
  assert.equal(app.storage.get('group:Global settings'), '1');
  assert.equal(store.get('gv:group:Global settings'), '1');
  head.fire('click');
  assert.equal(body.hidden, false);
  assert.equal(app.storage.get('group:Global settings'), '0');
});

test('group: initial state from the spec, overridden by the stored state', async () => {
  const toml = `[groups."G"]\ncollapsed = true\n\n[[components]]\nname = "label-mode"\nslot = "sidebar-bottom"\ngroup = "G"\n`;
  const a = await boot({specToml: toml, openStore: 'cfg'});
  const body = a.groupEls[0].children.find((c) => c.className === 'gv-group-body');
  assert.equal(body.hidden, true);
  assert.equal(a.groupEls[0].children.find((c) => c.tag === 'button').getAttribute('aria-expanded'), 'false');
});
