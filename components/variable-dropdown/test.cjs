// Pure functions of the variable-dropdown component.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const get = load(['core/util.js', 'components/variable-dropdown/component.js'], {registerComponent: () => {}});
const singleChange = get('singleChange'), summaryText = get('summaryText');

test('singleChange: select the chosen one, deselect the others', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(singleChange(['a', 'b'], 'c'))), {add: 'c', remove: ['a', 'b']});
  assert.deepEqual(JSON.parse(JSON.stringify(singleChange(['a'], 'a'))), {add: 'a', remove: []});
  assert.deepEqual(JSON.parse(JSON.stringify(singleChange(['a'], ''))), {add: null, remove: ['a']});
});

test('summaryText: none, one label, a count', () => {
  const lab = (n) => n.toUpperCase();
  assert.equal(summaryText([], lab), 'None selected');
  assert.equal(summaryText(['a'], lab), 'A');
  assert.equal(summaryText(['a', 'b', 'c'], lab), '3 variables');
});
