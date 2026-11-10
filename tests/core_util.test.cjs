// Shared helpers of core/util.js: dimLabel, syncRoles (D-40), plainKey (D-50), unitsOf.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js']);
const dimLabel = get('dimLabel'), syncRoles = get('syncRoles'), plainKey = get('plainKey'), unitsOf = get('unitsOf');
const plain = (x) => JSON.parse(JSON.stringify(x));  // vm objects have another prototype

test('dimLabel: label or index', () => {
  assert.equal(dimLabel({labels: ['a', 'b']}, 1), 'b');
  assert.equal(dimLabel({labels: ['10 m']}, 0), '10 m');
  assert.equal(dimLabel({labels: null}, 4), '4');
});

test('syncRoles: first dim h, rest v; kept roles stay; one h at most', () => {
  assert.deepEqual(plain(syncRoles(['time', 'depth'], {})), {time: 'h', depth: 'v'});
  assert.deepEqual(plain(syncRoles(['time', 'depth'], {time: 'off', depth: 'h'})), {time: 'off', depth: 'h'});
  assert.deepEqual(plain(syncRoles(['a', 'b'], {a: 'v'})), {a: 'v', b: 'h'});     // no holder: the new dim becomes h
  assert.deepEqual(plain(syncRoles(['a', 'b'], {a: 'h', b: 'h'})), {a: 'h', b: 'v'});  // two h keep the first
  assert.deepEqual(plain(syncRoles(['t', 'z', 'b'], {t: 'h', z: 'off'})), {t: 'h', z: 'off', b: 'v'});
  const r = {a: 'h'};
  assert.deepEqual(plain(syncRoles(['a', 'b'], r)), {a: 'h', b: 'v'});
  assert.deepEqual(plain(syncRoles(['a', 'b'], r)), {a: 'h', b: 'v'});  // idempotent
});

test('plainKey: no modifier keys and not typing in a field', () => {
  const inField = {closest: (sel) => (sel.includes('input') ? {} : null)};
  assert.equal(plainKey({key: 'ArrowUp'}), true);
  assert.equal(plainKey({key: 'ArrowUp', target: {closest: () => null}}), true);
  assert.equal(plainKey({key: 'ArrowUp', shiftKey: true}), false);
  assert.equal(plainKey({key: 'ArrowUp', metaKey: true}), false);
  assert.equal(plainKey({key: 'ArrowUp', target: inField}), false);
});

test('unitsOf: the units attribute or empty', () => {
  assert.equal(unitsOf({units: 'K'}), 'K');
  assert.equal(unitsOf({}), '');
});
