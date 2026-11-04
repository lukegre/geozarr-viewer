// Pure helpers of core/layers.js: centre longitude and initial view options (D-26).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/layers.js']);
const normLon = get('normLon'), viewOptions = get('viewOptions');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('normLon wraps into [-180, 180)', () => {
  assert.equal(normLon(0), 0); assert.equal(normLon(190), -170); assert.equal(normLon(-190), 170);
  assert.equal(normLon(180), -180); assert.equal(normLon(540), -180); assert.equal(normLon(NaN), 0);
});

test('viewOptions: global data is centred on the chosen longitude and bounded to one world', () => {
  const cfg = {global: true, bbox: [-180, -90, 180, 90]};
  const o = plain(viewOptions({zoom: 2}, cfg, 30, new URLSearchParams('')));
  assert.deepEqual(o.center, [30, 0]); assert.deepEqual(o.extent, [-150, -90, 210, 90]);
});

test('viewOptions: x, y, z in the URL pin the view; regional data is left alone', () => {
  const cfg = {global: false, bbox: [0, 0, 10, 10]};
  const o = plain(viewOptions({zoom: 2}, cfg, 0, new URLSearchParams('x=5&y=6&z=3.5')));
  assert.deepEqual(o, {zoom: 3.5, center: [5, 6]});
  assert.deepEqual(plain(viewOptions({zoom: 2}, cfg, 0, new URLSearchParams('x=5&y=6'))), {zoom: 2});
});
