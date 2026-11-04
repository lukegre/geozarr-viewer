// URL parameter helpers of core/url.js (reference: dimToParam, dimFromParam, styleParams, applyUrlState).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/url.js']);
const dimToParam = get('dimToParam'), dimFromParam = get('dimFromParam');
const styleParamsOf = get('styleParamsOf'), readStyleParams = get('readStyleParams'), urlString = get('urlString');
const plain = (x) => JSON.parse(JSON.stringify(x));

const dims = {time: {size: 3, iso: ['2020-01-01T00:00:00Z', '2020-01-02T00:00:00.000Z', null], labels: null}, depth: {size: 5, iso: null}};

test('dim params: ISO date for time-like dims, index otherwise', () => {
  assert.equal(dimToParam('time', 0, dims), '2020-01-01');
  assert.equal(dimToParam('time', 1, dims), '2020-01-02');
  assert.equal(dimToParam('time', 2, dims), '2');
  assert.equal(dimToParam('depth', 4, dims), '4');
  assert.equal(dimFromParam('time', '2020-01-02', dims), 1);
  assert.equal(dimFromParam('time', '2', dims), 2);
  assert.equal(dimFromParam('depth', '4', dims), 4);
  assert.equal(dimFromParam('depth', '5', dims), null);
  assert.equal(dimFromParam('depth', 'x', dims), null);
});

test('styleParamsOf: plain names for one variable, suffixed for several', () => {
  const st = {a: {cmap: 'plasma', reversed: true, log: false, vmin: 0.1234567, vmax: 5}, b: {cmap: 'viridis', reversed: false, vmin: 1, vmax: 2}};
  const vars = [{name: 'a'}, {name: 'b', categorical: false}];
  const one = styleParamsOf([vars[0]], (n) => st[n], () => 0.5);
  assert.deepEqual(plain(one), [['cmap', 'plasma'], ['rev', '1'], ['vmin', '0.123457'], ['vmax', '5'], ['opacity', '0.5']]);
  const two = styleParamsOf(vars, (n) => st[n], () => 1);
  assert.ok(two.some(([k]) => k === 'cmap.a') && two.some(([k]) => k === 'vmax.b'));
  assert.ok(!two.some(([k]) => k === 'opacity.a'));
  const cat = styleParamsOf([{name: 'c', categorical: true}], () => null, () => 1);
  assert.deepEqual(plain(cat), []);
});

test('readStyleParams: URL values for the first/named variable, invalid ranges ignored', () => {
  const cmaps = {viridis: [], plasma: []};
  const p = new URLSearchParams('cmap=plasma&rev=1&vmin=2&vmax=8&opacity=0.4&vmin.b=9');
  const base = {cmap: 'viridis', reversed: false, vmin: 0, vmax: 1};
  const a = readStyleParams(p, 'a', 0, base, cmaps);
  assert.deepEqual(plain(a.style), {cmap: 'plasma', reversed: true, vmin: 2, vmax: 8});
  assert.equal(a.explicit, true); assert.equal(a.opacity, 0.4);
  const b = readStyleParams(p, 'b', 1, base, cmaps);  // plain params only reach the first variable
  assert.equal(b.opacity, null);
  assert.equal(b.style, null);  // vmin=9 >= vmax=1 -> rejected
  const none = readStyleParams(new URLSearchParams(''), 'a', 0, base, cmaps);
  assert.equal(none.style, null); assert.equal(none.explicit, false);
});

test('urlString: keeps / : , readable', () => {
  const q = new URLSearchParams(); q.set('store', 's3://b/x.zarr'); q.set('var', 'a,b');
  assert.equal(urlString('/p', q), '/p?store=s3://b/x.zarr&var=a,b');
});
