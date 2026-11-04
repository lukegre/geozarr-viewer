// Frame helpers of core/frame.js (D-48/D-49/D-51/D-54): auto range, min/max, symmetric colourmap, tile scans.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/frame.js']);
const autoRange = get('autoRange'), minMaxRange = get('minMaxRange'), symmetricCmap = get('symmetricCmap');
const frameValues = get('frameValues'), frameExtent = get('frameExtent');
const plain = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const groups = [
  {label: 'Sequential', source: 'core', names: ['viridis', 'RdBu_r']},
  {label: 'Diverging', source: 'core', names: ['RdBu', 'coolwarm']},
  {label: 'cmocean: Sequential', source: 'cmocean', names: ['cmo.thermal']},
  {label: 'cmocean: Diverging', source: 'cmocean', names: ['cmo.balance']},
  {label: 'cmasher: Diverging', source: 'cmasher', names: ['cmr.iceburn']},
];

// fake loaded-tile caches: a variable's layer group is {layers, sources}
const tile = (z, key, data, size = [2, 2], state = 2) => ({
  key, tileCoord: [z, 0, 0], getState: () => state, getSize: () => size, getData: () => data,
});
const layerWith = (reps) => ({
  getRenderer: () => ({tileRepresentationCache: new Map(reps.map((rep, i) => [`k${i}`, {loaded: true, gutter: 0, ...rep}]))}),
});
const group = (layers, keys) => ({layers, sources: keys.map((k) => ({getKey: () => k}))});
const K = 'a:{"t":1}';

test('autoRange: 2-98 % percentiles, skew, symmetric rule', () => {
  const ramp = Array.from({length: 101}, (_, i) => i);
  let r = autoRange(ramp);
  near(r.vmin, 2); near(r.vmax, 98); assert.equal(r.symmetric, false);
  r = autoRange(Array.from({length: 101}, (_, i) => -3 + (8 * i) / 100));
  near(r.vmax, 5 - 0.02 * 8); near(r.vmin, -r.vmax); assert.equal(r.symmetric, true);
  r = autoRange(Array.from({length: 101}, (_, i) => -1 + (11 * i) / 100));
  near(r.vmin, -1 + 0.22); near(r.vmax, 10 - 0.22); assert.equal(r.symmetric, false);
  assert.deepEqual(plain(autoRange([-5, -5, 10, 10])), {vmin: -10, vmax: 10, symmetric: true});
  assert.deepEqual(plain(autoRange([4, 4, 4])), {vmin: 4, vmax: 5, symmetric: false});
  assert.equal(autoRange([]), null);
  assert.equal(autoRange([NaN, Infinity]), null);
  r = autoRange([NaN, 1, 3]);
  near(r.vmin, 1.04); near(r.vmax, 2.96);
});

test('autoRange: positive keeps a log range positive (D-54)', () => {
  const mixed = [...Array(20).fill(-5), 0, ...Array.from({length: 100}, (_, i) => 1 + i)];
  const r = autoRange(mixed, true);
  assert.ok(r.vmin > 0 && r.symmetric === false);
  near(r.vmin, 1 + 0.02 * 99); near(r.vmax, 100 - 0.02 * 99);
  assert.ok(autoRange(mixed).vmin < 0);
  assert.equal(autoRange([-3, 0, -1], true), null);
});

test('minMaxRange', () => {
  assert.deepEqual(plain(minMaxRange(-3, 8)), {vmin: -3, vmax: 8});
  assert.deepEqual(plain(minMaxRange(4, 4)), {vmin: 4, vmax: 5});
  assert.equal(minMaxRange(null, null), null);
  assert.equal(minMaxRange(NaN, 1), null);
});

test('symmetricCmap: diverging kept, others become RdBu reversed (D-49)', () => {
  assert.deepEqual(plain(symmetricCmap('viridis', false, groups)), {cmap: 'RdBu', reversed: true});
  assert.deepEqual(plain(symmetricCmap('RdBu_r', true, groups)), {cmap: 'RdBu', reversed: true});
  assert.deepEqual(plain(symmetricCmap('cmo.thermal', true, groups)), {cmap: 'RdBu', reversed: true});
  assert.deepEqual(plain(symmetricCmap('RdBu', false, groups)), {cmap: 'RdBu', reversed: false});
  assert.deepEqual(plain(symmetricCmap('coolwarm', true, groups)), {cmap: 'coolwarm', reversed: true});
  assert.deepEqual(plain(symmetricCmap('cmo.balance', false, groups)), {cmap: 'cmo.balance', reversed: false});
  assert.deepEqual(plain(symmetricCmap('cmr.iceburn', true, groups)), {cmap: 'cmr.iceburn', reversed: true});
});

test('frameValues: current key, highest z only, nodata skipped', () => {
  const vl = group([layerWith([
    {tile: tile(2, 'a:{"t":0}', new Float32Array([100, 100, 100, 100]))},
    {tile: tile(0, K, new Float32Array([7, 7, 7, 7]))},
    {tile: tile(1, K, new Float32Array([1, 2, NaN, 4]))},
    {tile: tile(2, K, new Float32Array([9, 9, 9, 9]), [2, 2], 1)},
    {tile: tile(2, K, new Float32Array([9, 9, 9, 9])), loaded: false},
  ])], [K]);
  assert.deepEqual(Array.from(frameValues(vl)), [1, 2, 4]);
});

test('frameValues: world copies, own keys, empty cases', () => {
  const two = group([layerWith([{tile: tile(0, K, new Float32Array([1, 2, 3, 4]))}]),
    layerWith([{tile: tile(0, K, new Float32Array([5, 6, 7, 8]))}])], [K, K]);
  assert.deepEqual(Array.from(frameValues(two)), [1, 2, 3, 4, 5, 6, 7, 8]);
  const stale = group([layerWith([{tile: tile(0, K, new Float32Array([1, 2, 3, 4]))}]),
    layerWith([{tile: tile(0, 'other', new Float32Array([5, 6, 7, 8]))}])], [K, K]);
  assert.deepEqual(Array.from(frameValues(stale)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(frameValues(group([{}], [K]))), []);
  assert.deepEqual(Array.from(frameValues(undefined)), []);
});

test('frameValues: alpha band, gutter, subsampling', () => {
  const alpha = group([layerWith([{tile: tile(0, K, new Float32Array([1, 1, 2, 0, 3, 1, 4, 1]))}])], [K]);
  assert.deepEqual(Array.from(frameValues(alpha)), [1, 3, 4]);
  const gut = group([layerWith([{gutter: 1, tile: tile(0, K, new Float32Array([0, 0, 0, 0, 5, 0, 0, 0, 0]), [1, 1])}])], [K]);
  assert.deepEqual(Array.from(frameValues(gut)), [5]);
  const big = new Float32Array(1000 * 1000).map((_, i) => i);
  const n = frameValues(group([layerWith([{tile: tile(0, K, big, [1000, 1000])}])], [K])).length;
  assert.ok(n > 0 && n <= 200000, `n = ${n}`);
});

test('frameExtent: true extremes (no stride), positive-only for log, null when empty', () => {
  const huge = new Float32Array(1500 * 1500).fill(5);
  huge[1 * 1500 + 1] = -42; huge[1499 * 1500 + 1499] = 99;
  const h = group([layerWith([{tile: tile(0, K, huge, [1500, 1500])}])], [K]);
  assert.ok(Array.from(frameValues(h)).every((x) => x === 5));
  assert.deepEqual(plain(frameExtent(h)), {min: -42, max: 99});
  const p = group([layerWith([{tile: tile(0, K, new Float32Array([-4, 0, 3, 8]))}])], [K]);
  assert.deepEqual(plain(frameExtent(p, true)), {min: 3, max: 8});
  assert.deepEqual(plain(frameExtent(p)), {min: -4, max: 8});
  const q = group([layerWith([{tile: tile(0, K, new Float32Array([-4, 0, -1, 0]))}])], [K]);
  assert.equal(frameExtent(q, true), null);
  assert.equal(frameExtent(undefined), null);
  const nan = group([layerWith([{tile: tile(0, K, new Float32Array([NaN, NaN, NaN, NaN]))}])], [K]);
  assert.equal(frameExtent(nan), null);
});
