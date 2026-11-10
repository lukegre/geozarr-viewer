// Pure helpers of core/layers.js: centre longitude and initial view options (D-26).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/layers.js']);
const normLon = get('normLon'), viewOptions = get('viewOptions'), unwrapRing = get('unwrapRing');
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

test('unwrapRing: a ring crossing the antimeridian becomes continuous; a ring round a pole is closed through it', () => {
  // Fiji-like: 179 -> -179 -> -179 -> 179
  assert.deepEqual(plain(unwrapRing([[179, -17], [-179, -17], [-179, -16], [179, -16], [179, -17]])),
    [[179, -17], [181, -17], [181, -16], [179, -16], [179, -17]]);
  // ring without a crossing is unchanged
  const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
  assert.deepEqual(plain(unwrapRing(ring)), ring);
  // Antarctica-like: goes once round the south pole, ends a full turn from its start
  const r = plain(unwrapRing([[-180, -80], [-60, -70], [60, -70], [180, -80]]));
  assert.deepEqual(r.slice(-3), [[180, -90], [-180, -90], [-180, -80]]);
});
