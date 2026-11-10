// Pure functions of the timeline component: step positions, date/index ticks, nearest step, .
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const get = load(['core/util.js', 'components/timeline/component.js'], {registerComponent: () => {}});
const {stepPositions, dateTicks, indexTicks, nearestStep} = Object.fromEntries(
  ['stepPositions', 'dateTicks', 'indexTicks', 'nearestStep'].map((n) => [n, get(n)]));
const plain = (x) => JSON.parse(JSON.stringify(x));  // vm arrays have another prototype

test('stepPositions: proportional to time for ISO labels', () => {
  const r = stepPositions({size: 3, iso: ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', '2020-01-05T00:00:00Z']});
  assert.equal(r.timed, true);
  assert.deepEqual(plain(r.pos), [0, 0.25, 1]);
  assert.equal(r.hi - r.lo, 4 * 864e5);
});

test('stepPositions: evenly spaced without ISO labels, unparsable labels or one step', () => {
  assert.deepEqual(plain(stepPositions({size: 3, iso: null}).pos), [0, 0.5, 1]);
  assert.equal(stepPositions({size: 2, iso: ['x', 'y']}).timed, false);
  assert.deepEqual(plain(stepPositions({size: 1, iso: null}).pos), [0]);
  assert.equal(stepPositions({size: 2, iso: ['2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z']}).timed, false);
});

test('dateTicks: years for long spans, months for short ones', () => {
  const y = dateTicks(Date.UTC(2000, 5, 1), Date.UTC(2010, 5, 1));
  assert.deepEqual(plain(y.map((t) => t.text)), ['2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010']);
  const m = dateTicks(Date.UTC(2020, 0, 1), Date.UTC(2020, 5, 1));
  assert.deepEqual(plain(m.map((t) => t.text)), ['Jan 2020', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
  assert.equal(m[1].t, Date.UTC(2020, 1, 1));
});

test('dateTicks: longer spans use a 2/5/10 year step', () => {
  const t = dateTicks(Date.UTC(1990, 0, 1), Date.UTC(2020, 0, 1));
  assert.deepEqual(plain(t.map((x) => x.text)), ['1990', '1995', '2000', '2005', '2010', '2015', '2020']);
});

test('indexTicks: 1/2/5 x 10^k steps with dim labels', () => {
  const d = {size: 20, labels: null};
  const pos = Array.from({length: 20}, (_, i) => i / 19);
  const t = indexTicks(d, pos);
  assert.deepEqual(plain(t.map((x) => x.text)), ['0', '5', '10', '15']);
  assert.equal(t[1].p, 5 / 19);
  assert.equal(indexTicks({size: 3, labels: ['a', 'b', 'c']}, [0, 0.5, 1])[2].text, 'c');
});

test('nearestStep: closest position', () => {
  const pos = [0, 0.1, 0.9, 1];
  assert.equal(nearestStep(pos, 0.04), 0);
  assert.equal(nearestStep(pos, 0.3), 1);
  assert.equal(nearestStep(pos, 0.6), 2);
  assert.equal(nearestStep(pos, 1), 3);
});
