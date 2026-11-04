// Pure functions of the info-panel component: attribute display values (D-55) and the panel sections.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/info-panel/component.js'], {registerComponent: (d) => registered.push(d)});
const attrValue = get('attrValue'), infoSections = get('infoSections');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('registers one component named info-panel', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'info-panel');
});

test('attrValue: scalars, lists, objects, null, long strings', () => {
  assert.equal(attrValue(true), 'True');
  assert.equal(attrValue(false), 'False');
  assert.equal(attrValue(1.5), 1.5);
  assert.equal(attrValue(NaN), 'NaN');
  assert.equal(attrValue('abc'), 'abc');
  assert.equal(attrValue(['a', 2, {k: 1}]), 'a, 2, {"k":1}');
  assert.equal(attrValue({k: [1]}), '{"k":[1]}');
  assert.equal(attrValue(null), 'None');
  const long = attrValue('x'.repeat(2500));
  assert.equal(long.length, 2001);
  assert.ok(long.endsWith('…'));
});

const cfg = {title: 'sst.zarr', source: 's3://b/sst.zarr', crs: {name: 'EPSG:4326'}, bbox: [-10.5, 30, 10, 50.123456789],
  variables: [{name: 'a'}, {name: 'b'}], dims: {time: {size: 12}}, levels: 3, attrs: {title: 'SST', n: 2, flag: true}};

test('infoSections: metadata rows and global attributes', () => {
  const [meta, attrs] = plain(infoSections(cfg, false, (v) => v.name));
  assert.equal(meta.title, 'Metadata');
  assert.deepEqual(meta.rows, [['Title', 'sst.zarr'], ['Store', 's3://b/sst.zarr'], ['CRS', 'EPSG:4326'],
    ['Bbox', '-10.5, 30, 10, 50.12346'], ['Variables (2)', 'a, b', 'info-vars'], ['Dimension time', '12 steps'], ['Levels', 3]]);
  assert.equal(attrs.title, 'Global attributes');
  assert.deepEqual(attrs.rows, [['title', 'SST'], ['n', 2], ['flag', 'True']]);
});

test('infoSections: blank viewer has no variables or attributes', () => {
  const blank = {title: '', source: '', crs: {name: 'EPSG:4326'}, bbox: [-180, -90, 180, 90], variables: [], dims: {}, attrs: {}, levels: 0};
  const out = plain(infoSections(blank, true, (v) => v.name));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].rows.map((r) => r[0]), ['Store', 'CRS', 'Bbox']);
});
