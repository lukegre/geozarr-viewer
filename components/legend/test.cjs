// Pure helpers of legend: tick positions (linear and log, D-54), label collision layout (layoutTicks), gradient direction.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'core/style.js', 'components/legend/component.js'], {registerComponent: (d) => registered.push(d), RAMP: [], COLORMAPS: {}, COLORMAP_GROUPS: []});
const legendTicks = get('legendTicks'), fitLabels = get('fitLabels'), gradientFor = get('gradientFor');
const style = {effectiveLog: get('effectiveLog'), niceTicks: get('niceTicks'), niceLogTicks: get('niceLogTicks')};
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named legend', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'legend');
});

test('legendTicks: linear ticks at (t - vmin) / (vmax - vmin)', () => {
  const t = plain(legendTicks({vmin: 0, vmax: 1}, style));
  assert.deepEqual(t.map((x) => x.label), ['0', '0.2', '0.4', '0.6', '0.8', '1']);
  assert.deepEqual(t.map((x) => x.pos), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('legendTicks: effective log scale uses 1-2-5 ticks at log fractions', () => {
  const t = plain(legendTicks({vmin: 1, vmax: 10, log: true}, style));
  assert.deepEqual(t.map((x) => x.label), ['1', '2', '5', '10']);
  assert.ok(Math.abs(t[1].pos - Math.log10(2)) < 1e-12);
  assert.equal(t[0].pos, 0); assert.equal(t.at(-1).pos, 1);
  // more than 6 ticks: only powers of ten
  assert.deepEqual(plain(legendTicks({vmin: 1, vmax: 100, log: true}, style)).map((x) => x.label), ['1', '10', '100']);
});

test('legendTicks: the log flag is ignored while Min <= 0 (stays linear)', () => {
  const t = plain(legendTicks({vmin: 0, vmax: 10, log: true}, style));
  assert.deepEqual(t.map((x) => x.label), ['0', '2', '4', '6', '8', '10']);
});

test('fitLabels: nudges end labels inside the bar and hides colliding ones', () => {
  // bar 0..100; labels 20 wide centred on ticks at 0, 10, 50, 100
  const r = plain(fitLabels([{start: -10, size: 20}, {start: 0, size: 20}, {start: 40, size: 20}, {start: 90, size: 20}], 0, 100));
  assert.deepEqual(r.map((x) => x.shift), [10, 0, 0, -10]);
  assert.deepEqual(r.map((x) => x.hidden), [false, true, false, false]);
});

test('gradientFor: vertical bars run bottom to top', () => {
  assert.equal(gradientFor('linear-gradient(to right,red,blue)', true), 'linear-gradient(to top,red,blue)');
  assert.equal(gradientFor('linear-gradient(to right,red,blue)', false), 'linear-gradient(to right,red,blue)');
});
