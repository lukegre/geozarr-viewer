// Pure helper of cmap-sources: checkbox states, the last source cannot be switched off (D-47).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const get = load(['core/util.js', 'components/cmap-sources/component.js'], {registerComponent: () => {}});
const boxStates = get('boxStates');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('boxStates: the only source still on is disabled with an explanation', () => {
  const s = plain(boxStates({core: true, cmocean: false, cmasher: false}));
  assert.deepEqual(s.core, {checked: true, disabled: true, title: 'At least one colormap source must stay selected'});
  assert.deepEqual(s.cmocean, {checked: false, disabled: false, title: ''});
});

test('boxStates: with two sources on all boxes are enabled', () => {
  const s = plain(boxStates({core: true, cmocean: true, cmasher: false}));
  assert.ok(Object.values(s).every((b) => !b.disabled));
  assert.deepEqual(Object.values(s).map((b) => b.checked), [true, true, false]);
});
