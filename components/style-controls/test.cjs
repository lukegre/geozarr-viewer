// Pure helpers of style-controls: arrow-key stepping, Space, range parsing, Symmetric, control state (D-45, D-48, D-54).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/style-controls/component.js'], {registerComponent: (d) => registered.push(d)});
const stepValue = get('stepValue'), isReverseKey = get('isReverseKey'), parseRange = get('parseRange');
const symmetricRange = get('symmetricRange'), controlState = get('controlState');

test('registers one component named style-controls', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'style-controls');
});

test('stepValue: arrows step one option, no wrap, modifiers and other keys ignored', () => {
  const v = ['a', 'b', 'c'];
  assert.equal(stepValue(v, 'b', {key: 'ArrowRight'}), 'c');
  assert.equal(stepValue(v, 'b', {key: 'ArrowLeft'}), 'a');
  assert.equal(stepValue(v, 'c', {key: 'ArrowRight'}), null);
  assert.equal(stepValue(v, 'a', {key: 'ArrowLeft'}), null);
  assert.equal(stepValue(v, 'b', {key: 'ArrowRight', shiftKey: true}), null);
  assert.equal(stepValue(v, 'b', {key: 'ArrowDown'}), null);
  assert.equal(stepValue(v, 'zz', {key: 'ArrowRight'}), null);
});

test('isReverseKey: plain Space only', () => {
  assert.equal(isReverseKey({key: ' '}), true);
  assert.equal(isReverseKey({key: 'Spacebar', code: 'Space'}), true);
  assert.equal(isReverseKey({key: ' ', ctrlKey: true}), false);
  assert.equal(isReverseKey({key: 'a', code: 'KeyA'}), false);
});

test('parseRange: finite numbers with min < max', () => {
  assert.deepEqual({...parseRange('1', '2.5')}, {vmin: 1, vmax: 2.5});
  assert.equal(parseRange('2', '2'), null);
  assert.equal(parseRange('3', '2'), null);
  assert.equal(parseRange('', '2'), null);
  assert.equal(parseRange('a', 'b'), null);
});

test('symmetricRange: [-m, m] from the larger magnitude, null for 0..0', () => {
  assert.deepEqual({...symmetricRange({vmin: -2, vmax: 5})}, {vmin: -5, vmax: 5});
  assert.deepEqual({...symmetricRange({vmin: 3, vmax: -7})}, {vmin: -7, vmax: 7});
  assert.equal(symmetricRange({vmin: 0, vmax: 0}), null);
});

test('controlState: log needs Min > 0, Symmetric off while log is effective, 6 significant digits', () => {
  let c = controlState({vmin: 0, vmax: 1, log: true, reversed: true}, false);
  assert.equal(c.logDisabled, true); assert.equal(c.log, true); assert.equal(c.symDisabled, false); assert.equal(c.reversed, true);
  c = controlState({vmin: 0.1234567891, vmax: 100, log: true}, true);
  assert.equal(c.logDisabled, false); assert.equal(c.symDisabled, true);
  assert.equal(c.minText, '0.123457'); assert.equal(c.maxText, '100');
});
