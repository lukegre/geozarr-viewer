// Store handling of core/config.js: URL resolution, relay prefix, attr limits (D-43), attr display values (D-55), no-HEAD reads (D-56).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./_load.cjs');

const get = load(['core/util.js', 'core/config.js'], {location: {href: 'http://localhost:8780/viewer.html', origin: 'http://localhost:8780'}});
const publicStoreUrl = get('publicStoreUrl'), relayUrl = get('relayUrl');
const attrLimits = get('attrLimits'), hasAttrLimits = get('hasAttrLimits'), attrValue = get('attrValue');
const noHeadSuffixReads = get('noHeadSuffixReads');
const plain = (x) => JSON.parse(JSON.stringify(x));

test('publicStoreUrl: s3 with endpoint, s3 without, gs, https, relative', () => {
  assert.equal(publicStoreUrl('s3://bucket/a/b.zarr', 'https://os.example.ch/'), 'https://os.example.ch/bucket/a/b.zarr');
  assert.equal(publicStoreUrl('s3://bucket/a/b.zarr', ''), 'https://bucket.s3.amazonaws.com/a/b.zarr');
  assert.equal(publicStoreUrl('gs://bucket/x.zarr'), 'https://storage.googleapis.com/bucket/x.zarr');
  assert.equal(publicStoreUrl('https://h.org/x.zarr/'), 'https://h.org/x.zarr');
  assert.equal(publicStoreUrl('data/x.zarr'), 'http://localhost:8780/data/x.zarr');
});

test('publicStoreUrl: unsupported schemes carry a code and a hint', () => {
  for (const src of ['file:///tmp/x.zarr', 'ftp://h/x']) {
    assert.throws(() => publicStoreUrl(src), (e) => e.code === 'unsupported_scheme' && typeof e.hint === 'string');
  }
});

test('relayUrl: prefixes cross-origin http(s) URLs only', () => {
  assert.equal(relayUrl('https://os.example.ch/b/x.zarr', '/proxy/'), '/proxy/https://os.example.ch/b/x.zarr');
  assert.equal(relayUrl('https://os.example.ch/b/x.zarr', ''), 'https://os.example.ch/b/x.zarr');
  assert.equal(relayUrl('https://os.example.ch/b/x.zarr', undefined), 'https://os.example.ch/b/x.zarr');
  assert.equal(relayUrl('http://localhost:8780/data/x.zarr', '/proxy/'), 'http://localhost:8780/data/x.zarr');
});

test('attrLimits: attrs override the computed limits (D-43)', () => {
  assert.deepEqual(plain(attrLimits({}, 1, 9, 'v')), [1, 9]);
  assert.deepEqual(plain(attrLimits({vmin: 0}, 1, 9, 'v')), [0, 9]);
  assert.deepEqual(plain(attrLimits({vmax: 5}, 1, 9, 'v')), [1, 5]);
  assert.deepEqual(plain(attrLimits({vmin: 2, vmax: 4}, 1, 9, 'v')), [2, 4]);
  assert.deepEqual(plain(attrLimits({vmax: 0.5}, 1, 9, 'v')), [1, 2]);  // vmax <= vmin -> vmin + 1
  assert.deepEqual(plain(attrLimits({vmin: 'x', vmax: NaN}, 1, 9, 'v')), [1, 9]);
});

test('attrLimits: both given with vmax <= vmin are ignored with a warning', () => {
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try { assert.deepEqual(plain(attrLimits({vmin: 5, vmax: 3}, 1, 9, 'v')), [1, 9]); } finally { console.warn = warn; }
  assert.equal(warned, 1);
});

test('hasAttrLimits', () => {
  assert.equal(hasAttrLimits({}), false);
  assert.equal(hasAttrLimits({vmin: 1}), true);
  assert.equal(hasAttrLimits({vmax: 1}), true);
  assert.equal(hasAttrLimits({vmin: 5, vmax: 3}), false);
});

test('attrValue: display strings (D-55)', () => {
  assert.equal(attrValue(true), 'True');
  assert.equal(attrValue(null), 'None');
  assert.equal(attrValue(3.5), 3.5);
  assert.equal(attrValue(['a', 1, {k: 1}]), 'a, 1, {"k":1}');
  assert.equal(attrValue({a: 1}), '{"a":1}');
  assert.equal(attrValue('x'.repeat(2500)).length, 2001);
});

test('noHeadSuffixReads: suffix ranges become one GET with a Range header (D-56), idempotent', async () => {
  const calls = [];
  class FetchStore {
    async get(key, opts) { calls.push(['get', key, opts]); return 'bytes'; }
    async getRange(key, range, opts) { calls.push(['range', key, range]); return 'orig'; }
  }
  noHeadSuffixReads(FetchStore);
  const first = FetchStore.prototype.getRange;
  noHeadSuffixReads(FetchStore);
  assert.equal(FetchStore.prototype.getRange, first);
  const s = new FetchStore();
  assert.equal(await s.getRange('/c/0', {suffixLength: 64}), 'bytes');
  assert.deepEqual(plain(calls.at(-1)), ['get', '/c/0', {headers: {Range: 'bytes=-64'}}]);
  assert.equal(await s.getRange('/c/0', {offset: 1, length: 2}), 'orig');
});
