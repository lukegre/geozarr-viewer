// Pure functions of the dim-sliders component: which dims get a slider (D-40).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/dim-sliders/component.js'], {registerComponent: (d) => registered.push(d)});
const verticalDims = get('verticalDims'), syncRoles = get('syncRoles'), dimLabel = get('dimLabel');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named dim-sliders', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'dim-sliders');
});

test('verticalDims: v dims in union order; off dims get no slider', () => {
  const roles = {time: 'h', depth: 'v', band: 'off', lev: 'v'};
  assert.deepEqual(plain(verticalDims(['time', 'depth', 'band', 'lev'], roles, true)), ['depth', 'lev']);
});

test('verticalDims: without a timeline the h dim is a slider too', () => {
  assert.deepEqual(plain(verticalDims(['time', 'depth'], {time: 'h', depth: 'v'}, false)), ['time', 'depth']);
  assert.deepEqual(plain(verticalDims(['time', 'depth'], {time: 'h', depth: 'off'}, false)), ['time']);
});

test('defaults without dim-roles: first dim h, the rest v', () => {
  const roles = syncRoles(['time', 'depth', 'band'], {});
  assert.deepEqual(plain(verticalDims(['time', 'depth', 'band'], roles, true)), ['depth', 'band']);
});

test('dimLabel: label or index', () => {
  assert.equal(dimLabel({labels: ['10 m']}, 0), '10 m');
  assert.equal(dimLabel({labels: null}, 2), '2');
});
