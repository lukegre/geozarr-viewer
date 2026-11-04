// Store path / URL input + S3 endpoint. Reference: initStorePicker (D-32, D-35). Submitting validates the store and
// reloads the page on ?store=&endpoint= (app.openStore); an empty field goes back to the blank viewer. Errors go to
// the core's toast (the `error` event) instead of the reference's box in the sidebar.

// True for an s3:// path; only those use the endpoint field.
const isS3Path = (src) => /^s3:\/\//i.test(String(src).trim());

// What Enter does with the field values: 'blank' (cleared), 'same' (nothing to do) or 'open' (+ trimmed src/endpoint).
function submitAction(srcRaw, endpointRaw, cfg, startupError) {
  const src = srcRaw.trim();
  if (!src) return {action: 'blank'};
  const endpoint = isS3Path(src) ? endpointRaw.trim() : '';
  if (src === cfg.source && endpoint === (cfg.endpoint || '') && !startupError) return {action: 'same'};
  return {action: 'open', src, endpoint};
}

registerComponent({
  name: 'store-picker',
  init(app, root, opts) {
    root.dataset.in = root.closest('[data-slot]')?.dataset.slot || '';
    const inp = h('input');
    inp.type = 'text'; inp.id = 'gv-storepath'; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.placeholder = 'Enter a store path or URL…';
    inp.setAttribute('aria-label', 'Store path or URL (press Enter to open)');
    inp.title = 'https:// or s3:// URL of a GeoZarr pyramid, or a path relative to this page. Press Enter to open.';
    root.append(inp);
    let ep = null;
    if (opts.endpoint !== false) {
      ep = h('input');
      ep.type = 'text'; ep.id = 'gv-endpoint'; ep.spellcheck = false; ep.autocomplete = 'off';
      ep.placeholder = 'S3 endpoint URL';
      ep.setAttribute('aria-label', 'S3 endpoint URL');
      ep.title = 'Custom S3 service for s3:// stores. Press Enter to open the store with it.';
      root.append(ep);
    }
    const syncEndpoint = () => { if (ep) ep.hidden = !isS3Path(inp.value); };
    const fill = (src, endpoint) => { inp.value = src; if (ep) ep.value = endpoint; syncEndpoint(); };

    // the field shows the loaded store, or what was asked for when it failed to open
    app.bus.on('config:loaded', (cfg) => {
      const wanted = app.params.get('store');
      if (app.startupError) fill(wanted || '', app.params.get('endpoint') || '');
      else fill(cfg.source, cfg.endpoint || '');
      if (app.blank && !app.startupError) inp.focus();
    });
    inp.addEventListener('input', syncEndpoint);

    async function submit() {
      const r = submitAction(inp.value, ep ? ep.value : '', app.cfg, app.startupError);
      if (r.action === 'same') return;
      if (r.action === 'blank') {
        if (!app.blank) location.assign(`${location.pathname}?store=`);
        return;
      }
      inp.classList.add('busy'); inp.disabled = true; if (ep) ep.disabled = true;
      try {
        await app.openStore(r.src, r.endpoint);  // reloads the page on success
      } catch (err) {
        app.bus.emit('error', err);
      } finally {
        inp.classList.remove('busy'); inp.disabled = false; if (ep) ep.disabled = false; inp.focus();
      }
    }
    const keydown = (e) => {
      if (e.key === 'Escape') {  // back to the loaded store
        fill(app.cfg.source, app.cfg.endpoint || '');
        e.target.blur();
      } else if (e.key === 'Enter') submit();
    };
    inp.addEventListener('keydown', keydown);
    ep?.addEventListener('keydown', keydown);
  },
});
