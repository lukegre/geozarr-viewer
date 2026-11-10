// Pure style helpers of core/style.js: ticks, log ticks, colour expression, colourmap resolution.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/colormaps.js', 'core/style.js']);
const niceTicks = get('niceTicks'), niceLogTicks = get('niceLogTicks'), colorExpr = get('colorExpr');
const resolveCmap = get('resolveCmap'), defaultStyle = get('defaultStyle'), stopsOf = get('stopsOf');
const gradientCss = get('gradientCss'), effectiveLog = get('effectiveLog');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('niceTicks: shared cases with preview._nice_ticks', () => {
  assert.deepEqual(plain(niceTicks(0, 1)), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(plain(niceTicks(280, 470)), [300, 350, 400, 450]);
  assert.deepEqual(plain(niceTicks(-3.3, 31.7)), [0, 10, 20, 30]);
  assert.deepEqual(plain(niceTicks(0.0013, 0.0021)), [0.0014, 0.0016, 0.0018, 0.002]);
  assert.deepEqual(plain(niceTicks(1e6, 9.3e6)), [2e6, 4e6, 6e6, 8e6]);
  assert.deepEqual(plain(niceTicks(5, 5.5)), [5, 5.1, 5.2, 5.3, 5.4, 5.5]);
  assert.deepEqual(plain(niceTicks(2, 3)), [2, 2.2, 2.4, 2.6, 2.8, 3]);
});

test('niceTicks: degenerate span gives one tick', () => {
  assert.deepEqual(plain(niceTicks(3, 3)), [3]);
});

test('niceLogTicks: 1-2-5 ticks, decades when crowded, ends when too few', () => {
  assert.deepEqual(plain(niceLogTicks(1, 10)), [1, 2, 5, 10]);
  assert.deepEqual(plain(niceLogTicks(3, 80)), [5, 10, 20, 50]);
  assert.deepEqual(plain(niceLogTicks(1, 1000)), [1, 10, 100, 1000]);
  assert.deepEqual(plain(niceLogTicks(3, 4)), [3, 4]);
});

test('resolveCmap: exact key, _r suffix reverses, unknown falls back to viridis', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const cm = {viridis: [[0, 0, 0]], plasma: [[1, 1, 1]]};
    assert.deepEqual(plain(resolveCmap({name: 'a'}, cm)), {cmap: 'viridis', reversed: false});
    assert.deepEqual(plain(resolveCmap({name: 'a', cmap: 'plasma'}, cm)), {cmap: 'plasma', reversed: false});
    assert.deepEqual(plain(resolveCmap({name: 'a', cmap: 'plasma_r'}, cm)), {cmap: 'plasma', reversed: true});
    assert.deepEqual(plain(resolveCmap({name: 'a', cmap: 'plasma_r', reversed: true}, cm)), {cmap: 'plasma', reversed: false});
    assert.deepEqual(plain(resolveCmap({name: 'a', cmap: 'nope'}, cm)), {cmap: 'viridis', reversed: false});
  } finally { console.warn = warn; }
});

test('defaultStyle takes limits from the variable', () => {
  assert.deepEqual(plain(defaultStyle({name: 'a', vmin: 1, vmax: 9, cmap: 'plasma'}, get('COLORMAPS'))),
    {cmap: 'plasma', reversed: false, vmin: 1, vmax: 9});
});

test('stopsOf: reversed copy, input not mutated', () => {
  const cm = {a: [[1, 1, 1], [2, 2, 2]]};
  assert.deepEqual(plain(stopsOf({cmap: 'a', reversed: true}, cm)), [[2, 2, 2], [1, 1, 1]]);
  assert.deepEqual(plain(cm.a), [[1, 1, 1], [2, 2, 2]]);  // input not mutated
});

test('colorExpr: linear stops span vmin..vmax', () => {
  const cm = {g: [[0, 0, 0], [100, 100, 100], [200, 200, 200]]};
  const e = plain(colorExpr({name: 'a'}, {cmap: 'g', reversed: false, vmin: 10, vmax: 30}, cm));
  assert.deepEqual(e, ['interpolate', ['linear'], ['band', 1],
    10, [0, 0, 0, 1], 20, [100, 100, 100, 1], 30, [200, 200, 200, 1]]);
});

test('colorExpr: reversed swaps the colours', () => {
  const cm = {g: [[0, 0, 0], [200, 200, 200]]};
  const e = plain(colorExpr({name: 'a'}, {cmap: 'g', reversed: true, vmin: 0, vmax: 1}, cm));
  assert.deepEqual(e.slice(3), [0, [200, 200, 200, 1], 1, [0, 0, 0, 1]]);
});

test('colorExpr: log scale puts stops at geometric values (D-54), needs vmin > 0', () => {
  const cm = {g: [[0, 0, 0], [100, 100, 100], [200, 200, 200]]};
  const e = plain(colorExpr({name: 'a'}, {cmap: 'g', reversed: false, vmin: 1, vmax: 100, log: true}, cm));
  assert.equal(e[3], 1); assert.ok(Math.abs(e[5] - 10) < 1e-9); assert.ok(Math.abs(e[7] - 100) < 1e-9);
  // log flag kept but vmin <= 0: linear
  const lin = plain(colorExpr({name: 'a'}, {cmap: 'g', reversed: false, vmin: 0, vmax: 10, log: true}, cm));
  assert.deepEqual([lin[3], lin[5], lin[7]], [0, 5, 10]);
  assert.equal(effectiveLog({log: true, vmin: 0}), false);
  assert.equal(effectiveLog({log: true, vmin: 1}), true);
});

test('colorExpr: categorical uses match with a transparent default', () => {
  const v = {categorical: true, palette: [[1, [255, 0, 0]], [2, [0, 255, 0]]]};
  assert.deepEqual(plain(colorExpr(v, null, {})), ['match', ['band', 1], 1, [255, 0, 0, 1], 2, [0, 255, 0, 1], [0, 0, 0, 0]]);
});

test('gradientCss: evenly spaced stops', () => {
  assert.equal(gradientCss([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
    'linear-gradient(to right,rgb(1,2,3) 0%,rgb(4,5,6) 50%,rgb(7,8,9) 100%)');
});

test('colormaps data: 154 maps with 11 stops, groups cover only known maps', () => {
  const cm = plain(get('COLORMAPS')), groups = plain(get('COLORMAP_GROUPS'));
  assert.ok(Object.keys(cm).length >= 100);
  assert.equal(cm.viridis.length, 11);
  for (const g of groups) for (const n of g.names) assert.ok(cm[n], n);
});
