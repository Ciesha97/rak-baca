/* ================= Rak ================= */
const REPO_URL = 'https://github.com/Ciesha97/rak-baca';
const Shelf = (() => {
  let books = [], filter = 'all', query = '';
  const covers = new Map(), memFiles = new Map();
  const PALETTE = ['#7a3b2e', '#2f5d50', '#34507a', '#6b4a7a', '#7a6232', '#2e6470', '#56603a', '#7a3355', '#3f4f5f', '#6a442a'];
  const color = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return PALETTE[Math.abs(h) % PALETTE.length]; };

  async function load() {
    try { books = await Store.books.all(); } catch (e) { books = []; console.warn(e); }
    render();
  }
  function coverUrl(b) {
    if (!b.cover) return null;
    const c = covers.get(b.id);
    if (c && c.blob === b.cover) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    const url = URL.createObjectURL(b.cover);
    covers.set(b.id, { blob: b.cover, url });
    return url;
  }
  function coverHtml(b) {
    const u = coverUrl(b);
    const inner = u ? `<img src="${u}" alt="" loading="lazy">` : `<span class="gen" style="--c:${color(b.title)}"><b>${esc(b.title)}</b><i>${esc(b.author || '')}</i></span>`;
    return `<span class="cover">${inner}<span class="fmt">${esc(FMT_LABEL[b.format] || (b.format || '').toUpperCase())}</span></span>`;
  }
  const progLabel = b => !b.progress || b.progress < 0.005 ? 'Belum dibaca' : b.progress >= 0.99 ? '<span class="done">Selesai</span>' : Math.round(b.progress * 100) + '%';
  function sorted(list) {
    const k = Settings.get('sort');
    const by = {
      opened: (a, b) => (b.opened || b.added) - (a.opened || a.added),
      added: (a, b) => b.added - a.added,
      title: (a, b) => collator.compare(a.title, b.title),
      progress: (a, b) => (b.progress || 0) - (a.progress || 0),
    }[k] || ((a, b) => b.added - a.added);
    return list.slice().sort(by);
  }
  function render() {
    if (Reader.isOpen()) return;
    const q = foldQuery(query);
    const has = books.length > 0;
    $('#empty').hidden = has;
    $('#lib-wrap').hidden = !has;
    $('#sort').value = Settings.get('sort');
    if (!has) {
      $('#resume-wrap').hidden = true;
      $('#fmts').innerHTML = FORMATS.map(f => `<span>${esc(f[0])}</span>`).join('');
      foot();
      return;
    }
    // pilihan format
    const counts = {};
    for (const b of books) counts[b.format] = (counts[b.format] || 0) + 1;
    if (filter !== 'all' && !counts[filter]) filter = 'all';
    const kinds = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    $('#chips').innerHTML = kinds.length > 1 ? [`<button class="chip" data-f="all" aria-pressed="${filter === 'all'}">Semua<span class="n">${books.length}</span></button>`]
      .concat(kinds.map(k => `<button class="chip" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(FMT_LABEL[k] || k)}<span class="n">${counts[k]}</span></button>`)).join('') : '';
    // lanjutkan membaca
    const resume = !q && filter === 'all' ? books.filter(b => b.opened && b.progress > 0.003 && b.progress < 0.99).sort((a, b) => b.opened - a.opened)[0] : null;
    $('#resume-wrap').hidden = !resume;
    if (resume) {
      $('#resume').innerHTML = `<button class="resume" data-open="${esc(resume.id)}">${coverHtml(resume)}<span><b>${esc(resume.title)}</b><span class="who">${esc(resume.author || resume.name)}</span><span class="bar" style="display:block"><i style="width:${Math.round(resume.progress * 100)}%"></i></span><span class="go">${icon('book')}Lanjutkan · ${Math.round(resume.progress * 100)}% · ${esc(fmtAgo(resume.opened))}</span></span></button>`;
    }
    const list = sorted(books.filter(b => (filter === 'all' || b.format === filter) && (!q || foldQuery(`${b.title} ${b.author || ''} ${b.name}`).includes(q))));
    $('#lib-title').textContent = q ? `Hasil pencarian (${list.length})` : 'Rak saya';
    $('#nores').hidden = list.length > 0;
    $('#grid').innerHTML = list.map(b => `<article class="card" data-id="${esc(b.id)}">
      <button class="card-open" data-open="${esc(b.id)}" aria-label="Buka ${esc(b.title)}">${coverHtml(b)}</button>
      <button class="icon-btn more" data-more="${esc(b.id)}" aria-label="Pilihan untuk ${esc(b.title)}" aria-expanded="false">${icon('more')}</button>
      <div><div class="t" title="${esc(b.title)}">${esc(b.title)}</div><div class="a">${esc(b.author || b.name)}</div>
      <div class="s"><span>${progLabel(b)}</span><span>${esc(b.opened ? fmtAgo(b.opened) : '')}</span></div>
      ${b.progress > 0.003 ? `<div class="bar" style="margin-top:5px"><i style="width:${Math.round(b.progress * 100)}%"></i></div>` : ''}</div>
    </article>`).join('');
    foot();
  }
  async function foot() {
    const total = books.reduce((t, b) => t + (b.size || 0), 0);
    const parts = [];
    if (books.length) parts.push(`${books.length} dokumen · ${fmtSize(total)}`);
    parts.push(Store.persistent ? 'Disimpan di perangkat ini' : 'Penyimpanan peramban tidak tersedia: rak hanya bertahan selama halaman ini terbuka');
    parts.push('Tidak ada yang dikirim ke internet');
    const ver = document.querySelector('meta[name="version"]')?.content;
    const est = await Store.estimate();
    if (est?.quota && est.usage != null) parts.push(`Ruang terpakai ${fmtSize(est.usage)} dari ${fmtSize(est.quota)}`);
    $('#foot').innerHTML = parts.map(p => `<span>${esc(p)}</span>`).join('') + `<span style="margin-left:auto">Rak Baca${ver && !/@/.test(ver) ? ' v' + esc(ver) : ''} · <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">kode sumber &amp; panduan</a></span>`;
  }

  /* ---------- menambah dokumen ---------- */
  async function quickFormat(file) {
    const k = await detect(file);
    if (k !== 'zip') return k;
    const z = zipKind(await openZip(file), file.name);
    if (z.error) throw new FormatError(z.error);
    if (z.inner) { const e = extOf(z.inner); const f = FORMATS.find(x => x[1].includes(e)); return f ? ({ PDF: 'pdf', EPUB: 'epub', MOBI: 'mobi', FB2: 'fb2', DOCX: 'docx', ODT: 'odt', RTF: 'rtf', TXT: 'txt', MD: 'md', HTML: 'html', CSV: 'csv', CBZ: 'cbz' }[f[0]] || 'txt') : 'txt'; }
    return z.kind;
  }
  async function add(files, { open = true } = {}) {
    const list = Array.from(files || []).filter(f => f && f.size > 0);
    if (!list.length) { if (files?.length) toast('Berkas kosong.', 'bad'); return; }
    const added = [];
    for (const f of list) {
      try { added.push(await addOne(f)); } catch (e) { console.warn(e); toast(`${baseName(f.name)}: ${e instanceof FormatError ? e.message : 'tidak bisa ditambahkan (' + (e.message || e) + ')'}`, 'bad'); }
    }
    if (!added.length) return;
    Store.persist();
    if (open && added.length === 1) { App.openBook(added[0].book.id); }
    else { render(); const fresh = added.filter(a => a.fresh).length; toast(fresh ? `${fresh} dokumen ditambahkan ke rak` : 'Dokumen sudah ada di rak'); }
    for (const a of added) if (a.fresh) queue.push(a);
    drain();
  }
  async function addOne(file) {
    const fp = `${file.name}|${file.size}|${file.lastModified || 0}`;
    const ex = books.find(b => b.fp === fp);
    if (ex) return { book: ex, fresh: false };
    const format = await quickFormat(file);
    const b = { id: uid(), fp, name: baseName(file.name), title: niceTitle(file.name), author: '', format, size: file.size, type: file.type || '', added: Date.now(), opened: 0, progress: 0, pos: null, bookmarks: [], cover: null, stored: false };
    try { await Store.files.put(file, b.id); b.stored = Store.persistent; } catch (e) {
      console.warn('gagal menyimpan berkas', e);
      toast('Ruang penyimpanan penuh: dokumen ini hanya bisa dibuka selama halaman ini terbuka.', 'bad');
    }
    if (!b.stored) memFiles.set(b.id, file);
    await Store.books.put(b);
    books.push(b);
    return { book: b, fresh: true, file };
  }
  /* metadata (judul, penulis, sampul) dibaca di latar, satu per satu */
  const queue = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const { book, file } = queue.shift();
      if (book.metaDone || file.size > 300e6 || !books.includes(book)) continue;
      let doc = null;
      try { doc = await openDocument(file, { password: async () => null }); await enrich(book, doc); }
      catch (e) { book.metaDone = true; await Store.books.put(book).catch(() => {}); }
      finally { try { doc?.close(); } catch (e) { /* abaikan */ } }
      if (!Reader.isOpen()) render();
      await sleep(30);
    }
    draining = false;
  }
  async function enrich(b, doc) {
    if (b.metaDone && (b.cover || b.noCover)) return false;
    if (doc.title && doc.title !== niceTitle(b.name)) b.title = doc.title.slice(0, 300);
    if (doc.author && !b.author) b.author = doc.author.slice(0, 200);
    if (doc.kind === 'fixed') b.pages = doc.pageCount; else b.sections = doc.sections.length;
    if (!b.cover && !b.noCover && doc.cover) {
      try { const c = await doc.cover(); if (c) b.cover = c; else b.noCover = true; } catch (e) { b.noCover = true; }
    } else if (!doc.cover) b.noCover = true;
    b.metaDone = true;
    await Store.books.put(b).catch(() => {});
    return true;
  }
  async function getFile(b) {
    if (memFiles.has(b.id)) return memFiles.get(b.id);
    try { return await Store.files.get(b.id); } catch (e) { return null; }
  }
  async function remove(b) {
    const n = b.notes?.length || 0;
    const ok = await ask({ title: 'Hapus dari rak?', body: `<p><b>${esc(b.title)}</b> beserta posisi baca, penanda${n ? `, dan <b>${n} catatan Anda</b>` : ''} akan dihapus dari rak. Berkas aslinya di komputer atau ponsel tidak terhapus.</p>${n ? '<p>Ekspor catatan ke Word lebih dulu bila ingin menyimpannya.</p>' : ''}`, ok: 'Hapus', danger: true });
    if (!ok) return;
    await Store.books.del(b.id).catch(() => {});
    await Store.files.del(b.id).catch(() => {});
    memFiles.delete(b.id);
    const c = covers.get(b.id); if (c) { URL.revokeObjectURL(c.url); covers.delete(b.id); }
    books = books.filter(x => x !== b);
    render();
    toast('Dokumen dihapus dari rak');
  }
  async function downloadFile(b) {
    if (!b) return;
    const f = await getFile(b);
    if (!f) { toast('Berkas aslinya tidak ditemukan.', 'bad'); return; }
    download(f, b.name);
  }
  function info(b, doc) {
    if (!b) return;
    const rows = [
      ['Judul', b.title], ['Penulis', b.author || '–'], ['Berkas', b.name], ['Format', FMT_LABEL[b.format] || b.format], ['Ukuran', fmtSize(b.size)],
      doc?.kind === 'fixed' || b.pages ? ['Halaman', NF.format(doc?.pageCount || b.pages)] : (doc?.sections || b.sections) ? ['Bagian', NF.format(doc?.sections?.length || b.sections)] : null,
      doc?.lang ? ['Bahasa', doc.lang] : null,
      ['Ditambahkan', fmtDate(b.added)], ['Terakhir dibaca', b.opened ? fmtAgo(b.opened) : 'Belum pernah'],
      ['Kemajuan', Math.round((b.progress || 0) * 100) + '%'], ['Penanda', String(b.bookmarks?.length || 0)], ['Catatan', String(b.notes?.length || 0)],
      ['Penyimpanan', b.stored ? 'Tersimpan di perangkat ini' : 'Sementara (hilang saat halaman ditutup)'],
    ].filter(Boolean);
    ask({ title: 'Info dokumen', body: `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`, ok: 'Tutup', cancel: false });
  }
  function bind() {
    const pick = () => { const f = $('#file'); f.accept = ACCEPT; f.click(); };
    $('#btn-open').onclick = pick;
    $('#btn-open2').onclick = pick;
    $('#file').onchange = e => { const fs = Array.from(e.target.files || []); e.target.value = ''; add(fs); };
    $('#q').oninput = debounce(e => { query = e.target.value; render(); }, 120);
    $('#sort').onchange = e => { Settings.set({ sort: e.target.value }); render(); };
    $('#chips').onclick = e => { const c = e.target.closest('[data-f]'); if (c) { filter = c.dataset.f; render(); } };
    $('#btn-theme').onclick = () => {
      const order = ['auto', 'light', 'sepia', 'dark'], names = { auto: 'Otomatis (ikut sistem)', light: 'Terang', sepia: 'Sepia', dark: 'Gelap' };
      const t = order[(order.indexOf(Settings.get('theme')) + 1) % order.length];
      Settings.set({ theme: t });
      toast('Tema: ' + names[t]);
    };
    document.addEventListener('click', e => {
      if (Reader.isOpen()) return;
      const o = e.target.closest('[data-open]');
      if (o) { App.openBook(o.dataset.open); return; }
      const m = e.target.closest('[data-more]');
      if (m) {
        const b = books.find(x => x.id === m.dataset.more);
        if (!b) return;
        popMenu(m, [
          { label: 'Buka', icon: 'book', run: () => App.openBook(b.id) },
          { label: 'Info dokumen', icon: 'info', run: () => info(b) },
          { label: 'Unduh berkas asli', icon: 'download', run: () => downloadFile(b) },
          b.notes?.length ? { label: `Ekspor ${b.notes.length} catatan ke Word`, icon: 'note', run: () => Notes.exportDocx(b) } : null,
          '-',
          { label: 'Hapus dari rak', icon: 'trash', danger: true, run: () => remove(b) },
        ]);
      }
    });
    document.addEventListener('keydown', e => {
      if (Reader.isOpen() || $('#dlg').open) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); pick(); }
      else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('#q').focus(); }
    });
    // seret & lepas berkas ke mana saja
    let depth = 0;
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
    addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#drop').hidden = false; });
    addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#drop').hidden = true; });
    addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; $('#drop').hidden = true;
      const fs = Array.from(e.dataTransfer.files || []);
      if (Reader.isOpen()) App.toShelf();
      add(fs);
    });
  }
  return { load, render, add, enrich, getFile, info, downloadFile, remove, bind, get books() { return books; } };
})();

/* ================= Aplikasi ================= */
const App = (() => {
  let fromShelf = false;
  async function route() {
    const m = /^#baca\/(.+)$/.exec(location.hash);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (Reader.book?.id === id) return;
      if (Reader.isOpen()) Reader.close();
      const b = Shelf.books.find(x => x.id === id);
      const f = b && await Shelf.getFile(b);
      if (!b || !f) { toast('Dokumen tidak ditemukan di rak.', 'bad'); clearHash(); return; }
      Reader.open(b, f);
    } else if (Reader.isOpen()) {
      Reader.close();
      Shelf.render();
    }
  }
  function clearHash() {
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { location.hash = ''; }
    route();
  }
  function openBook(id) { fromShelf = !Reader.isOpen(); location.hash = '#baca/' + encodeURIComponent(id); }
  function toShelf() {
    if (!location.hash.startsWith('#baca/')) { if (Reader.isOpen()) { Reader.close(); Shelf.render(); } return; }
    if (fromShelf) { fromShelf = false; history.back(); } else clearHash();
  }
  async function init() {
    applyTheme();
    await Store.open();
    Reader.bind();
    Shelf.bind();
    await Shelf.load();
    addEventListener('hashchange', route);
    await route();
  }
  return { init, openBook, toShelf };
})();

App.init().catch(e => { console.error(e); toast('Gagal memulai Rak Baca: ' + (e.message || e), 'bad'); });
