// Pure functions of the variable-cards component: card order, drop position, metadata line.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const get = load(['core/util.js', 'components/variable-cards/component.js'], {registerComponent: () => {}});
const cardOrder = get('cardOrder'), dropBefore = get('dropBefore'), metaLine = get('metaLine');

test('cardOrder: selected reversed (top first), others in store order', () => {
  const vars = ['a', 'b', 'c', 'd'].map((name) => ({name}));
  const r = cardOrder(vars, ['c', 'a']);  // state.selected is bottom-first
  assert.deepEqual([...r.selected], ['a', 'c']);
  assert.deepEqual([...r.other], ['b', 'd']);
  assert.deepEqual([...cardOrder(vars, []).selected], []);
});

test('dropBefore: first card whose midpoint is below the pointer; null below all; dragged skipped', () => {
  const rects = {a: {top: 0, height: 100}, b: {top: 110, height: 100}, c: {top: 220, height: 100}};
  const rectOf = (n) => rects[n];
  const names = ['a', 'b', 'c'];
  assert.equal(dropBefore(names, rectOf, 10, null), 'a');
  assert.equal(dropBefore(names, rectOf, 100, null), 'b');
  assert.equal(dropBefore(names, rectOf, 250, null), 'c');
  assert.equal(dropBefore(names, rectOf, 400, null), null);
  assert.equal(dropBefore(names, rectOf, 10, 'a'), 'b');
});

test('metaLine: units and dims joined, empties dropped', () => {
  assert.equal(metaLine({units: 'K', dims: ['time']}), 'K · time');
  assert.equal(metaLine({units: '', dims: []}), '');
});
