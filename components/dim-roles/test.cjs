// Pure functions of the dim-roles component: role model, assignment, URL (`slider.<dim>`), missing components (D-40).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/dim-roles/component.js'], {registerComponent: (d) => registered.push(d)});
const {defaultRoles, syncRoles, assignRole, effectiveRole, roleParams, readRoleParams} = Object.fromEntries(
  ['defaultRoles', 'syncRoles', 'assignRole', 'effectiveRole', 'roleParams', 'readRoleParams'].map((n) => [n, get(n)]));
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named dim-roles', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'dim-roles');
});

test('defaultRoles: first h, rest v', () => {
  assert.deepEqual(plain(defaultRoles(['t', 'z', 'b'])), {t: 'h', z: 'v', b: 'v'});
  assert.deepEqual(plain(defaultRoles([])), {});
});

test('syncRoles: a new dim becomes h only when no dim holds it', () => {
  assert.deepEqual(plain(syncRoles(['t', 'z'], {t: 'v'})), {t: 'v', z: 'h'});
  assert.deepEqual(plain(syncRoles(['t', 'z', 'b'], {t: 'h', z: 'off'})), {t: 'h', z: 'off', b: 'v'});
});

test('assignRole: choosing h moves the previous holder to v; v and off leave the others alone', () => {
  assert.deepEqual(plain(assignRole({t: 'h', z: 'v'}, ['t', 'z'], 'z', 'h')), {t: 'v', z: 'h'});
  assert.deepEqual(plain(assignRole({t: 'h', z: 'v'}, ['t', 'z'], 't', 'off')), {t: 'off', z: 'v'});
  assert.deepEqual(plain(assignRole({t: 'h', z: 'v'}, ['t', 'z'], 'z', 'off')), {t: 'h', z: 'off'});
});

test('effectiveRole: no timeline -> h is drawn as v; no sliders -> v is off', () => {
  assert.equal(effectiveRole('h', true, true), 'h');
  assert.equal(effectiveRole('h', false, true), 'v');
  assert.equal(effectiveRole('v', true, false), 'off');
  assert.equal(effectiveRole('h', false, false), 'off');
  assert.equal(effectiveRole('off', true, true), 'off');
});

test('roleParams: only roles that differ from the default', () => {
  assert.deepEqual(plain(roleParams(['t', 'z'], {t: 'h', z: 'v'})), []);
  assert.deepEqual(plain(roleParams(['t', 'z'], {t: 'v', z: 'h'})), [['slider.t', 'v'], ['slider.z', 'h']]);
  assert.deepEqual(plain(roleParams(['t', 'z'], {t: 'h', z: 'off'})), [['slider.z', 'off']]);
});

test('readRoleParams: known dims and valid values only', () => {
  const p = new URLSearchParams('slider.t=off&slider.z=bogus&slider.nope=h&x=1');
  assert.deepEqual(plain(readRoleParams(p, ['t', 'z'])), {t: 'off'});
});

test('URL round trip: two h in the URL keep the first dim after syncRoles', () => {
  const dims = ['t', 'z'];
  const roles = syncRoles(dims, readRoleParams(new URLSearchParams('slider.t=h&slider.z=h'), dims));
  assert.deepEqual(plain(roles), {t: 'h', z: 'v'});
});
