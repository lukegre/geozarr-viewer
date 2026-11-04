// Horizontal timeline for the dim whose role is 'h'. Reference: buildScrubber/buildTimeline (rebuilt when the dims
// or roles change), stepPositions, dateTicks, indexTicks, stopPlay, scrubKeyDown (D-50), syncRoles (D-40).
// Roles live in app.state.roles ('h' | 'v' | 'off'); without dim-roles the defaults apply (first dim h).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dimLabel = (d, i) => (d.labels && d.labels[i] !== undefined ? d.labels[i] : String(i));

// Keep the role of every dim that has one; a new dim is horizontal only if no dim holds that role (D-40).
// Same function in dim-sliders and dim-roles: it is idempotent, so the order the components run in does not matter.
function syncRoles(dimNames, roles) {
  let holder = dimNames.find((d) => roles[d] === 'h');
  for (const d of dimNames) {
    if (!roles[d]) roles[d] = holder === undefined ? 'h' : 'v';
    if (roles[d] === 'h') { if (holder === undefined) holder = d; else if (holder !== d) roles[d] = 'v'; }
  }
  return roles;
}

// Position of every step along the rail, 0..1: proportional to time for ISO dims, else evenly spaced.
function stepPositions(d) {
  const n = d.size;
  if (d.iso && d.iso.length === n && n > 1) {
    const t = d.iso.map((s) => Date.parse(s));
    if (t.every(Number.isFinite)) {
      const lo = Math.min(...t), hi = Math.max(...t);
      if (hi > lo) return {pos: t.map((x) => (x - lo) / (hi - lo)), timed: true, lo, hi};
    }
  }
  return {pos: Array.from({length: n}, (_, i) => (n > 1 ? i / (n - 1) : 0)), timed: false};
}

// Major ticks of a time axis: years (> 2 years of data) or months, about 10 labels at most.
function dateTicks(lo, hi) {
  const out = [];
  const spanDays = (hi - lo) / 864e5;
  const first = new Date(lo);
  if (spanDays > 730) {
    const years = spanDays / 365.25;
    const step = [1, 2, 5, 10, 20, 50, 100].find((s) => years / s <= 10) || 100;
    let y = first.getUTCFullYear();
    if (Date.UTC(y, 0, 1) < lo) y += 1;
    y = Math.ceil(y / step) * step;
    for (; Date.UTC(y, 0, 1) <= hi; y += step) out.push({t: Date.UTC(y, 0, 1), text: String(y)});
  } else {
    const step = [1, 2, 3, 6].find((s) => spanDays / 30.4 / s <= 12) || 6;
    const y = first.getUTCFullYear();
    let m = first.getUTCMonth();
    if (Date.UTC(y, m, 1) < lo) m += 1;
    for (; Date.UTC(y, m, 1) <= hi; m += 1) {
      if ((y * 12 + m) % step) continue;
      const mm = m % 12;
      out.push({t: Date.UTC(y, m, 1), text: MONTHS[mm] + (mm === 0 || !out.length ? ` ${y + Math.floor(m / 12)}` : '')});
    }
  }
  return out;
}

// Major ticks for a plain index (or non-time label) axis: every 1/2/5 x 10^k steps, about 8 labels.
function indexTicks(d, pos) {
  const n = d.size;
  const raw = Math.max(1, n / 8);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let i = 0; i < n; i += step) out.push({p: pos[i], text: dimLabel(d, i)});
  return out;
}

// Index of the step nearest to x (0..1 along the rail), as in the reference's `nearest`.
function nearestStep(pos, x) {
  let best = 0;
  for (let i = 1; i < pos.length; i++) if (Math.abs(pos[i] - x) < Math.abs(pos[best] - x)) best = i;
  return best;
}

registerComponent({
  name: 'timeline',
  init(app, root, opts) {
    const {state, bus} = app;
    root.classList.add('gv-panel');
    root.hidden = true;
    let timer = null, cur = null;  // cur = {name, step} of the built timeline

    const stopPlay = () => {
      if (timer) clearInterval(timer);
      timer = null;
      const b = root.querySelector('.tl-play');
      if (b) { b.innerHTML = ICON.play; b.setAttribute('aria-label', 'Play'); }
    };

    function build() {
      stopPlay();
      cur = null;
      root.replaceChildren();
      const dimNames = app.layers.unionDims();
      syncRoles(dimNames, state.roles);
      const name = dimNames.find((d) => state.roles[d] === 'h');
      root.hidden = !name;
      if (!name) return;
      const d = app.cfg.dims[name], n = d.size;
      state.dims[name] = clamp(state.dims[name] || 0, 0, n - 1);
      const {pos, timed, lo, hi} = stepPositions(d);
      const mkBtn = (icon, label, cls) => {
        const b = h('button', `gv-iconbtn ${cls || ''}`); b.type = 'button'; b.innerHTML = icon; b.setAttribute('aria-label', label); return b;
      };
      const ctl = h('div', 'tl-ctl');
      const prevBtn = mkBtn(ICON.prev, 'Previous step'), nextBtn = mkBtn(ICON.next, 'Next step');
      const playBtn = opts.play !== false ? mkBtn(ICON.play, 'Play', 'tl-play') : null;
      ctl.append(prevBtn, ...(playBtn ? [playBtn] : []), nextBtn);

      const track = h('div', 'tl-track');
      track.append(h('div', 'tl-rail'));
      const addMark = (p, cls) => { const m = h('div', `tl-mark ${cls}`); m.style.left = `${100 * p}%`; track.append(m); };
      if (n <= 60) pos.forEach((p) => addMark(p, 'minor'));
      let major = [];
      if (timed) major = dateTicks(lo, hi).map((k) => ({p: (k.t - lo) / (hi - lo), text: k.text}));
      if (major.length < 2) major = indexTicks(d, pos);
      const labels = [];
      for (const k of major) {
        addMark(k.p, 'major');
        const lab = h('div', 'tl-label', String(k.text));
        lab.style.left = `${100 * k.p}%`;
        track.append(lab);
        labels.push(lab);
      }
      const handle = h('div', 'tl-handle');
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-label', name);
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(n - 1));
      const bubble = h('div', 'tl-bubble');
      track.append(handle, bubble);
      root.append(ctl, h('span', 'tl-name', name), track);

      const render = () => {
        const i = state.dims[name];
        handle.style.left = bubble.style.left = `${100 * pos[i]}%`;
        bubble.textContent = String(dimLabel(d, i));
        handle.setAttribute('aria-valuenow', String(i));
        handle.setAttribute('aria-valuetext', String(dimLabel(d, i)));
      };
      const setStep = (i) => {
        i = clamp(i, 0, n - 1);
        if (i !== state.dims[name]) app.layers.setDim(name, i);  // emits dims:changed -> render
        render();
      };
      const step = (delta) => setStep(state.dims[name] + delta);
      let dragging = false;
      const nearest = (clientX) => {
        const r = track.getBoundingClientRect();
        return nearestStep(pos, r.width ? clamp((clientX - r.left) / r.width, 0, 1) : 0);
      };
      track.addEventListener('pointerdown', (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        handle.style.cursor = 'grabbing';
        stopPlay();
        setStep(nearest(e.clientX));
      });
      track.addEventListener('pointermove', (e) => { if (dragging) setStep(nearest(e.clientX)); });
      const end = () => { dragging = false; handle.style.cursor = ''; };
      track.addEventListener('pointerup', end);
      track.addEventListener('pointercancel', end);
      prevBtn.addEventListener('click', () => { stopPlay(); step(-1); });
      nextBtn.addEventListener('click', () => { stopPlay(); step(1); });
      playBtn?.addEventListener('click', () => {
        if (timer) return stopPlay();
        playBtn.innerHTML = ICON.pause;
        playBtn.setAttribute('aria-label', 'Pause');
        timer = setInterval(() => setStep((state.dims[name] + 1) % n), 1000 / (opts.fps > 0 ? opts.fps : 1.25));
      });

      // hide tick labels that would collide with the previous one
      const layoutLabels = () => {
        let right = -Infinity;
        for (const lab of labels) {
          lab.style.visibility = 'visible';
          const r = lab.getBoundingClientRect();
          if (r.left < right + 6) lab.style.visibility = 'hidden';
          else right = r.right;
        }
      };
      if (window.ResizeObserver) new ResizeObserver(layoutLabels).observe(track);
      else window.addEventListener('resize', layoutLabels);
      cur = {name, step, render};
      render();
      layoutLabels();
    }

    // Arrow keys (D-50): Left/Right step the horizontal dim; ignored while typing in a field or with modifiers.
    if (opts.keys !== false) {
      document.addEventListener('keydown', (e) => {
        if (!cur || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.target && e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
        e.preventDefault();
        stopPlay();
        cur.step(e.key === 'ArrowRight' ? 1 : -1);
      });
      // dim-sliders asks for the same step when Left/Right is pressed on a focused vertical slider
      bus.on('timeline:step', (delta) => { if (cur) { stopPlay(); cur.step(delta); } });
    }

    bus.on('config:loaded', build);
    bus.on('selection:changed', build);
    bus.on('roles:changed', build);
    bus.on('dims:changed', ({dim}) => { if (cur && cur.name === dim) cur.render(); });
  },
});
