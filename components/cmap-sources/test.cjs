// Pure helper of cmap-sources: checkbox states, the last source cannot be switched off (D-47).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/cmap-sources/component.js'], {registerComponent: (d) => registered.push(d)});
const boxStates = get('boxStates');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named cmap-sources', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'cmap-sources');
});

test('boxStates: the only source still on is disabled with an explanation', () => {
  const s = plain(boxStates({core: true, cmocean: false, cmasher: false}));
  assert.deepEqual(s.core, {checked: true, disabled: true, title: 'At least one colourmap source must stay selected'});
  assert.deepEqual(s.cmocean, {checked: false, disabled: false, title: ''});
});

test('boxStates: with two sources on all boxes are enabled', () => {
  const s = plain(boxStates({core: true, cmocean: true, cmasher: false}));
  assert.ok(Object.values(s).every((b) => !b.disabled));
  assert.deepEqual(Object.values(s).map((b) => b.checked), [true, true, false]);
});
