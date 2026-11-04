// Pure functions of the store-picker component: what Enter does with the field values.
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const registered = [];
const get = load(['core/util.js', 'components/store-picker/component.js'], {registerComponent: (d) => registered.push(d)});
const isS3Path = get('isS3Path'), submitAction = get('submitAction');
const plain = (x) => JSON.parse(JSON.stringify(x));
const cfg = {source: 's3://b/x.zarr', endpoint: 'https://e.org'};

test('registers one component named store-picker', () => {
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'store-picker');
});

test('isS3Path: s3:// only, case-insensitive, trimmed', () => {
  assert.equal(isS3Path(' S3://b/x'), true);
  assert.equal(isS3Path('https://b/x'), false);
  assert.equal(isS3Path(''), false);
});

test('submitAction: empty -> blank viewer', () => {
  assert.deepEqual(plain(submitAction('  ', '', cfg, null)), {action: 'blank'});
});

test('submitAction: unchanged store and endpoint -> nothing, unless the store failed to open', () => {
  assert.deepEqual(plain(submitAction('s3://b/x.zarr', 'https://e.org', cfg, null)), {action: 'same'});
  assert.equal(submitAction('s3://b/x.zarr', 'https://e.org', cfg, new Error('x')).action, 'open');
});

test('submitAction: new store opens; the endpoint only counts for s3:// paths', () => {
  assert.deepEqual(plain(submitAction(' s3://b/y.zarr ', ' https://f.org ', cfg, null)),
    {action: 'open', src: 's3://b/y.zarr', endpoint: 'https://f.org'});
  assert.deepEqual(plain(submitAction('https://h/y.zarr', 'https://f.org', cfg, null)),
    {action: 'open', src: 'https://h/y.zarr', endpoint: ''});
  assert.equal(submitAction('s3://b/x.zarr', 'https://other', cfg, null).action, 'open');
});
