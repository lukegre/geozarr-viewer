// Pure functions of the var-attrs component: table rows and popover placement (D-55).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/var-attrs/component.js'], {registerComponent: (d) => registered.push(d)});
const attrRows = get('attrRows'), popoverPosition = get('popoverPosition');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named var-attrs', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'var-attrs');
});

test('attrRows: stored order, values as text, empty for missing attrs', () => {
  assert.deepEqual(plain(attrRows({units: 'K', scale: 0.5, flag: true})), [['units', 'K'], ['scale', '0.5'], ['flag', 'true']]);
  assert.deepEqual(plain(attrRows(undefined)), []);
});

test('popoverPosition: right of the sidebar, at the anchor, inside the viewport', () => {
  const view = {w: 1000, h: 800}, panel = {w: 420, h: 200};
  assert.deepEqual(plain(popoverPosition({top: 100, right: 300}, {right: 320}, panel, view)), {left: 328, top: 100});
  // no sidebar: right of the anchor
  assert.deepEqual(plain(popoverPosition({top: 100, right: 300}, null, panel, view)), {left: 308, top: 100});
  // clamped to the right and bottom edges
  assert.deepEqual(plain(popoverPosition({top: 790, right: 900}, null, panel, view)), {left: 572, top: 592});
  // never above minTop (a top bar)
  assert.equal(popoverPosition({top: 0, right: 300}, null, panel, view, 40).top, 40);
});
