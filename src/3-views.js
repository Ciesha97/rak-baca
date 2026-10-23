/* ================= Tampilan dokumen mengalir ================= */
/* Satu bagian (bab) dimuat sekaligus. Mode "halaman" memakai kolom CSS yang digeser per halaman,
   mode "gulir" memakai gulir vertikal biasa. Posisi baca disimpan sebagai indeks blok + sisa,
   sehingga tetap tepat walau ukuran huruf atau lebar layar berubah. */
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,pre,figure,figcaption,img,tr,hr,div,section,aside,table,math,svg';
const MEASURE = { sempit: 30, sedang: 36, lebar: 44, penuh: 0 };

class FlowView {
  constructor(host, doc, cb) {
    this.doc = doc; this.cb = cb;
    this.root = el('div', { class: 'flow' });
    this.sc = el('div', { class: 'flow-scroller' });
    this.art = el('article', { class: 'doc', lang: doc.lang || null });
    this.nav = el('div', { class: 'sec-nav' });
    this.endm = el('span', { style: 'display:block;height:0;overflow:hidden' });
    this.sc.append(this.art, this.nav);
    this.root.append(this.sc);
    host.append(this.root);
    this.sec = -1; this.page = 0; this.pages = 1; this.cache = null; this.token = 0; this.geo = null;
    this.texts = new Map();
    this.ro = new ResizeObserver(debounce(() => { if (this.sec >= 0) this.relayout(); }, 120));
    this.ro.observe(this.root);
    this.sc.addEventListener('scroll', () => { if (this.mode === 'scroll') this.reportSoon(); }, { passive: true });
    this.reportSoon = debounce(() => this.report(), 80);
    this.art.addEventListener('load', e => { if (e.target.localName === 'img' && this.mode === 'paged') this.relayoutSoon(); }, true);
    this.relayoutSoon = debounce(() => this.relayout(), 200);
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.bindSwipe();
  }
  destroy() { this.ro.disconnect(); this.token++; this.root.remove(); clearHighlights(); }
  get total() { return this.doc.sections.length; }

  apply(s) {
    const st = this.root.style;
    this.fs = s.fontSize;
    st.setProperty('--fs', s.fontSize + 'px');
    st.setProperty('--lh', s.lineHeight);
    const m = MEASURE[s.measure] ?? 36;
    st.setProperty('--measure', m ? m + 'em' : 'none');
    this.measurePx = m ? m * s.fontSize * 0.98 : Infinity;
    this.art.classList.toggle('font-sans', s.font === 'sans');
    this.art.classList.toggle('font-mono', s.font === 'mono' || !!this.doc.mono);
    this.art.style.setProperty('--ta', s.align === 'rata' ? 'justify' : 'start');
    this.art.classList.toggle('indent', !!s.indent);
    this.mode = this.doc.scrollOnly ? 'scroll' : s.flowMode === 'scroll' ? 'scroll' : 'paged';
    this.twoCols = !!s.twoCols;
    this.root.classList.toggle('paged', this.mode === 'paged');
    this.root.classList.toggle('scroll', this.mode === 'scroll');
    this.root.classList.toggle('wide', !!this.doc.wide);
    if (this.sec >= 0) this.relayout();
  }

  /* ---------- tata letak ---------- */
  layout() {
    this.cache = null;
    const sc = this.sc.style, as = this.art.style;
    if (this.mode !== 'paged') {
      sc.width = sc.height = sc.top = ''; as.transform = as.width = '';
      this.geo = null; this.pages = 1; this.page = 0;
      return;
    }
    const W0 = this.root.clientWidth, H0 = this.root.clientHeight;
    const padx = clamp(W0 * 0.05, 18, 72), pady = W0 < 600 ? 18 : 28;
    const gap = Math.round(clamp(padx * 2, 32, 96));
    const avail = W0 - 2 * padx;
    const mp = Math.min(this.measurePx, 760);
    const cols = this.twoCols && avail > 900 && avail >= 2 * Math.min(mp, 520) + gap ? 2 : 1;
    const W = Math.floor(cols === 2 ? Math.min(avail, 2 * mp + gap) : Math.min(avail, this.measurePx));
    const H = Math.max(120, Math.floor(H0 - 2 * pady));
    sc.width = W + 'px'; sc.height = H + 'px'; sc.top = pady + 'px';
    as.width = W + 'px';
    as.setProperty('--cols', cols); as.setProperty('--gap', gap + 'px'); as.setProperty('--ph', Math.floor(H * 0.94) + 'px');
    this.geo = { W, H, gap, cols, step: W + gap };
    this.pages = this.countPages();
    this.page = clamp(this.page, 0, this.pages - 1);
    this.applyPage();
  }
  countPages() {
    const r = this.endm.getBoundingClientRect(), a = this.art.getBoundingClientRect();
    return Math.max(1, Math.floor((r.left - a.left + 1) / this.geo.step) + 1);
  }
  applyPage() { if (this.geo) this.art.style.transform = `translateX(${-this.page * this.geo.step}px)`; }
  relayout() {
    if (this.sec < 0) return;
    const pos = this.pos();
    this.layout();
    this.restore(pos);
    this.report();
  }

  /* ---------- blok & posisi ---------- */
  blocks() {
    if (!this.cache) this.cache = Array.from(this.art.querySelectorAll(BLOCK_SEL)).filter(e => !e.querySelector(BLOCK_SEL) && !e.closest('aside[data-fn]') && e !== this.endm);
    return this.cache;
  }
  pos() {
    const bl = this.blocks();
    if (!bl.length) return { s: this.sec, b: 0, o: 0 };
    let lo = 0, hi = bl.length - 1, ans = bl.length - 1;
    if (this.mode === 'paged') {
      const left = this.sc.getBoundingClientRect().left + 2;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (bl[m].getBoundingClientRect().right > left) { ans = m; hi = m - 1; } else lo = m + 1; }
      const rects = Array.from(bl[ans].getClientRects()).filter(r => r.width || r.height);
      const tot = rects.reduce((t, r) => t + r.height, 0);
      const before = rects.filter(r => r.right <= left).reduce((t, r) => t + r.height, 0);
      return { s: this.sec, b: ans, o: tot ? clamp(before / tot, 0, 0.999) : 0 };
    }
    const top = this.sc.getBoundingClientRect().top + 4;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (bl[m].getBoundingClientRect().bottom > top) { ans = m; hi = m - 1; } else lo = m + 1; }
    const r = bl[ans].getBoundingClientRect();
    return { s: this.sec, b: ans, o: r.height ? clamp((top - r.top) / r.height, 0, 0.999) : 0 };
  }
  restore(p) {
    if (!p) return;
    const bl = this.blocks();
    const b = bl[clamp(p.b | 0, 0, bl.length - 1)];
    if (!b) { this.toStart(); return; }
    this.showEl(b, p.o || 0);
  }
  /* tampilkan elemen (pada pecahan tinggi o) di halaman/gulir saat ini */
  showEl(e, o = 0, center = false) {
    if (this.mode === 'paged') {
      const rects = Array.from(e.getClientRects()).filter(r => r.width || r.height);
      let r = rects[0] || e.getBoundingClientRect();
      if (rects.length > 1 && o > 0) {
        const tot = rects.reduce((t, x) => t + x.height, 0);
        let acc = 0;
        for (const x of rects) { if ((acc + x.height) / tot > o) { r = x; break; } acc += x.height; }
      }
      const a = this.art.getBoundingClientRect();
      this.page = clamp(Math.floor((r.left - a.left + 2) / this.geo.step), 0, this.pages - 1);
      this.applyPage();
    } else {
      const r = e.getBoundingClientRect(), s = this.sc.getBoundingClientRect();
      const off = center ? this.sc.clientHeight / 3 : 8;
      this.sc.scrollTop += r.top - s.top + o * r.height - off;
    }
  }
  showRange(range) {
    const rects = Array.from(range.getClientRects());
    const r = rects[0] || range.getBoundingClientRect();
    if (this.mode === 'paged') {
      const a = this.art.getBoundingClientRect();
      this.page = clamp(Math.floor((r.left - a.left + 2) / this.geo.step), 0, this.pages - 1);
      this.applyPage();
    } else {
      const s = this.sc.getBoundingClientRect();
      if (r.top < s.top + 20 || r.bottom > s.bottom - 20) this.sc.scrollTop += r.top - s.top - this.sc.clientHeight / 3;
    }
  }
  isVisible(e) {
    const r = e.getBoundingClientRect(), s = this.sc.getBoundingClientRect();
    if (this.mode === 'paged') return r.left >= s.left - 2 && r.left < s.right;
    return r.bottom > s.top && r.top < s.bottom - 20;
  }
  toStart() { this.page = 0; this.applyPage(); this.sc.scrollTop = 0; }
  toEnd() { this.page = this.pages - 1; this.applyPage(); this.sc.scrollTop = this.sc.scrollHeight; }

  /* ---------- memuat bagian ---------- */
  async show(s, at) {
    s = clamp(s | 0, 0, this.total - 1);
    const tok = ++this.token;
    if (s !== this.sec) {
      this.cb.loading?.(true);
      this.busy = true;
      let frag;
      try { frag = await this.doc.sections[s].load(); } finally { if (tok === this.token) { this.cb.loading?.(false); this.busy = false; } }
      if (tok !== this.token) return;
      clearHighlights();
      this.art.replaceChildren(frag, this.endm);
      this.sec = s; this.cache = null; this.page = 0; this.sc.scrollTop = 0;
      const imgs = Array.from(this.art.querySelectorAll('img'));
      if (imgs.length) await Promise.race([Promise.all(imgs.map(i => i.decode().catch(() => {}))), sleep(1200)]);
      if (tok !== this.token) return;
      this.renderNav();
      this.layout();
    }
    this.go(at);
    this.report();
  }
  go(at) {
    if (!at) this.toStart();
    else if (at === 'end') this.toEnd();
    else if (at.anc) {
      const t = this.art.querySelector(`[id="${CSS.escape(at.anc)}"]`);
      if (t) this.showEl(t); else this.toStart();
    } else if (at.frac != null) {
      if (this.mode === 'paged') { this.page = clamp(Math.round(at.frac * (this.pages - 1)), 0, this.pages - 1); this.applyPage(); }
      else this.sc.scrollTop = at.frac * (this.sc.scrollHeight - this.sc.clientHeight);
    } else if (at.b != null) this.restore(at);
  }
  renderNav() {
    this.nav.replaceChildren();
    if (this.sec > 0) { const b = el('button', { class: 'btn' }); b.innerHTML = icon('left') + 'Bagian sebelumnya'; b.onclick = () => this.show(this.sec - 1, 'end'); this.nav.append(b); }
    else this.nav.append(el('span'));
    if (this.sec < this.total - 1) { const b = el('button', { class: 'btn' }); b.innerHTML = 'Bagian berikutnya' + icon('right'); b.onclick = () => this.show(this.sec + 1); this.nav.append(b); }
  }

  /* ---------- navigasi ---------- */
  next() {
    if (this.busy) return true;
    if (this.mode === 'paged') {
      if (this.page < this.pages - 1) { this.page++; this.applyPage(); this.report(); return true; }
    } else {
      const max = this.sc.scrollHeight - this.sc.clientHeight - this.nav.offsetHeight;
      if (this.sc.scrollTop < max - 4) { this.sc.scrollBy({ top: this.sc.clientHeight * 0.9 }); return true; }
    }
    if (this.sec < this.total - 1) { this.show(this.sec + 1); return true; }
    return false;
  }
  prev() {
    if (this.busy) return true;
    if (this.mode === 'paged') {
      if (this.page > 0) { this.page--; this.applyPage(); this.report(); return true; }
    } else if (this.sc.scrollTop > 4) { this.sc.scrollBy({ top: -this.sc.clientHeight * 0.9 }); return true; }
    if (this.sec > 0) { this.show(this.sec - 1, 'end'); return true; }
    return false;
  }
  weights() {
    if (!this._w) { let acc = 0; this._w = this.doc.sections.map(s => { const a = acc; acc += s.weight; return a; }); this._wt = acc; }
    return this._w;
  }
  secFrac() {
    if (this.mode === 'paged') return (this.page + 1) / this.pages;
    const h = this.sc.scrollHeight - this.nav.offsetHeight;
    return h > 0 ? clamp((this.sc.scrollTop + this.sc.clientHeight) / h, 0, 1) : 1;
  }
  progress() {
    const w = this.weights();
    if (this.sec < 0) return 0;
    return clamp((w[this.sec] + this.doc.sections[this.sec].weight * this.secFrac()) / this._wt, 0, 1);
  }
  seek(f) {
    const w = this.weights();
    const x = f * this._wt;
    let s = 0;
    while (s < w.length - 1 && w[s + 1] <= x) s++;
    const inner = clamp((x - w[s]) / this.doc.sections[s].weight, 0, 1);
    this.show(s, { frac: inner });
  }
  label() {
    const sec = this.doc.sections[this.sec];
    const pct = Math.round(this.progress() * 100) + '%';
    return {
      pos: this.mode === 'paged' ? `${this.page + 1}/${this.pages} · ${pct}` : pct,
      sub: this.total > 1 ? sec?.title || `Bagian ${this.sec + 1}` : '',
    };
  }
  report() { this.cb.change?.(); }

  /* ---------- teks, pencarian, sorotan ---------- */
  async sectionText(i) {
    if (!this.texts.has(i)) this.texts.set(i, this.doc.sections[i].load({ textOnly: true }).then(f => f.textContent).catch(() => ''));
    return this.texts.get(i);
  }
  textMap() {
    const nodes = [], starts = [];
    let pos = 0;
    const w = document.createTreeWalker(this.art, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push(n); starts.push(pos); pos += n.data.length; }
    return { nodes, starts, text: nodes.map(n => n.data).join('') };
  }
  rangeOf(map, a, b) {
    const at = x => {
      let lo = 0, hi = map.starts.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (map.starts[m] <= x) lo = m; else hi = m - 1; }
      return [map.nodes[lo], x - map.starts[lo]];
    };
    const r = document.createRange();
    const [n1, o1] = at(a), [n2, o2] = at(Math.max(a, b - 1));
    r.setStart(n1, o1); r.setEnd(n2, o2 + 1);
    return r;
  }
  async showHit(sec, q, nth) {
    await this.show(sec, null);
    const map = this.textMap();
    const hits = findAll(map.text, q, 5000);
    if (!hits.length) return;
    const ranges = hits.map(([a, b]) => this.rangeOf(map, a, b));
    const cur = ranges[clamp(nth, 0, ranges.length - 1)];
    setHighlight('rb-hit', ranges);
    setHighlight('rb-cur', [cur]);
    this.showRange(cur);
    this.report();
  }

  /* ---------- interaksi ---------- */
  onClick(e) {
    const a = e.target.closest('a');
    if (a && this.art.contains(a)) {
      if (a.hasAttribute('data-ext')) return;
      e.preventDefault();
      const sec = a.dataset.sec === '' || a.dataset.sec == null ? this.sec : +a.dataset.sec;
      const anc = a.dataset.anc || '';
      if (a.hasAttribute('data-note') || isNoteLike(a)) { this.note(sec, anc, a); return; }
      if (a.hasAttribute('data-sec') || anc) { this.cb.jump?.(); this.show(sec, anc ? { anc } : null); }
      return;
    }
    if (this.mode !== 'paged' || this.swiped) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    if (e.target.closest('button,video,audio,summary')) return;
    const x = e.clientX - this.root.getBoundingClientRect().left, w = this.root.clientWidth;
    if (x < w * 0.25) this.prev(); else if (x > w * 0.75) this.next(); else this.cb.tap?.();
  }
  async note(sec, anc, a) {
    let target = null;
    if (sec === this.sec) target = this.art.querySelector(`[id="${CSS.escape(anc)}"]`);
    else { try { const f = await this.doc.sections[sec].load(); target = f.querySelector(`[id="${CSS.escape(anc)}"]`); } catch (e) { /* abaikan */ } }
    if (!target) { if (anc) this.show(sec, { anc }); return; }
    let box = target;
    if (!box.textContent.trim() || box.localName === 'a' || box.localName === 'span') box = box.closest('li,aside,p,div,section,dd,td') || box.parentElement || box;
    if (box.textContent.length > 4000) { this.show(sec, { anc }); return; }
    this.cb.note?.(box.cloneNode(true), () => this.show(sec, { anc }));
  }
  onWheel(e) {
    if (this.mode !== 'paged' || e.ctrlKey) return;
    e.preventDefault();
    const now = Date.now();
    if (now - (this.lastWheel || 0) < 280 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
    this.lastWheel = now;
    if ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0) this.next(); else this.prev();
  }
  bindSwipe() {
    let sx = 0, sy = 0, st = 0, id = null;
    this.root.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') return; id = e.pointerId; sx = e.clientX; sy = e.clientY; st = Date.now(); this.swiped = false; });
    this.root.addEventListener('pointerup', e => {
      if (e.pointerId !== id || this.mode !== 'paged') return;
      id = null;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) {
        this.swiped = true; setTimeout(() => { this.swiped = false; }, 350);
        if (dx < 0) this.next(); else this.prev();
      }
    });
  }
}
const isNoteLike = a => /^\s*[[(]?(\d{1,3}|[*†‡§]+|[ivx]{1,4})[\])]?\s*$/i.test(a.textContent) && (a.closest('sup') || a.querySelector('sup') || /^\s*\[/.test(a.textContent));
const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
function setHighlight(name, ranges) { if (HL) { if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges)); else CSS.highlights.delete(name); } }
function clearHighlights() { if (HL) for (const n of ['rb-hit', 'rb-cur', 'rb-tts', 'rb-note']) CSS.highlights.delete(n); }

/* ================= Tampilan halaman tetap (PDF, gambar, komik) ================= */
class FixedView {
  constructor(host, doc, view, cb) {
    this.doc = doc; this.cb = cb;
    this.mode = view.mode || (doc.preferSingle ? 'single' : 'scroll');
    this.zoom = view.zoom || (this.mode === 'single' ? 'page' : 'auto');
    this.root = el('div', { class: 'fixed ' + this.mode });
    this.sc = el('div', { class: 'fx-scroller', tabindex: '-1' });
    this.box = el('div', { class: 'fx-pages', style: 'position:relative' });
    this.sc.append(this.box);
    this.root.append(this.sc);
    host.append(this.root);
    this.cur = 0; this.scale = 1; this.rendered = new Set(); this.want = new Set(); this.busy = 0;
    this.pg = [];
    const f = document.createDocumentFragment();
    for (let i = 0; i < doc.pageCount; i++) {
      const p = el('div', { class: 'pgv' + (doc.format === 'pdf' ? '' : ' img'), 'data-i': i }, el('span', { class: 'num', text: String(i + 1) }));
      this.pg.push(p); f.append(p);
    }
    this.box.append(f);
    this.io = new IntersectionObserver(es => {
      for (const e of es) {
        const i = +e.target.dataset.i;
        if (e.isIntersecting) this.want.add(i); else { this.want.delete(i); if (Math.abs(i - this.cur) > 4) this.unrender(i); }
      }
      this.pump();
    }, { root: this.sc, rootMargin: '100% 0px 100% 0px' });
    this.pg.forEach(p => this.io.observe(p));
    this.sc.addEventListener('scroll', () => { if (this.mode === 'scroll' && !this.lock) this.trackSoon(); }, { passive: true });
    this.trackSoon = debounce(() => this.track(), 60);
    this.ro = new ResizeObserver(debounce(() => { if (typeof this.zoom === 'string') this.rescale(); }, 120));
    this.ro.observe(this.root);
    this.sc.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.sc.addEventListener('click', e => this.onClick(e));
    this.bindPinch();
    doc.sizesReady?.then(() => { if (!this.dead) this.rescale(); });
  }
  destroy() { this.dead = true; this.io.disconnect(); this.ro.disconnect(); for (const i of [...this.rendered]) this.unrender(i); this.root.remove(); }
  apply(s) {
    this.root.classList.toggle('dark-pages', !!s.darkPages && isDark());
  }
  setMode(mode) {
    const p = this.pos();
    this.mode = mode;
    this.root.className = 'fixed ' + mode + (this.root.classList.contains('dark-pages') ? ' dark-pages' : '');
    this.rescale(p);
  }
  setZoom(z) { const p = this.pos(); this.zoom = z; this.rescale(p); }
  zoomBy(k) { this.setZoom(clamp(Math.round(this.scale * k * 100) / 100, 0.1, 8)); }
  fit() {
    const s = this.doc.size(this.cur), u = this.doc.unit;
    const aw = Math.max(80, this.sc.clientWidth - 32), ah = Math.max(80, this.sc.clientHeight - 32);
    const fw = aw / (s.w * u), fp = Math.min(fw, ah / (s.h * u));
    if (this.zoom === 'width') return Math.min(fw, this.mode === 'single' ? 4 : 8);
    if (this.zoom === 'page') return fp;
    // otomatis: pas lebar tapi tidak lebih dari 125%, halaman mendatar pas satu layar
    if (this.zoom === 'auto') return s.w > s.h ? fp : Math.min(fw, 1.25);
    return +this.zoom || 1;
  }
  rescale(p = this.pos()) {
    this.scale = clamp(this.fit(), 0.1, 8);
    this.lock = true;
    for (let i = 0; i < this.pg.length; i++) this.sizePage(i);
    for (const i of this.rendered) this.pg[i].dataset.stale = '1';
    this.go(p);
    this.lock = false;
    this.pump();
    this.report();
  }
  sizePage(i) {
    const s = this.doc.size(i), u = this.doc.unit, p = this.pg[i];
    p.style.width = Math.floor(s.w * u * this.scale) + 'px';
    p.style.height = Math.floor(s.h * u * this.scale) + 'px';
  }
  pos() {
    if (this.mode === 'single') return { p: this.cur, y: 0 };
    const p = this.pg[this.cur];
    return { p: this.cur, y: p ? clamp((this.sc.scrollTop - p.offsetTop + 8) / p.offsetHeight, 0, 0.999) : 0 };
  }
  go(at) {
    const p = clamp(at?.p | 0, 0, this.pg.length - 1);
    if (this.mode === 'single') {
      this.pg[this.cur]?.classList.remove('cur');
      this.cur = p;
      this.pg[p].classList.add('cur');
      this.sc.scrollTop = 0; this.sc.scrollLeft = 0;
      this.want.add(p);
      this.pump();
    } else {
      this.cur = p;
      const el_ = this.pg[p];
      this.lock = true;
      this.sc.scrollTop = el_.offsetTop + (at?.y || 0) * el_.offsetHeight - 8;
      this.lock = false;
    }
    this.report();
  }
  track() {
    const probe = this.sc.scrollTop + this.sc.clientHeight * 0.35;
    let lo = 0, hi = this.pg.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.pg[m].offsetTop <= probe) { ans = m; lo = m + 1; } else hi = m - 1; }
    if (ans !== this.cur) { this.cur = ans; }
    this.report();
  }
  next() {
    if (this.mode === 'single') { if (this.cur < this.pg.length - 1) { this.go({ p: this.cur + 1 }); return true; } return false; }
    const max = this.sc.scrollHeight - this.sc.clientHeight;
    if (this.sc.scrollTop >= max - 2) return false;
    this.sc.scrollBy({ top: this.sc.clientHeight * 0.9 });
    return true;
  }
  prev() {
    if (this.mode === 'single') { if (this.cur > 0) { this.go({ p: this.cur - 1 }); return true; } return false; }
    if (this.sc.scrollTop <= 0) return false;
    this.sc.scrollBy({ top: -this.sc.clientHeight * 0.9 });
    return true;
  }
  progress() { return this.pg.length > 1 ? (this.cur + (this.mode === 'single' ? 1 : clamp(this.pos().y + 0.5, 0, 1))) / this.pg.length : 1; }
  seek(f) { this.go({ p: Math.round(f * (this.pg.length - 1)) }); }
  label() { return { pos: `${this.cur + 1}/${this.pg.length}`, sub: '' }; }
  report() { this.cb.change?.(); }

  /* ---------- render ---------- */
  pump() {
    if (this.dead) return;
    const order = [...this.want].filter(i => !this.rendered.has(i) || this.pg[i].dataset.stale)
      .filter(i => this.mode !== 'single' || i === this.cur)
      .sort((a, b) => Math.abs(a - this.cur) - Math.abs(b - this.cur));
    while (this.busy < 2 && order.length) {
      const i = order.shift();
      if (this.pg[i]._run) continue;
      this.busy++;
      this.pg[i]._run = true;
      this.render(i).catch(e => console.warn('render', i, e)).finally(() => { this.pg[i]._run = false; this.busy--; this.trim(); this.pump(); });
    }
  }
  /* batasi kanvas yang tersimpan supaya memori tetap kecil walau dokumen ratusan halaman */
  trim(max = 10) {
    if (this.rendered.size <= max) return;
    const far = [...this.rendered].filter(i => !this.want.has(i) || this.mode === 'single' && i !== this.cur)
      .sort((a, b) => Math.abs(b - this.cur) - Math.abs(a - this.cur));
    for (const i of far) { if (this.rendered.size <= max) break; this.unrender(i); }
  }
  async render(i) {
    const p = this.pg[i], doc = this.doc;
    const scale = this.scale, tok = (p._tok = (p._tok || 0) + 1);
    if (doc.format !== 'pdf') {
      const u = await doc.url(i);
      const sz = await doc.sizeAsync(i);
      if (tok !== p._tok || this.dead || !sz) return;
      const above = this.mode === 'scroll' && p.offsetTop < this.sc.scrollTop, h0 = p.offsetHeight;
      this.sizePage(i);
      if (above) this.sc.scrollTop += p.offsetHeight - h0;
      let img = p.querySelector('img');
      if (!img) { img = el('img', { alt: '' }); p.append(img); }
      if (img.src !== u) img.src = u;
      this.rendered.add(i); delete p.dataset.stale;
      return;
    }
    const page = await doc.getPage(i);
    if (tok !== p._tok || this.dead) return;
    const vp = page.getViewport({ scale: scale * doc.unit });
    const w = Math.floor(vp.width), h = Math.floor(vp.height);
    if (parseInt(p.style.width, 10) !== w || parseInt(p.style.height, 10) !== h) {
      const above = this.mode === 'scroll' && p.offsetTop < this.sc.scrollTop;
      const dh = h - p.offsetHeight;
      p.style.width = w + 'px'; p.style.height = h + 'px';
      if (above) this.sc.scrollTop += dh;
    }
    let k = Math.min(window.devicePixelRatio || 1, 3);
    if (w * h * k * k > 16777216) k = Math.sqrt(16777216 / (w * h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width * k)); c.height = Math.max(1, Math.floor(vp.height * k));
    const task = page.render({ canvas: c, viewport: vp, transform: k !== 1 ? [k, 0, 0, k, 0, 0] : null });
    p._task = task;
    try { await task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; } finally { p._task = null; }
    if (tok !== p._tok || this.dead) return;
    const old = p.querySelector('canvas');
    if (old) old.replaceWith(c); else p.prepend(c);
    p.style.setProperty('--total-scale-factor', vp.scale);
    p.style.setProperty('--scale-factor', vp.scale);
    this.rendered.add(i); delete p.dataset.stale;
    // lapisan teks (bisa dipilih & dicari) dan tautan
    const tl = el('div', { class: 'textLayer' });
    try {
      const layer = new doc.lib.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: tl, viewport: vp });
      await layer.render();
    } catch (e) { /* tanpa lapisan teks */ }
    if (tok !== p._tok || this.dead) return;
    p.querySelector('.textLayer')?.remove();
    p.append(tl);
    p.querySelector('.links')?.remove();
    this.links(page, vp, p).catch(() => {});
    if (this.hit && this.hit.p === i) this.markHit();
  }
  unrender(i) {
    const p = this.pg[i];
    if (!p || !this.rendered.has(i)) return;
    p._tok = (p._tok || 0) + 1;
    try { p._task?.cancel(); } catch (e) { /* sudah selesai */ }
    const c = p.querySelector('canvas'); if (c) { c.width = c.height = 0; c.remove(); }
    p.querySelector('.textLayer')?.remove(); p.querySelector('.links')?.remove();
    p.querySelector('img')?.removeAttribute('src');
    p.querySelector('img')?.remove();
    this.rendered.delete(i);
  }
  async links(page, vp, p) {
    const anns = await page.getAnnotations({ intent: 'display' });
    const box = el('div', { class: 'links' });
    for (const a of anns) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]), [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const link = el('a');
      Object.assign(link.style, { left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px', width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px' });
      if (a.url && /^(https?:|mailto:)/i.test(a.url)) { link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = a.url; }
      else if (a.dest) { link.href = '#'; link.onclick = async e => { e.preventDefault(); const t = await this.doc.destPage(a.dest); if (t != null) { this.cb.jump?.(); this.go({ p: t }); } }; }
      else continue;
      box.append(link);
    }
    if (box.childElementCount) p.append(box);
  }

  /* ---------- pencarian ---------- */
  async showHit(p, q, nth) {
    this.clearHit();
    this.hit = { p, q, nth };
    this.go({ p, y: 0 });
    if (this.rendered.has(p) && !this.pg[p].dataset.stale) this.markHit();
  }
  markHit() {
    const { p, q, nth } = this.hit;
    const tl = this.pg[p].querySelector('.textLayer');
    if (!tl) return;
    const parts = [];
    let text = '';
    const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) { parts.push({ node: c, start: text.length }); text += c.data; } else if (c.localName === 'br') text += '\n'; else if (c.nodeType === 1) walk(c); } };
    walk(tl);
    const hits = findAll(text, q, 2000);
    if (!hits.length) return;
    let curMark = null;
    hits.forEach(([a, b], k) => {
      for (const part of parts) {
        const s = part.start, e = s + part.node.data.length;
        if (e <= a || s >= b || !part.node.parentNode) continue;
        const from = Math.max(0, a - s), to = Math.min(part.node.data.length, b - s);
        const r = document.createRange();
        r.setStart(part.node, from); r.setEnd(part.node, to);
        const m = el('mark', { class: k === nth ? 'cur' : '' });
        try { r.surroundContents(m); } catch (e) { continue; }
        if (k === nth && !curMark) curMark = m;
        // simpul teks terbelah: perbarui daftar supaya kemunculan berikutnya tetap tepat
        const after = m.nextSibling;
        if (after && after.nodeType === 3) { part.node = after; part.start = s + to; }
      }
    });
    if (curMark && this.mode === 'scroll') {
      const r = curMark.getBoundingClientRect(), s = this.sc.getBoundingClientRect();
      if (r.top < s.top + 20 || r.bottom > s.bottom - 20) this.sc.scrollTop += r.top - s.top - this.sc.clientHeight / 3;
    } else if (curMark) curMark.scrollIntoView({ block: 'center', inline: 'center' });
  }
  clearHit() {
    this.hit = null;
    for (const m of this.box.querySelectorAll('.textLayer mark')) { const par = m.parentNode; m.replaceWith(...m.childNodes); par.normalize(); }
  }

  /* ---------- interaksi ---------- */
  onWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      this.wz = (this.wz || 0) - e.deltaY;
      if (!this.wzRaf) this.wzRaf = requestAnimationFrame(() => { const k = Math.exp(this.wz / 400); this.wz = 0; this.wzRaf = 0; this.zoomBy(k); });
      return;
    }
    if (this.mode === 'single' && this.sc.scrollHeight <= this.sc.clientHeight + 2) {
      e.preventDefault();
      const now = Date.now();
      if (now - (this.lastWheel || 0) < 300 || Math.abs(e.deltaY) < 4) return;
      this.lastWheel = now;
      if (e.deltaY > 0) this.next(); else this.prev();
    }
  }
  onClick(e) {
    if (e.target.closest('a')) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    if (this.mode !== 'single' || this.pinched) return;
    const x = e.clientX - this.sc.getBoundingClientRect().left, w = this.sc.clientWidth;
    if (x < w * 0.25) this.prev(); else if (x > w * 0.75) this.next(); else this.cb.tap?.();
  }
  bindPinch() {
    const pts = new Map();
    let d0 = 0, s0 = 1;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    this.sc.style.touchAction = 'pan-x pan-y';
    this.sc.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, t: Date.now() });
      if (pts.size === 2) { d0 = dist(); s0 = 1; }
    });
    this.sc.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const pt = pts.get(e.pointerId); pt.x = e.clientX; pt.y = e.clientY;
      if (pts.size === 2 && d0) { s0 = clamp(dist() / d0, 0.3, 4); this.box.style.transform = `scale(${s0})`; this.box.style.transformOrigin = 'center top'; }
    });
    const end = e => {
      const pt = pts.get(e.pointerId);
      if (!pt) return;
      if (pts.size === 2 && d0) {
        this.box.style.transform = '';
        if (Math.abs(s0 - 1) > 0.04) { this.pinched = true; setTimeout(() => { this.pinched = false; }, 400); this.zoomBy(s0); }
        d0 = 0;
      } else if (pts.size === 1 && this.mode === 'single' && this.sc.scrollWidth <= this.sc.clientWidth + 2) {
        const dx = e.clientX - pt.x0;
        if (Math.abs(dx) > 50 && Date.now() - pt.t < 700) { this.pinched = true; setTimeout(() => { this.pinched = false; }, 400); if (dx < 0) this.next(); else this.prev(); }
      }
      pts.delete(e.pointerId);
    };
    this.sc.addEventListener('pointerup', end);
    this.sc.addEventListener('pointercancel', end);
  }
}
