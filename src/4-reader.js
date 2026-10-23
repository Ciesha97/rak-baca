/* ================= Layar baca ================= */
const Reader = (() => {
  let book = null, doc = null, view = null, token = 0;
  let panel = null, pop = null, notePop = null, backBtn = null, focusPos = null;
  let seeking = false, lastJump = null;
  const search = { q: '', run: 0, hits: [], cur: -1, done: false };
  const stage = () => $('#stage');
  const saveSoon = debounce(() => persist(), 800);

  async function open(b, file) {
    const tok = ++token;
    book = b;
    $('#shelf').hidden = true;
    $('#reader').hidden = false;
    document.title = (b.title || 'Dokumen') + ' · Rak Baca';
    $('#rd-title').textContent = b.title || b.name;
    $('#rd-sub').textContent = b.author || '';
    $('#rd-pos').textContent = '';
    $('#rd-seek').value = 0;
    stage().replaceChildren(loading('Membuka dokumen…'));
    let d;
    try {
      d = await openDocument(file, { password: askPassword });
    } catch (e) {
      if (tok !== token) return;
      console.error(e);
      showError(e);
      return;
    }
    if (tok !== token) { d.close(); return; }
    doc = d;
    stage().replaceChildren();
    const cb = { change: onChange, tap: toggleFocus, note: showNote, jump: rememberJump, loading: slowLoading };
    try {
      if (doc.kind === 'flow') {
        view = new FlowView(stage(), doc, cb);
        view.apply(Settings.all());
        const p = b.pos?.kind === 'flow' && b.pos.s < doc.sections.length ? b.pos : null;
        await view.show(p ? p.s : 0, p ? { b: p.b, o: p.o } : null);
      } else {
        view = new FixedView(stage(), doc, b.view || {}, cb);
        view.apply(Settings.all());
        view.rescale(b.pos?.kind === 'fixed' ? { p: b.pos.p, y: b.pos.y } : { p: 0, y: 0 });
      }
    } catch (e) {
      if (tok !== token) return;
      console.error(e);
      showError(e);
      return;
    }
    if (tok !== token) return;
    if (doc.title) $('#rd-title').textContent = doc.title;
    $('#rd-search').disabled = doc.kind === 'fixed' && !doc.hasText;
    $('#rd-tts').disabled = doc.kind === 'fixed' && !doc.hasText;
    $('#rd-tr').disabled = doc.kind === 'fixed' && !doc.hasText;
    onChange();
    Shelf.enrich(book, doc).then(() => { if (book === b) document.title = b.title + ' · Rak Baca'; });
    stage().focus?.();
  }
  function close() {
    token++;
    TTS.stop();
    Translate.close();
    Notes.hideChip(); onChange.sec = -1;
    closePanel(); closePop(); closeNote();
    if (backBtn) { backBtn.remove(); backBtn = null; }
    if (view) { persist(); view.destroy(); view = null; }
    if (doc) { try { doc.close(); } catch (e) { /* abaikan */ } doc = null; }
    $('#reader').classList.remove('focus');
    focusPos?.remove(); focusPos = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    $('#reader').hidden = true;
    $('#shelf').hidden = false;
    document.title = 'Rak Baca';
    search.q = ''; search.hits = []; search.run++;
    const b = book;
    book = null;
    return b;
  }
  const isOpen = () => !!book;
  function loading(msg) { return el('div', { class: 'loading' }, el('div', { class: 'spin' }), el('div', { text: msg })); }
  let slowT = null, slowEl = null;
  function slowLoading(on) {
    clearTimeout(slowT);
    if (on) slowT = setTimeout(() => { slowEl = loading('Memuat…'); stage().append(slowEl); }, 250);
    else { slowEl?.remove(); slowEl = null; }
  }
  function showError(e) {
    const msg = e instanceof FormatError ? e.message : 'Dokumen tidak bisa dibuka: ' + (e?.message || e);
    const box = el('div', { class: 'rd-error' });
    const inner = el('div', null, el('h2', { text: 'Tidak bisa membuka dokumen' }), el('p', { text: msg }));
    const acts = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center' });
    const back = el('button', { class: 'btn primary', text: 'Kembali ke rak' });
    back.onclick = () => App.toShelf();
    const dl = el('button', { class: 'btn', text: 'Unduh berkas aslinya' });
    dl.onclick = () => Shelf.downloadFile(book);
    acts.append(back, dl);
    inner.append(acts);
    box.append(inner);
    stage().replaceChildren(box);
  }
  async function askPassword(wrong) {
    const v = await ask({ title: wrong ? 'Kata sandi salah' : 'Dokumen berkata sandi', body: wrong ? '<p>Coba ketik ulang kata sandinya.</p>' : '<p>PDF ini dilindungi. Masukkan kata sandi untuk membukanya.</p>', input: { type: 'password', placeholder: 'Kata sandi' }, ok: 'Buka' });
    return v == null ? null : v;
  }

  /* ---------- posisi & bilah ---------- */
  function posRecord() {
    const p = view.pos();
    return doc.kind === 'flow' ? { kind: 'flow', s: p.s, b: p.b, o: +p.o.toFixed(4) } : { kind: 'fixed', p: p.p, y: +p.y.toFixed(4) };
  }
  function persist() {
    if (!view || !book || (view.sec != null && view.sec < 0)) return;
    book.pos = posRecord();
    book.progress = +view.progress().toFixed(4);
    book.opened = Date.now();
    if (doc.kind === 'fixed') book.view = { mode: view.mode, zoom: view.zoom };
    Store.books.put(book).catch(e => console.warn('simpan posisi', e));
  }
  function onChange() {
    if (!view) return;
    const l = view.label();
    $('#rd-pos').textContent = l.pos;
    if (!seeking) $('#rd-seek').value = Math.round(view.progress() * 1000);
    $('#rd-sub').textContent = l.sub || book.author || '';
    if (focusPos) focusPos.textContent = l.pos;
    const marked = isMarked();
    const mb = $('#rd-mark');
    mb.setAttribute('aria-pressed', String(marked));
    mb.innerHTML = icon(marked ? 'bookmark-on' : 'bookmark');
    if (panel?.tab === 'toc') markToc();
    if (doc.kind === 'flow' && view.sec !== onChange.sec) { onChange.sec = view.sec; Notes.mark(); }
    saveSoon();
  }
  function next() { if (!view) return; if (!view.next() && doc.kind === 'fixed') toast('Ini halaman terakhir'); TTS.resync(); }
  function prev() { if (!view) return; view.prev(); TTS.resync(); }

  /* ---------- kembali setelah lompat tautan ---------- */
  function rememberJump() {
    lastJump = posRecord();
    backBtn?.remove();
    backBtn = el('button', { class: 'btn', style: 'position:absolute;left:12px;bottom:12px;z-index:24;box-shadow:var(--shadow)' });
    backBtn.innerHTML = icon('back') + 'Kembali ke posisi tadi';
    backBtn.onclick = () => { const p = lastJump; backBtn.remove(); backBtn = null; goPos(p); };
    stage().append(backBtn);
    clearTimeout(rememberJump.t);
    rememberJump.t = setTimeout(() => { backBtn?.remove(); backBtn = null; }, 12000);
  }
  function goPos(p) {
    if (!p || !view) return;
    if (p.kind === 'flow') view.show(p.s, { b: p.b, o: p.o }); else view.go({ p: p.p, y: p.y });
  }

  /* ---------- panel: daftar isi, penanda, pencarian ---------- */
  function openPanel(tab) {
    closePop();
    if (!panel) {
      const scrim = el('div', { class: 'panel-scrim' });
      const box = el('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Navigasi dokumen' });
      box.innerHTML = `<div class="panel-head"><div class="tabs" role="tablist"><button role="tab" data-t="toc">Daftar isi</button><button role="tab" data-t="marks">Penanda</button><button role="tab" data-t="notes">Catatan</button><button role="tab" data-t="search">Cari</button></div><button class="icon-btn" data-x title="Tutup (Esc)" aria-label="Tutup">${icon('x')}</button></div><div class="panel-body"></div>`;
      scrim.onclick = closePanel;
      box.querySelector('[data-x]').onclick = closePanel;
      box.querySelector('.tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); };
      stage().append(scrim, box);
      panel = { box, scrim, body: box.querySelector('.panel-body'), tab: '' };
    }
    setTab(tab);
  }
  function closePanel() { if (panel) { panel.box.remove(); panel.scrim.remove(); panel = null; } }
  function setTab(t) {
    panel.tab = t;
    for (const b of panel.box.querySelectorAll('[data-t]')) b.setAttribute('aria-selected', String(b.dataset.t === t));
    if (t === 'toc') renderToc(); else if (t === 'marks') renderMarks(); else if (t === 'notes') Notes.renderPanel(panel.body); else renderSearch();
  }
  const narrow = () => innerWidth < 900;
  function renderToc() {
    const body = panel.body;
    let items = doc.toc || [];
    if (!items.length && doc.kind === 'flow' && doc.sections.length > 1) items = doc.sections.map((s, i) => ({ title: s.title || 'Bagian ' + (i + 1), lvl: 0, sec: i }));
    if (!items.length) { body.innerHTML = `<p class="p-empty">${doc.kind === 'fixed' ? 'Dokumen ini tidak punya daftar isi. Pakai penggeser di bawah atau tombol halaman untuk berpindah.' : 'Dokumen ini tidak punya judul bab untuk daftar isi.'}</p>`; return; }
    const ul = el('ul', { class: 'toc' });
    items.forEach((t, k) => {
      const b = el('button', { 'data-k': k, style: `padding-left:${10 + t.lvl * 16}px` });
      if (t.page != null) b.append(el('span', { class: 'pg', text: String(t.page + 1) }));
      b.append(t.title);
      if (t.page == null && t.sec == null && !t.url) b.disabled = true;
      b.onclick = () => {
        rememberJump();
        if (t.page != null) view.go({ p: t.page, y: 0 });
        else if (t.sec != null) view.show(t.sec, t.anc ? { anc: t.anc } : null);
        else if (t.url && /^https?:/i.test(t.url)) window.open(t.url, '_blank', 'noopener');
        closePanel();
      };
      ul.append(el('li', null, b));
    });
    body.replaceChildren(ul);
    panel.items = items;
    markToc(true);
  }
  function markToc(scroll) {
    if (!panel?.items) return;
    const items = panel.items;
    let on = -1;
    if (doc.kind === 'fixed') { items.forEach((t, k) => { if (t.page != null && t.page <= view.cur) on = k; }); }
    else {
      const first = view.blocks()[view.pos().b];
      items.forEach((t, k) => {
        if (t.sec < view.sec) on = k;
        else if (t.sec === view.sec) {
          if (!t.anc) { on = k; return; }
          const e = view.art.querySelector(`[id="${CSS.escape(t.anc)}"]`);
          if (e && first && (e === first || e.contains(first) || (e.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING))) on = k;
        }
      });
    }
    panel.body.querySelectorAll('.toc button.on').forEach(b => b.classList.remove('on'));
    const b = panel.body.querySelector(`[data-k="${on}"]`);
    if (b) { b.classList.add('on'); if (scroll) b.scrollIntoView({ block: 'center' }); }
  }
  function markKey(p) { return p.kind === 'flow' ? `${p.s}:${p.b}` : `p${p.p}`; }
  function isMarked() { if (!view || !book?.bookmarks?.length) return false; const k = markKey(posRecord()); return book.bookmarks.some(m => m.key === k); }
  function toggleMark() {
    if (!view) return;
    const p = posRecord(), key = markKey(p);
    book.bookmarks = book.bookmarks || [];
    const i = book.bookmarks.findIndex(m => m.key === key);
    if (i >= 0) { book.bookmarks.splice(i, 1); toast('Penanda dihapus'); }
    else {
      let label = '';
      if (doc.kind === 'flow') label = (view.blocks()[p.b]?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      book.bookmarks.push({ key, pos: p, label, where: doc.kind === 'flow' ? (doc.sections[p.s]?.title || '') : 'Halaman ' + (p.p + 1), progress: view.progress(), at: Date.now() });
      book.bookmarks.sort((a, b) => a.progress - b.progress);
      toast('Halaman ini ditandai');
    }
    persist();
    onChange();
    if (panel?.tab === 'marks') renderMarks();
  }
  function renderMarks() {
    const body = panel.body;
    const list = book.bookmarks || [];
    if (!list.length) { body.innerHTML = `<p class="p-empty">Belum ada penanda. Tekan tombol ${icon('bookmark')} di atas (atau tombol B) untuk menandai halaman yang sedang dibaca.</p>`; return; }
    const ul = el('ul', { class: 'bms' });
    for (const m of list) {
      const go = el('button', { class: 'go' });
      go.innerHTML = `<small>${esc(m.where || '')} · ${Math.round(m.progress * 100)}% · ${esc(fmtAgo(m.at))}</small>${esc(m.label || 'Halaman ' + ((m.pos.p ?? 0) + 1))}`;
      go.onclick = () => { rememberJump(); goPos(m.pos); closePanel(); };
      const del = el('button', { class: 'icon-btn', title: 'Hapus penanda', 'aria-label': 'Hapus penanda' });
      del.innerHTML = icon('trash');
      del.onclick = () => { book.bookmarks = book.bookmarks.filter(x => x !== m); persist(); onChange(); renderMarks(); };
      ul.append(el('li', null, go, del));
    }
    body.replaceChildren(ul);
  }
  function renderSearch() {
    const body = panel.body;
    body.innerHTML = `<div class="search-row"><input type="search" placeholder="Cari kata atau kalimat…" aria-label="Cari di dokumen"><button class="btn primary">${icon('search')}</button></div><div class="s-stat"></div><ul class="hits"></ul>`;
    const inp = $('input', body);
    inp.value = search.q;
    const go = () => runSearch(inp.value);
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value === search.q && search.hits.length) stepHit(e.shiftKey ? -1 : 1); else go(); } };
    $('button', body).onclick = go;
    if (search.q) showHits(); else $('.s-stat', body).textContent = doc.kind === 'fixed' && !doc.hasText ? 'Dokumen ini berupa gambar sehingga teksnya tidak bisa dicari.' : 'Tekan Enter untuk mencari. Huruf besar/kecil dan tanda aksen diabaikan.';
    setTimeout(() => inp.focus(), 30);
  }
  async function runSearch(q) {
    const run = ++search.run;
    search.q = q.trim(); search.hits = []; search.cur = -1; search.done = false;
    const fq = foldQuery(q);
    clearHighlights(); view?.clearHit?.();
    if (fq.length < 2) { search.done = true; showHits('Ketik minimal 2 huruf.'); return; }
    if (doc.kind === 'fixed' && !doc.hasText) { search.done = true; showHits('Dokumen ini berupa gambar sehingga teksnya tidak bisa dicari.'); return; }
    const n = doc.kind === 'flow' ? doc.sections.length : doc.pageCount;
    let last = performance.now();
    for (let i = 0; i < n && search.hits.length < 2000; i++) {
      const t = doc.kind === 'flow' ? await view.sectionText(i) : await doc.text(i);
      if (run !== search.run || !doc) return;
      findAll(t, fq, 500).forEach(([a, b], k) => search.hits.push({ i, k, html: snippet(t, a, b), where: doc.kind === 'flow' ? (doc.sections[i].title || (n > 1 ? 'Bagian ' + (i + 1) : '')) : 'Halaman ' + (i + 1) }));
      if (performance.now() - last > 120) { showHits(`Mencari… ${Math.round((i + 1) / n * 100)}%`); await sleep(0); last = performance.now(); if (run !== search.run) return; }
    }
    search.done = true;
    // seperti "Cari" di peramban: hasil pertama dihitung dari posisi baca saat ini
    const here = doc.kind === 'flow' ? view.sec : view.cur;
    const start = search.hits.findIndex(h => h.i >= here);
    search.cur = (start < 0 ? 0 : start) - 1;
    showHits();
    if (search.hits.length) stepHit(1);
  }
  function showHits(status) {
    if (!panel || panel.tab !== 'search') return;
    const st = $('.s-stat', panel.body), ul = $('.hits', panel.body);
    if (!st) return;
    const n = search.hits.length;
    st.textContent = status || (n ? `${NF.format(n)}${n >= 2000 ? '+' : ''} hasil · Enter untuk hasil berikutnya` : (doc.kind === 'fixed' ? 'Tidak ditemukan. Bila PDF ini hasil pindaian, teksnya berupa gambar dan tidak bisa dicari.' : 'Tidak ditemukan.'));
    const f = document.createDocumentFragment();
    search.hits.slice(0, 500).forEach((h, k) => {
      const b = el('button', { 'data-k': k, class: k === search.cur ? 'on' : '' });
      b.innerHTML = `<small>${esc(h.where)}</small>${h.html}`;
      b.onclick = () => { search.cur = k; gotoHit(); if (narrow()) closePanel(); else markHit(); };
      f.append(el('li', null, b));
    });
    ul.replaceChildren(f);
  }
  function markHit() { panel?.body.querySelectorAll('.hits button').forEach(b => b.classList.toggle('on', +b.dataset.k === search.cur)); }
  function stepHit(d, quiet) {
    if (!search.hits.length) return;
    search.cur = (search.cur + d + search.hits.length) % search.hits.length;
    gotoHit();
    markHit();
    if (!quiet) panel?.body.querySelector('.hits button.on')?.scrollIntoView({ block: 'nearest' });
  }
  function gotoHit() {
    const h = search.hits[search.cur];
    if (!h || !view) return;
    view.showHit(h.i, foldQuery(search.q), h.k);
  }

  /* ---------- pengaturan tampilan ---------- */
  function openPop() {
    closePanel();
    if (pop) { closePop(); return; }
    const s = Settings.all();
    pop = el('div', { class: 'pop', role: 'dialog', 'aria-label': 'Pengaturan tampilan' });
    const seg = (key, opts, cur) => `<div class="seg" data-k="${key}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join('')}</div>`;
    let h = `<div class="row"><span>Tema</span><div class="themes">${[['light', 'Terang', 'sw-light'], ['sepia', 'Sepia', 'sw-sepia'], ['dark', 'Gelap', 'sw-dark'], ['auto', 'Otomatis', 'sw-auto']].map(([v, l, c]) => `<button data-theme="${v}" aria-pressed="${s.theme === v}"><i class="${c}">Aa</i>${l}</button>`).join('')}</div></div>`;
    if (doc?.kind === 'flow') {
      h += `<div class="row"><span>Huruf</span>${seg('font', [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']], s.font)}</div>
        <div class="row"><span>Ukuran huruf</span><div class="ctl"><button class="btn" data-fs="-1" aria-label="Perkecil huruf">A−</button><span class="val" id="v-fs">${s.fontSize}</span><button class="btn" data-fs="1" aria-label="Perbesar huruf">A+</button></div></div>
        <div class="row"><label for="v-lh">Spasi baris</label><div class="ctl"><input type="range" id="v-lh" min="1.2" max="2.2" step="0.05" value="${s.lineHeight}"><span class="val" id="v-lhv">${s.lineHeight.toFixed(2)}</span></div></div>
        <div class="row"><span>Lebar teks</span>${seg('measure', [['sempit', 'Sempit'], ['sedang', 'Sedang'], ['lebar', 'Lebar'], ['penuh', 'Penuh']], s.measure)}</div>
        <div class="row"><span>Perataan</span>${seg('align', [['kiri', 'Rata kiri'], ['rata', 'Rata kanan-kiri']], s.align)}</div>
        ${doc.scrollOnly ? '' : `<div class="row"><span>Tata letak</span>${seg('layout', [['1', '1 kolom'], ['2', '2 kolom'], ['scroll', 'Gulir']], layoutOf(s))}</div>`}
        <label class="tgl">Indentasi awal paragraf<input type="checkbox" data-c="indent" ${s.indent ? 'checked' : ''}></label>`;
    } else if (doc) {
      h += `<div class="row"><span>Perbesaran</span><div class="ctl"><button class="btn" data-z="0.8" aria-label="Perkecil">${icon('minus')}</button><span class="val" id="v-z">${Math.round(view.scale * 100)}%</span><button class="btn" data-z="1.25" aria-label="Perbesar">${icon('plus')}</button></div>
        ${seg('zoom', [['auto', 'Otomatis'], ['width', 'Pas lebar'], ['page', 'Pas halaman'], ['1', '100%']], view.zoom)}</div>
        <div class="row"><span>Tata letak</span>${seg('fxmode', [['scroll', 'Gulir'], ['single', 'Per halaman']], view.mode)}</div>
        ${doc.format === 'pdf' ? `<label class="tgl">Halaman gelap saat tema gelap<input type="checkbox" data-c="darkPages" ${s.darkPages ? 'checked' : ''}></label>` : ''}`;
    }
    if (doc) h += `<label class="tgl">Tombol melayang saat memilih teks<input type="checkbox" data-c="selChip" ${s.selChip ? 'checked' : ''}></label>`;
    pop.innerHTML = h;
    pop.addEventListener('click', e => {
      const t = e.target.closest('button,input');
      if (!t) return;
      if (t.dataset.theme) { Settings.set({ theme: t.dataset.theme }); refreshPop(); return; }
      if (t.dataset.fs) { Settings.set({ fontSize: clamp(Settings.get('fontSize') + 2 * t.dataset.fs, 12, 40) }); $('#v-fs', pop).textContent = Settings.get('fontSize'); return; }
      if (t.dataset.z) { view.zoomBy(+t.dataset.z); refreshPop(); return; }
      if (t.dataset.c) { Settings.set({ [t.dataset.c]: t.checked }); return; }
      const sg = t.closest('.seg');
      if (sg && t.dataset.v) {
        const k = sg.dataset.k, v = t.dataset.v;
        if (k === 'zoom') view.setZoom(v === '1' ? 1 : v);
        else if (k === 'layout') Settings.set(v === 'scroll' ? { flowMode: 'scroll' } : { flowMode: 'paged', twoCols: v === '2' });
        else if (k === 'fxmode') { view.setMode(v); if (v === 'single' && view.zoom === 'width') view.setZoom('page'); }
        else Settings.set({ [k]: v });
        refreshPop();
      }
    });
    pop.addEventListener('input', e => { if (e.target.id === 'v-lh') { Settings.set({ lineHeight: +e.target.value }); $('#v-lhv', pop).textContent = (+e.target.value).toFixed(2); } });
    stage().append(pop);
    $('#rd-view').setAttribute('aria-expanded', 'true');
    pop.querySelector('button')?.focus();
  }
  /* tata letak teks: satu kolom selebar layar baca, dua kolom berdampingan, atau gulir */
  const layoutOf = s => s.flowMode === 'scroll' ? 'scroll' : s.twoCols ? '2' : '1';
  function toggleCols() {
    if (doc?.kind !== 'flow' || doc.scrollOnly) return;
    const two = !(Settings.get('flowMode') === 'paged' && Settings.get('twoCols'));
    Settings.set({ flowMode: 'paged', twoCols: two });
    toast(two ? 'Tampilan 2 kolom (bila layar cukup lebar)' : 'Tampilan 1 kolom');
    refreshPop();
  }
  function refreshPop() { if (!pop) return; pop.remove(); pop = null; openPop(); }
  function closePop() { if (pop) { pop.remove(); pop = null; $('#rd-view').setAttribute('aria-expanded', 'false'); } }
  Settings.on(patch => {
    applyTheme();
    if ('selChip' in patch && !patch.selChip) Notes.hideChip();
    if (view) {
      if (doc.kind === 'flow' && Object.keys(patch).some(k => /^(font|fontSize|lineHeight|measure|align|flowMode|twoCols|indent)$/.test(k))) view.apply(Settings.all());
      if (doc.kind === 'fixed') view.apply(Settings.all());
    }
  });

  /* ---------- catatan kaki ---------- */
  function showNote(node, goFn) {
    closeNote();
    notePop = el('div', { class: 'note-pop', role: 'dialog', 'aria-label': 'Catatan' });
    node.removeAttribute('id');
    node.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
    notePop.append(node);
    const acts = el('div', { class: 'acts' });
    const go = el('button', { class: 'btn', text: 'Buka di teks' });
    go.onclick = () => { closeNote(); rememberJump(); goFn(); };
    const x = el('button', { class: 'btn primary', text: 'Tutup' });
    x.onclick = closeNote;
    acts.append(go, x);
    notePop.append(acts);
    stage().append(notePop);
    x.focus();
  }
  function closeNote() { notePop?.remove(); notePop = null; }

  /* ---------- mode fokus & layar penuh ---------- */
  function toggleFocus() {
    const r = $('#reader');
    r.classList.toggle('focus');
    if (r.classList.contains('focus')) { focusPos = el('div', { class: 'focus-pos', text: $('#rd-pos').textContent }); stage().append(focusPos); }
    else { focusPos?.remove(); focusPos = null; }
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Layar penuh tidak tersedia di sini'));
  }
  function more(btn) {
    popMenu(btn, [
      { label: 'Info dokumen', icon: 'info', run: () => Shelf.info(book, doc) },
      { label: 'Unduh berkas asli', icon: 'download', run: () => Shelf.downloadFile(book) },
      doc?.kind === 'flow' && !doc.scrollOnly ? { label: layoutOf(Settings.all()) === '2' ? 'Tampilkan 1 kolom' : 'Tampilkan 2 kolom', icon: 'toc', run: toggleCols } : null,
      { label: $('#reader').classList.contains('focus') ? 'Tampilkan bilah' : 'Mode fokus (sembunyikan bilah)', icon: 'full', run: toggleFocus },
      { label: 'Catatan', icon: 'note', run: () => openPanel('notes') },
      { label: 'Terjemahkan ke bahasa Indonesia', icon: 'translate', run: () => Translate.open() },
      { label: 'Bacakan', icon: 'speak', run: () => TTS.toggle() },
      '-',
      { label: 'Kembali ke rak', icon: 'back', run: () => App.toShelf() },
    ]);
  }

  /* ---------- keyboard & tombol ---------- */
  function onKey(e) {
    if (!book || $('#dlg').open) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') { e.preventDefault(); if (doc) openPanel('search'); return; }
    if (k === 'Escape') {
      if (Translate.isOpen()) Translate.close(); else if (notePop) closeNote(); else if (pop) closePop(); else if (panel) closePanel();
      else if ($('#reader').classList.contains('focus')) toggleFocus();
      else if (!document.fullscreenElement) App.toShelf();
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey || !view) return;
    const flowScroll = doc.kind === 'flow' && view.mode === 'scroll';
    const fxScroll = doc.kind === 'fixed' && view.mode === 'scroll';
    switch (k) {
      case 'ArrowRight': case 'PageDown': if (k === 'ArrowRight' && fxScroll && view.sc.scrollWidth > view.sc.clientWidth + 2) return; e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp': if (k === 'ArrowLeft' && fxScroll && view.sc.scrollWidth > view.sc.clientWidth + 2) return; e.preventDefault(); prev(); break;
      case ' ': e.preventDefault(); if (e.shiftKey) prev(); else next(); break;
      case 'ArrowDown': if (flowScroll || fxScroll) return; e.preventDefault(); next(); break;
      case 'ArrowUp': if (flowScroll || fxScroll) return; e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); if (doc.kind === 'flow') view.show(0, null); else view.go({ p: 0 }); break;
      case 'End': e.preventDefault(); if (doc.kind === 'flow') view.show(doc.sections.length - 1, 'end'); else view.go({ p: doc.pageCount - 1 }); break;
      case 't': case 'T': openPanel('toc'); break;
      case '/': e.preventDefault(); openPanel('search'); break;
      case 'b': case 'B': toggleMark(); break;
      case 'n': case 'N': Notes.fromSelection(); break;
      case 'f': case 'F': toggleFull(); break;
      case 'm': case 'M': toggleFocus(); break;
      case 'c': case 'C': toggleCols(); break;
      case 'r': case 'R': TTS.toggle(); break;
      case 'e': case 'E': Translate.open(); break;
      case '+': case '=': if (doc.kind === 'flow') Settings.set({ fontSize: clamp(Settings.get('fontSize') + 2, 12, 40) }); else view.zoomBy(1.15); break;
      case '-': case '_': if (doc.kind === 'flow') Settings.set({ fontSize: clamp(Settings.get('fontSize') - 2, 12, 40) }); else view.zoomBy(1 / 1.15); break;
    }
  }
  function bind() {
    $('#rd-back').onclick = () => App.toShelf();
    $('#rd-toc').onclick = () => (panel?.tab === 'toc' ? closePanel() : doc && openPanel('toc'));
    $('#rd-search').onclick = () => (panel?.tab === 'search' ? closePanel() : doc && openPanel('search'));
    $('#rd-mark').onclick = toggleMark;
    $('#rd-note').onclick = () => (panel?.tab === 'notes' && !getSelection()?.toString() ? closePanel() : doc && Notes.fromSelection());
    $('#rd-tts').onclick = () => TTS.toggle();
    $('#rd-tr').onclick = () => Translate.open();
    $('#rd-view').onclick = () => doc && openPop();
    $('#rd-full').onclick = toggleFull;
    $('#rd-more').onclick = e => more(e.currentTarget);
    $('#rd-next').onclick = next;
    $('#rd-prev').onclick = prev;
    const seek = $('#rd-seek');
    seek.addEventListener('input', () => { seeking = true; $('#rd-pos').textContent = Math.round(seek.value / 10) + '%'; });
    seek.addEventListener('change', () => { seeking = false; if (view) { rememberJump(); view.seek(seek.value / 1000); } });
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', e => {
      if (pop && !pop.contains(e.target) && !e.target.closest('#rd-view')) closePop();
      if (notePop && !notePop.contains(e.target)) closeNote();
    }, true);
    addEventListener('pagehide', () => persist());
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (view && doc?.kind === 'fixed') view.apply(Settings.all()); });
  }
  const refreshPanel = t => { if (panel && panel.tab === t) setTab(t); };
  return { open, close, isOpen, bind, persist, posRecord, openPanel, closePanel, refreshPanel, jumpTo: p => { rememberJump(); goPos(p); }, get view() { return view; }, get doc() { return doc; }, get book() { return book; } };
})();

/* ================= Bacakan (suara) ================= */
const TTS = (() => {
  let on = false, paused = false, tok = 0, bar = null, st = null, fails = 0, home = null;
  const ok = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const lang = () => (Reader.doc?.lang || document.documentElement.lang || 'id').toLowerCase().slice(0, 2);
  function voice() {
    const vs = speechSynthesis.getVoices(), want = Settings.get('ttsVoice');
    return vs.find(v => v.name === want) || vs.find(v => v.lang?.toLowerCase().startsWith(lang())) || vs.find(v => v.default) || vs[0] || null;
  }
  function chunks(text) {
    const out = [];
    const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [];
    let cur = '';
    for (const p of parts) {
      if ((cur + p).length > 220 && cur) { out.push(cur.trim()); cur = ''; }
      if (p.length > 260) { for (let i = 0; i < p.length; i += 220) out.push(p.slice(i, i + 220)); continue; }
      cur += p;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function toggle() { if (on) stop(); else start(); }
  /* daftar suara dimuat bertahap oleh peramban; tunggu sebentar sebelum menyimpulkan tidak ada */
  async function voicesReady() {
    if (speechSynthesis.getVoices().length) return true;
    await new Promise(r => { const t = setTimeout(r, 1500); speechSynthesis.addEventListener?.('voiceschanged', () => { clearTimeout(t); r(); }, { once: true }); });
    return speechSynthesis.getVoices().length > 0;
  }
  async function start() {
    if (!ok()) { toast('Perangkat ini tidak mendukung fitur bacakan.', 'bad'); return; }
    const v = Reader.view, d = Reader.doc;
    if (!v) return;
    if (d.kind === 'fixed' && !d.hasText) { toast('Dokumen ini berupa gambar sehingga tidak bisa dibacakan.', 'bad'); return; }
    if (!(await voicesReady())) { toast('Belum ada suara pembaca (text-to-speech) terpasang di perangkat ini.', 'bad'); return; }
    if (Reader.view !== v) return;
    on = true; paused = false; fails = 0; home = v.pos();
    showBar();
    resync(true);
  }
  function stop() {
    if (!on) return;
    on = false; tok++;
    try { speechSynthesis.cancel(); } catch (e) { /* abaikan */ }
    setHighlight('rb-tts', []);
    bar?.remove(); bar = null; st = null;
    $('#rd-tts')?.setAttribute('aria-pressed', 'false');
  }
  /* mulai ulang dari posisi yang sedang tampil */
  function resync(force) {
    if (!on || (!force && paused)) return;
    const v = Reader.view, d = Reader.doc;
    if (!v) return;
    if (d.kind === 'flow') { const p = v.pos(); st = { kind: 'flow', sec: p.s, i: p.b, k: 0, list: null }; }
    else st = { kind: 'fixed', p: v.cur, k: 0, list: null };
    speak();
  }
  async function unit() {
    const v = Reader.view, d = Reader.doc;
    if (!v || !st) return null;
    if (st.kind === 'flow') {
      for (let guard = 0; guard < 5000; guard++) {
        if (v.sec !== st.sec) await v.show(st.sec, null);
        const bl = v.blocks();
        if (st.i >= bl.length) {
          if (st.sec >= d.sections.length - 1) return null;
          st.sec++; st.i = 0; st.k = 0; st.list = null;
          continue;
        }
        const b = bl[st.i];
        if (!st.list) st.list = chunks(b.textContent || '');
        if (st.k >= st.list.length) { st.i++; st.k = 0; st.list = null; continue; }
        return { text: st.list[st.k], el: b };
      }
      return null;
    }
    for (let guard = 0; guard < 5000; guard++) {
      if (st.p >= d.pageCount) return null;
      if (!st.list) st.list = chunks(await d.text(st.p));
      if (st.k >= st.list.length) { st.p++; st.k = 0; st.list = null; continue; }
      if (v.cur !== st.p) v.go({ p: st.p, y: 0 });
      return { text: st.list[st.k] };
    }
    return null;
  }
  async function speak() {
    const my = ++tok;
    try { speechSynthesis.cancel(); } catch (e) { /* abaikan */ }
    const u = await unit();
    if (my !== tok || !on) return;
    if (!u) { stop(); toast('Selesai dibacakan'); return; }
    if (u.el) {
      const r = document.createRange(); r.selectNodeContents(u.el);
      setHighlight('rb-tts', [r]);
      if (!Reader.view.isVisible(u.el)) Reader.view.showEl(u.el, 0, true);
    }
    const ut = new SpeechSynthesisUtterance(u.text);
    const vc = voice();
    try { if (vc) { ut.voice = vc; ut.lang = vc.lang; } else ut.lang = lang() === 'id' ? 'id-ID' : lang(); } catch (e) { ut.lang = 'id-ID'; }
    ut.rate = Settings.get('ttsRate') || 1;
    const t0 = Date.now();
    // ucapan yang gagal atau "selesai" seketika berarti mesin suara tidak bekerja: berhenti, jangan melompati buku
    const failed = () => {
      if (++fails < 3) return false;
      const v = Reader.view, h = home;
      stop();
      if (v && h) { if (h.s != null) v.show(h.s, { b: h.b, o: h.o }); else v.go(h); }
      toast('Suara pembaca tidak bisa diputar di perangkat ini.', 'bad');
      return true;
    };
    ut.onend = () => {
      if (my !== tok || !on || paused) return;
      const quick = Date.now() - t0 < 60;
      if (quick && u.text.length > 5) { if (failed()) return; } else if (!quick) fails = 0;
      st.k++; speak();
    };
    ut.onerror = e => { if (my === tok && on && !paused && !/interrupted|canceled/.test(e.error)) { if (failed()) return; st.k++; speak(); } };
    speechSynthesis.speak(ut);
  }
  function showBar() {
    bar?.remove();
    bar = el('div', { class: 'tts', role: 'toolbar', 'aria-label': 'Bacakan' });
    const vs = ok() ? speechSynthesis.getVoices() : [];
    const opts = vs.filter(v => v.lang?.toLowerCase().startsWith(lang())).concat(vs.filter(v => !v.lang?.toLowerCase().startsWith(lang())));
    bar.innerHTML = `<button class="icon-btn" data-a="back" title="Sebelumnya" aria-label="Paragraf sebelumnya">${icon('prev')}</button>
      <button class="icon-btn" data-a="pause" title="Jeda" aria-label="Jeda">${icon('pause')}</button>
      <button class="icon-btn" data-a="fwd" title="Berikutnya" aria-label="Paragraf berikutnya">${icon('next')}</button>
      <select data-a="rate" aria-label="Kecepatan">${[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map(r => `<option value="${r}" ${r === (Settings.get('ttsRate') || 1) ? 'selected' : ''}>${r}×</option>`).join('')}</select>
      ${opts.length ? `<select data-a="voice" aria-label="Suara"><option value="">Suara otomatis</option>${opts.map(v => `<option value="${esc(v.name)}" ${v.name === Settings.get('ttsVoice') ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>` : ''}
      <button class="icon-btn" data-a="stop" title="Berhenti" aria-label="Berhenti membacakan">${icon('stop')}</button>`;
    bar.onclick = e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'stop') stop();
      else if (a === 'pause') {
        paused = !paused;
        e.target.closest('button').innerHTML = icon(paused ? 'play' : 'pause');
        if (paused) { tok++; speechSynthesis.cancel(); } else speak();
      } else if (a === 'fwd' && st) { if (st.kind === 'flow') { st.i++; st.k = 0; st.list = null; } else { st.k++; } paused = false; speak(); }
      else if (a === 'back' && st) { if (st.kind === 'flow') { st.i = Math.max(0, st.i - 1); st.k = 0; st.list = null; } else st.k = Math.max(0, st.k - 1); paused = false; speak(); }
    };
    bar.onchange = e => {
      if (e.target.dataset.a === 'rate') Settings.set({ ttsRate: +e.target.value });
      if (e.target.dataset.a === 'voice') Settings.set({ ttsVoice: e.target.value });
      if (!paused) speak();
    };
    $('#stage').append(bar);
    $('#rd-tts')?.setAttribute('aria-pressed', 'true');
  }
  if (ok()) speechSynthesis.addEventListener?.('voiceschanged', () => { if (on && bar) { const p = paused; showBar(); paused = p; } });
  return { toggle, start, stop, resync: () => resync(false), get on() { return on; } };
})();

/* ================= Terjemahan ke bahasa Indonesia ================= */
/* Memakai penerjemah bawaan peramban (Chrome 138+): model dijalankan di perangkat, teks tidak
   dikirim ke internet. Bila tidak tersedia, pengguna bisa memilih membuka Google Terjemahan. */
const Translate = (() => {
  let box = null, run = 0;
  const tools = new Map(), memo = new Map();
  const isOpen = () => !!box;
  function close() { run++; box?.remove(); box = null; }

  /* teks yang dipilih, atau semua teks yang sedang tampil */
  async function grab() {
    const v = Reader.view, d = Reader.doc;
    const sel = getSelection();
    const st = $('#stage');
    if (sel && !sel.isCollapsed && st.contains(sel.anchorNode) && !box?.contains(sel.anchorNode)) {
      const t = sel.toString().trim();
      if (t) return { what: 'Teks pilihan', parts: split(t) };
    }
    if (d.kind === 'flow') {
      const parts = v.blocks().filter(b => v.isVisible(b)).map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { what: 'Halaman ini', parts: parts.flatMap(p => p.length > 1200 ? split(p) : [p]) };
    }
    const t = await d.text(v.cur);
    return { what: 'Halaman ' + (v.cur + 1), parts: split(t.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ')) };
  }
  function split(t) {
    const paras = t.split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = [];
    for (const p of paras) {
      if (p.length <= 900) { out.push(p); continue; }
      let cur = '';
      for (const s of p.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [p]) {
        if ((cur + s).length > 900 && cur) { out.push(cur.trim()); cur = ''; }
        cur += s;
      }
      if (cur.trim()) out.push(cur.trim());
    }
    return out;
  }
  const API = () => typeof self.Translator !== 'undefined' && self.Translator?.create ? self.Translator : null;
  async function detect(text) {
    try {
      if (typeof self.LanguageDetector !== 'undefined') {
        const det = await self.LanguageDetector.create();
        const [best] = await det.detect(text.slice(0, 2000));
        if (best && best.confidence > 0.5 && best.detectedLanguage !== 'und') return best.detectedLanguage.split('-')[0];
      }
    } catch (e) { /* pakai bahasa dokumen */ }
    return (Reader.doc?.lang || 'en').toLowerCase().split('-')[0] || 'en';
  }
  async function tool(src, onProgress) {
    if (tools.has(src)) return tools.get(src);
    const T = API();
    const avail = await T.availability({ sourceLanguage: src, targetLanguage: 'id' });
    if (avail === 'unavailable' || avail === 'no') return null;
    const t = await T.create({ sourceLanguage: src, targetLanguage: 'id', monitor(m) { m.addEventListener('downloadprogress', e => onProgress(e.loaded)); } });
    tools.set(src, t);
    return t;
  }
  const google = text => 'https://translate.google.com/?sl=auto&tl=id&op=translate&text=' + encodeURIComponent(text.slice(0, 4500));

  async function open() {
    const v = Reader.view, d = Reader.doc;
    if (!v) return;
    if (d.kind === 'fixed' && !d.hasText) { toast('Dokumen ini berupa gambar sehingga teksnya tidak bisa diterjemahkan.', 'bad'); return; }
    const my = ++run;
    const { what, parts } = await grab();
    if (my !== run) return;
    box?.remove();
    box = el('div', { class: 'tr-pop', role: 'dialog', 'aria-label': 'Terjemahan bahasa Indonesia' });
    box.innerHTML = `<div class="tr-head"><b>Terjemahan bahasa Indonesia<small>${esc(what)}</small></b><button class="icon-btn" data-x aria-label="Tutup">${icon('x')}</button></div><div class="tr-body"></div><div class="tr-acts"></div>`;
    box.querySelector('[data-x]').onclick = close;
    $('#stage').append(box);
    const body = $('.tr-body', box), acts = $('.tr-acts', box);
    const all = parts.join('\n\n');
    if (!parts.length) { body.innerHTML = '<div class="tr-msg">Tidak ada teks di halaman ini. Pilih teks yang ingin diterjemahkan lalu tekan tombol terjemahkan lagi.</div>'; return; }
    const btn = (label, fn, cls = '') => { const b = el('button', { class: 'btn ' + cls, text: label }); b.onclick = fn; acts.append(b); return b; };
    const toGoogle = () => { window.open(google(all), '_blank', 'noopener'); };
    if (!API()) {
      body.innerHTML = `<div class="tr-msg"><p>Penerjemah bawaan peramban tidak tersedia di sini. Fitur ini butuh Google Chrome versi 138 atau lebih baru di komputer, dan menerjemahkan langsung di perangkat tanpa internet.</p><p>Sebagai gantinya, teks bisa dibuka di Google Terjemahan. <b>Teks akan dikirim ke Google</b> dan butuh internet.</p></div>`;
      btn('Tutup', close);
      btn('Buka di Google Terjemahan', () => { toGoogle(); close(); }, 'primary');
      return;
    }
    const src = await detect(all);
    if (my !== run) return;
    if (src === 'id' || src === 'ms') { body.innerHTML = '<div class="tr-msg">Teks ini sudah berbahasa Indonesia.</div>'; btn('Tutup', close, 'primary'); return; }
    const items = parts.map(p => {
      const it = el('div', { class: 'tr-item' }, el('div', { class: 'src', text: p.length > 240 ? p.slice(0, 240) + '…' : p }), el('div', { class: 'dst wait', text: 'Menerjemahkan…' }));
      body.append(it);
      return it;
    });
    let t;
    try {
      t = await tool(src, loaded => { if (my === run) items[0].lastChild.textContent = `Mengunduh model terjemahan… ${Math.round(loaded * 100)}%`; });
    } catch (e) { t = null; console.warn('penerjemah', e); }
    if (my !== run) return;
    if (!t) {
      body.innerHTML = `<div class="tr-msg"><p>Penerjemah bawaan belum bisa menerjemahkan dari bahasa ini (${esc(src)}) ke bahasa Indonesia di perangkat ini.</p><p>Buka di Google Terjemahan? <b>Teks akan dikirim ke Google.</b></p></div>`;
      btn('Tutup', close);
      btn('Buka di Google Terjemahan', () => { toGoogle(); close(); }, 'primary');
      return;
    }
    const done = [];
    for (let i = 0; i < parts.length; i++) {
      const key = src + '\u0000' + parts[i];
      let out = memo.get(key);
      if (out == null) {
        try { out = await t.translate(parts[i]); memo.set(key, out); } catch (e) { out = null; console.warn('terjemah', e); }
      }
      if (my !== run) return;
      const dst = items[i].lastChild;
      dst.classList.remove('wait');
      dst.textContent = out ?? '(gagal diterjemahkan)';
      done.push(out ?? '');
    }
    btn('Buka di Google Terjemahan', toGoogle);
    btn('Salin terjemahan', async () => {
      try { await navigator.clipboard.writeText(done.join('\n\n')); toast('Terjemahan disalin'); } catch (e) { toast('Tidak bisa menyalin di sini; pilih teks terjemahan lalu tekan Ctrl+C.', 'bad'); }
    });
    btn('Tutup', close, 'primary');
  }
  return { open, close, isOpen };
})();
