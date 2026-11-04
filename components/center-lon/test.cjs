// Pure helper of center-lon: longitude parsing (D-26).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'core/layers.js', 'components/center-lon/component.js'], {registerComponent: (d) => registered.push(d)});
const parseLon = get('parseLon');

test('registers one component named center-lon', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'center-lon');
});

test('parseLon wraps into [-180, 180) and rejects non-numbers', () => {
  assert.equal(parseLon('30'), 30);
  assert.equal(parseLon('190'), -170);
  assert.equal(parseLon('-190.5'), 169.5);
  assert.equal(parseLon('180'), -180);
  assert.equal(parseLon(''), null);
  assert.equal(parseLon('abc'), null);
});
