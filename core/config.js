// Store handling, ported from the reference: noHeadSuffixReads, storeError, publicStoreUrl, attrLimits, browserConfig,
// openStore (D-35: the browser reads the store, no Python config path). Nothing here touches the DOM.

// Serve suffix ranges (shard indexes) as one `Range: bytes=-N` GET instead of HEAD + explicit range (D-56). Idempotent.
function noHeadSuffixReads(FetchStore) {
  const proto = FetchStore.prototype;
  if (proto.noHead) return;
  const getRange = proto.getRange;
  proto.getRange = function (key, range, opts) {
    if (!('suffixLength' in range)) return getRange.call(this, key, range, opts);
    return this.get(key, {...opts, headers: {...opts?.headers, Range: `bytes=-${range.suffixLength}`}});
  };
  proto.noHead = true;
}

function storeError(message, hint = '', code = 'error') {
  const e = new Error(message); e.hint = hint; e.code = code; return e;
}

// Config of a viewer without a store: global EPSG:4326 view, basemaps only.
function blankConfig() {
  return {title: '', source: '', store_url: '', endpoint: '', variables: [], dims: {}, attrs: {}, levels: 0,
    bbox: [-180, -90, 180, 90], global: true,
    crs: {code: 'EPSG:4326', name: 'EPSG:4326', proj4: null, projection: null}};
}

// Static hosting reads public stores in the browser. Returns the https URL of a store given as s3://, gs://, https://
// or a path relative to the page.
function publicStoreUrl(src, endpoint) {
  if (/^file:/i.test(src)) throw storeError('Serve the store over HTTP to open it here.',
    'Use a URL or a path relative to this page; local filesystem paths cannot be read by a web page.', 'unsupported_scheme');
  if (/^s3:\/\//i.test(src)) {
    const u = new URL(src);
    const base = endpoint ? endpoint.replace(/\/$/, '') + '/' + u.hostname : `https://${u.hostname}.s3.amazonaws.com`;
    return base + u.pathname;
  }
  if (/^(gs|gcs):\/\//i.test(src)) { const u = new URL(src); return `https://storage.googleapis.com/${u.hostname}${u.pathname}`; }
  const u = new URL(src, location.href);
  if (!/^https?:$/.test(u.protocol)) throw storeError('Use an HTTP(S) GeoZarr URL.', '', 'unsupported_scheme');
  return u.href.replace(/\/$/, '');
}

// The spec's `relay` is a URL prefix (e.g. "/proxy/", scripts/serve.py) for stores without CORS rules: it is put in
// front of cross-origin http(s) store URLs; same-origin URLs are left alone.
function relayUrl(url, relay) {
  if (!relay || !/^https?:\/\//i.test(url)) return url;
  if (new URL(url).origin === location.origin) return url;
  return relay + url;
}

// D-43 (mirrors preview._attr_limits): the vmin/vmax attrs override the computed limits; if both are given
// and vmax <= vmin, both are ignored, otherwise vmax <= vmin becomes vmin + 1.
const attrNum = (x) => typeof x === 'number' && Number.isFinite(x) ? x : null;
function attrLimits(a, vmin, vmax, name) {
  let lo = attrNum(a.vmin), hi = attrNum(a.vmax);
  if (lo !== null && hi !== null && hi <= lo) {
    console.warn(`${name}: vmax <= vmin in attrs (${lo} >= ${hi}), ignoring both`);
    lo = hi = null;
  }
  if (lo !== null) vmin = lo;
  if (hi !== null) vmax = hi;
  return [vmin, vmax <= vmin ? vmin + 1 : vmax];
}
// D-53 (mirrors preview._has_attr_limits): true when attrLimits takes a limit from the attrs.
function hasAttrLimits(a) {
  const lo = attrNum(a.vmin), hi = attrNum(a.vmax);
  if (lo !== null && hi !== null && hi <= lo) return false;
  return lo !== null || hi !== null;
}

// D-55: attribute display values, mirroring `_attr_value` in preview.py.
function attrValue(x) {
  let out;
  if (typeof x === 'boolean') out = x ? 'True' : 'False';
  else if (typeof x === 'number') out = Number.isFinite(x) ? x : String(x);
  else if (typeof x === 'string') out = x;
  else if (Array.isArray(x)) out = x.map((i) => typeof i === 'string' ? i : (i && typeof i === 'object' ? JSON.stringify(i) : String(i))).join(', ');
  else if (x && typeof x === 'object') out = JSON.stringify(x);
  else out = x == null ? 'None' : String(x);
  return typeof out === 'string' && out.length > 2000 ? out.slice(0, 2000) + '…' : out;
}

// Reads the GeoZarr pyramid metadata in the browser and returns the dataset config (variables with default limits,
// dims with ISO labels, crs, bbox). `relay`: see relayUrl.
async function browserConfig(src, endpoint, relay) {
  const url = new URL(relayUrl(publicStoreUrl(src, endpoint), relay), location.href).href;
  const metadata = async (path) => {
    const res = await fetch(`${url}/${path ? path + '/' : ''}zarr.json`);
    if (!res.ok) throw storeError(`Cannot read GeoZarr metadata (${res.status}).`, 'Check the store URL and public access.', 'not_found');
    return res.json();
  };
  try {
    const root = await metadata('');
    const attrs = root.attributes || {};
    const layout = attrs.multiscales?.layout;
    if (!layout?.length) throw storeError('This store has no GeoZarr multiscales layout.', 'Open a GeoZarr pyramid, rather than a plain Zarr array.', 'not_pyramid');
    const level = String(layout.at(-1).asset);
    const group = root.consolidated_metadata?.metadata?.[level] || await metadata(level);
    const sdims = group.attributes?.['spatial:dimensions'] || attrs['spatial:dimensions'];
    if (!sdims?.length) throw storeError('Missing spatial dimensions.', '', 'invalid_pyramid');
    // Consolidated member metadata avoids directory listings, which static servers cannot provide.
    const members = group.consolidated_metadata?.metadata || Object.fromEntries(
      Object.entries(root.consolidated_metadata?.metadata || {})
        .filter(([path]) => path.startsWith(level + '/'))
        .map(([path, value]) => [path.slice(level.length + 1), value]));
    const order = attrs['geozarr_pyramid_maker:variables'] || [];
    const names = [...new Set([...order, ...Object.keys(members).filter((n) => !n.includes('/'))])];
    if (!names.length) throw storeError('No array metadata is available.', 'Use a store with consolidated metadata or named variables.', 'invalid_pyramid');
    const zarr = await import(ZARRITA_URL);
    noHeadSuffixReads(zarr.FetchStore);
    const zr = zarr.root(new zarr.FetchStore(url, {useSuffixRequest: true}));
    const variables = [], dims = {};
    for (const name of names) {
      const meta = members[name] || await metadata(`${level}/${name}`);
      const dn = meta.dimension_names || [];
      if (meta.node_type !== 'array' || !sdims.every((d) => dn.includes(d))) continue;
      const a = meta.attributes || {}, extra = dn.filter((d) => !sdims.includes(d));
      const arr = await zarr.open(zr.resolve(`${level}/${name}`), {kind: 'array'});
      const sample = await zarr.get(arr, dn.map((d) => extra.includes(d) ? 0 : null));
      const values = Array.from(sample.data, Number).filter((v) => Number.isFinite(v) && v !== meta.fill_value).sort((a, b) => a - b);
      const categorical = a.resampling_method === 'mode' || /^(u?int|bool)/.test(meta.data_type);
      const quantile = (p) => {
        const i = (values.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
        return values[lo] + (values[hi] - values[lo]) * (i - lo);
      };
      let vmin = values.length ? (categorical ? values[0] : quantile(.02)) : 0;
      let vmax = values.length ? (categorical ? values.at(-1) : quantile(.98)) : 1;
      if (vmax <= vmin) vmax = vmin + 1;
      // D-43: plot defaults from the attrs (categorical ignores them); `cmap` is resolved later, in defaultStyle.
      if (!categorical) [vmin, vmax] = attrLimits(a, vmin, vmax, name);
      const v = {name, dims: extra, categorical, units: String(a.units || ''), long_name: String(a.long_name || ''),
        display_name: String(a.long_name || name), vmin, vmax,
        limits_from_attrs: !categorical && hasAttrLimits(a),
        attrs: Object.fromEntries(Object.entries(a).map(([k, x]) => [k, attrValue(x)]))};
      if (!categorical && a.cmap != null) v.cmap = String(a.cmap);
      if (categorical) {
        v.values = [...new Set(values)].slice(0, 20);
        const palette = [[31,119,180],[255,127,14],[44,160,44],[214,39,40],[148,103,189],[140,86,75],[227,119,194],[127,127,127],[188,189,34],[23,190,207]];
        v.palette = v.values.map((n, i) => [n, palette[i % palette.length]]);
      }
      variables.push(v);
      for (const d of extra) {
        if (dims[d]) continue;
        const size = meta.shape[dn.indexOf(d)];
        dims[d] = {size, labels: null, iso: null};
        if (size > 5000) continue;
        try {
          const coord = await zarr.open(zr.resolve(`${level}/${d}`), {kind: 'array'});
          const data = Array.from((await zarr.get(coord)).data);
          const units = coord.attrs.units || '';
          const match = /^(seconds?|minutes?|hours?|days?) since (.+)$/i.exec(units);
          const calendar = coord.attrs.calendar || 'standard';
          if (match && ['standard', 'gregorian', 'proleptic_gregorian'].includes(calendar)) {
            const scale = {second: 1000, minute: 60000, hour: 3600000, day: 86400000}[match[1].toLowerCase().replace(/s$/, '')];
            let epoch = match[2].trim().replace(' ', 'T');
            if (!epoch.includes('T')) epoch += 'T00:00:00';
            if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(epoch)) epoch += 'Z';
            const origin = Date.parse(epoch);
            if (Number.isFinite(origin)) dims[d].iso = data.map((x) => new Date(origin + Number(x) * scale).toISOString());
          }
          dims[d].labels = dims[d].iso || data.map(String);
        } catch (_) { /* index controls work without coordinate arrays */ }
      }
    }
    if (!variables.length) throw storeError('No plottable spatial variables found.', '', 'invalid_pyramid');
    const code = attrs['proj:code'];
    const definition = attrs['proj:wkt2'] || attrs['proj:projjson'];
    if (!code && !definition) throw storeError('Missing CRS metadata.', '', 'invalid_pyramid');
    const name = code || 'GPM:custom';
    const builtin = ['EPSG:4326', 'EPSG:3857'].includes(code);
    if (!builtin && !definition) throw storeError(`No CRS definition for ${code}.`, 'Include proj:wkt2 metadata.', 'invalid_pyramid');
    const bbox = attrs['spatial:bbox'] || group.attributes?.['spatial:bbox'];
    if (!Array.isArray(bbox) || bbox.length !== 4) throw storeError('Missing spatial bounding box.', '', 'invalid_pyramid');
    return {...blankConfig(), title: src.split('/').filter(Boolean).at(-1), source: src, store_url: url, endpoint: endpoint || '',
      variables, dims, attrs: Object.fromEntries(Object.entries(attrs).filter(([k]) =>
        !['multiscales', 'zarr_conventions', 'geozarr_pyramid_maker:variables'].includes(k) && !/^(proj|spatial):/.test(k))
        .map(([k, x]) => [k, attrValue(x)])),
      levels: layout.length, bbox, global: code === 'EPSG:4326' && Math.abs(bbox[2] - bbox[0] - 360) < 1e-6,
      crs: {code, name, proj4: builtin ? null : definition, projection: builtin ? null : name}};
  } catch (e) {
    if (e.code) throw e;
    throw storeError(`Cannot open the GeoZarr store: ${e.message}`,
      'Check its metadata and codecs. Remote stores must allow CORS and HTTP Range requests (or use the spec option `relay`).', 'browser_blocked');
  }
}

// Opens a store: validates it by reading its metadata.
const openStore = (src, endpoint, relay) => browserConfig(src, endpoint, relay);
