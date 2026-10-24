/* ================= Format dokumen ================= */
const FORMATS = [
  ['PDF', ['pdf']], ['EPUB', ['epub']], ['MOBI', ['mobi', 'prc', 'azw']], ['FB2', ['fb2']], ['DOCX', ['docx', 'docm', 'dotx']], ['ODT', ['odt', 'ott']],
  ['RTF', ['rtf']], ['TXT', ['txt', 'text']], ['MD', ['md', 'markdown', 'mdown', 'mkd']], ['HTML', ['html', 'htm', 'xhtml', 'xht']],
  ['CSV', ['csv', 'tsv']], ['CBZ', ['cbz']], ['Gambar', ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']],
  ['Kode', ['json', 'xml', 'log', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'js', 'mjs', 'ts', 'css', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'srt', 'vtt', 'tex', 'kt', 'swift', 'lua', 'r', 'pl']],
];
const CODE_EXT = new Set(FORMATS.find(f => f[0] === 'Kode')[1]);
const ACCEPT = FORMATS.flatMap(f => f[1]).map(e => '.' + e).concat(['.zip', '.fb2.zip']).join(',');
const FMT_LABEL = { pdf: 'PDF', epub: 'EPUB', mobi: 'MOBI', fb2: 'FB2', docx: 'DOCX', odt: 'ODT', rtf: 'RTF', txt: 'TXT', md: 'MD', html: 'HTML', csv: 'CSV', cbz: 'CBZ', image: 'GAMBAR', code: 'KODE' };

class FormatError extends Error {}

async function detect(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const s = latin1(head);
  const ext = extOf(file.name);
  if (s.slice(0, 1024).includes('%PDF-')) return 'pdf';
  if (s.startsWith('PK\x03\x04') || s.startsWith('PK\x05\x06')) return 'zip';
  if (/^(BOOKMOBI|TEXtREAd)$/.test(s.slice(60, 68))) return 'mobi';
  if (/^\s*\{\\rtf/.test(s)) return 'rtf';
  if (sniffImage(head)) return 'image';
  if (/<FictionBook[\s>]/.test(s)) return 'fb2';
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return 'md';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (/^(html?|xhtml?|xht)$/.test(ext)) return 'html';
  if (/^\s*(<\?xml[^>]*>\s*)?(<\!--[\s\S]*?-->\s*)*(<!doctype html|<html[\s>])/i.test(s)) return 'html';
  if (CODE_EXT.has(ext)) return 'code';
  if (ext === 'txt' || ext === 'text' || !ext) return 'txt';
  // berkas teks lain (tanpa byte nol di awal) tetap bisa dibaca sebagai teks
  const n0 = head.subarray(0, 2048).filter(b => b === 0).length;
  if (head.length && (n0 === 0 || (head[0] === 0xFF && head[1] === 0xFE) || (head[0] === 0xFE && head[1] === 0xFF))) return 'txt';
  if (/^(doc|xls|ppt)$/.test(ext)) throw new FormatError('Format Office lama (.' + ext + ') belum didukung. Simpan ulang sebagai .docx atau PDF lalu buka lagi.');
  throw new FormatError('Format berkas ini belum dikenali.');
}

/* Membuka berkas menjadi objek dokumen: kind "flow" (teks mengalir) atau "fixed" (halaman tetap) */
async function openDocument(file, hooks = {}) {
  let kind = await detect(file);
  if (kind === 'zip') {
    const zip = await openZip(file);
    const z = zipKind(zip, file.name);
    if (z.inner) {
      const b = await zip.blob(z.inner, 'application/octet-stream');
      const inner = new File([b], baseName(z.inner));
      const d = await openDocument(inner, hooks);
      d.format = d.format || 'zip';
      return d;
    }
    if (z.kind === 'epub') return loadEpub(zip, file);
    if (z.kind === 'docx') return loadDocx(zip, file);
    if (z.kind === 'odt') return loadOdt(zip, file);
    if (z.kind === 'cbz') return loadCbz(zip, file);
    throw new FormatError(z.error || 'Arsip ZIP ini tidak berisi dokumen yang bisa dibaca.');
  }
  switch (kind) {
    case 'pdf': return loadPdf(file, hooks);
    case 'mobi': return loadMobi(file);
    case 'image': return loadImage(file);
    case 'fb2': return loadFb2(new Uint8Array(await file.arrayBuffer()), file);
    case 'rtf': { const b = new Uint8Array(await file.arrayBuffer()); const m = rtfMeta(b); return flowOf(file, 'rtf', [{ frag: rtfToFrag(b) }], { title: m.title || niceTitle(file.name), author: m.author }); }
    case 'html': return loadHtml(new Uint8Array(await file.arrayBuffer()), file);
    case 'md': return loadMd(decodeText(new Uint8Array(await file.arrayBuffer())), file);
    case 'csv': return flowOf(file, 'csv', [{ frag: csvToFrag(decodeText(new Uint8Array(await file.arrayBuffer())), extOf(file.name)) }], { wide: true, scrollOnly: true });
    case 'code': return flowOf(file, 'code', codeToParts(decodeText(new Uint8Array(await file.arrayBuffer())), extOf(file.name)), { mono: true });
    default: return loadTxt(decodeText(new Uint8Array(await file.arrayBuffer())), file);
  }
}
function zipKind(zip, name) {
  const names = zip.names;
  const has = n => zip.has(n);
  if (has('META-INF/container.xml') || names.some(n => /\.opf$/i.test(n))) return { kind: 'epub' };
  if (has('word/document.xml') || has('[Content_Types].xml') && names.some(n => /^word\//.test(n))) return { kind: 'docx' };
  if (has('content.xml') && (has('mimetype') || has('META-INF/manifest.xml'))) return { kind: 'odt' };
  if (has('xl/workbook.xml')) return { error: 'Lembar kerja Excel (.xlsx) belum didukung. Ekspor ke CSV atau PDF untuk dibaca.' };
  if (has('ppt/presentation.xml')) return { error: 'Presentasi PowerPoint (.pptx) belum didukung. Ekspor ke PDF untuk dibaca.' };
  const files = names.filter(n => !/(^|\/)(__MACOSX|\.)/.test(n));
  const imgs = files.filter(isImageName);
  if (imgs.length && imgs.length >= files.length * 0.6) return { kind: 'cbz' };
  const docs = files.filter(n => FORMATS.some(f => f[0] !== 'Gambar' && f[0] !== 'Kode' && f[1].includes(extOf(n))));
  if (docs.length === 1) return { inner: docs[0] };
  if (docs.length > 1) return { error: 'Arsip ZIP ini berisi ' + docs.length + ' dokumen. Ekstrak dulu lalu buka satu per satu.' };
  return { error: 'Arsip ZIP ini tidak berisi dokumen yang bisa dibaca.' };
}

/* ---------- pembangun dokumen mengalir ---------- */
const SPLIT_AT = 140000;
function splitPart(p) {
  const total = p.frag.textContent.length;
  if (total <= SPLIT_AT) return [p];
  // buka pembungkus tunggal (div/section/body) sampai ketemu deretan blok
  for (let k = 0; k < 6; k++) {
    const els = Array.from(p.frag.childNodes).filter(n => n.nodeType === 1 || n.textContent.trim());
    if (els.length !== 1 || els[0].nodeType !== 1 || !/^(div|section|article|main|body)$/i.test(els[0].localName)) break;
    const w = els[0];
    p.frag.replaceChildren(...w.childNodes);
  }
  const chunks = [];
  let cur = document.createDocumentFragment(), size = 0;
  const push = () => { if (cur.childNodes.length) chunks.push({ frag: cur }); cur = document.createDocumentFragment(); size = 0; };
  for (const n of Array.from(p.frag.childNodes)) {
    const len = n.textContent.length;
    const isHead = n.nodeType === 1 && /^(h1|h2)$/i.test(n.localName);
    if ((isHead && size > 15000) || size > 90000) push();
    cur.append(n);
    size += len;
  }
  push();
  if (chunks.length && p.title) chunks[0].title = p.title;
  return chunks;
}
/* bagian-bagian -> dokumen: pecah yang terlalu besar, susun daftar isi dari judul, perbaiki tautan antarbagian */
function buildFlow(meta, parts) {
  const secs = [];
  for (const p of parts) for (const q of splitPart(p)) secs.push(q);
  if (!secs.length) secs.push({ frag: document.createDocumentFragment() });
  const where = new Map();
  secs.forEach((s, i) => s.frag.querySelectorAll('[id]').forEach(e => where.set(e.id, i)));
  secs.forEach((s, i) => s.frag.querySelectorAll('a[data-anc]').forEach(a => {
    const t = where.get(a.dataset.anc);
    a.dataset.sec = t ?? (a.dataset.sec || i);
  }));
  let toc = meta.toc && meta.toc.map(t => ({ ...t, sec: t.sec ?? where.get(t.anc) })).filter(t => t.sec != null);
  if (!toc || !toc.length) {
    toc = [];
    secs.forEach((s, i) => {
      const heads = Array.from(s.frag.querySelectorAll('h1,h2,h3')).filter(h => txt(h));
      if (s.title && !heads.some(h => txt(h) === s.title)) toc.push({ title: s.title, lvl: 1, sec: i });
      heads.forEach((h, n) => {
        if (!h.id) h.id = 'h' + i + '-' + n;
        toc.push({ title: txt(h).slice(0, 160), lvl: +h.localName[1], sec: i, anc: h.id });
      });
    });
    const min = Math.min(...toc.map(t => t.lvl));
    toc.forEach(t => { t.lvl = clamp(t.lvl - min, 0, 4); });
    if (toc.length > 1500) toc.length = 1500;
  }
  return {
    kind: 'flow', ...meta, toc,
    sections: secs.map((s, i) => ({
      title: s.title || txt(s.frag.querySelector('h1,h2,h3')) || (secs.length > 1 ? 'Bagian ' + (i + 1) : ''),
      weight: Math.max(1, s.frag.textContent.length),
      load: async () => s.frag.cloneNode(true),
    })),
    close: meta.close || (() => {}),
  };
}
function flowOf(file, format, parts, extra = {}) {
  return buildFlow({ format, title: niceTitle(file.name), author: '', ...extra }, parts);
}

/* ---------- PDF (pdf.js disertakan di dalam berkas ini) ---------- */
let pdfjsP = null;
function pdfjs() {
  if (pdfjsP) return pdfjsP;
  pdfjsP = (async () => {
    const src = id => document.getElementById(id)?.textContent || '';
    const lib = src('pdfjs-lib');
    if (!lib) throw new FormatError('Komponen pembaca PDF tidak ditemukan di berkas aplikasi ini.');
    const mod = await import(URL.createObjectURL(new Blob([lib], { type: 'text/javascript' })));
    const wsrc = src('pdfjs-worker');
    // worker klasik dari blob (worker modul tidak jalan di halaman file://)
    const classic = wsrc.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '').split('import.meta.url').join('self.location.href');
    const ok = await new Promise(res => {
      let w;
      try { w = new Worker(URL.createObjectURL(new Blob([classic], { type: 'text/javascript' }))); } catch (e) { res(false); return; }
      const t = setTimeout(() => { w.terminate(); res(false); }, 8000);
      w.addEventListener('message', function on(e) { if (e.data?.action === 'ready') { clearTimeout(t); w.removeEventListener('message', on); mod.GlobalWorkerOptions.workerPort = w; res(true); } });
      w.addEventListener('error', () => { clearTimeout(t); w.terminate(); res(false); });
    });
    if (!ok) {
      console.warn('Worker PDF gagal, memakai mode satu utas');
      await import(URL.createObjectURL(new Blob([wsrc], { type: 'text/javascript' })));
    }
    return mod;
  })().catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}
const WASM = {};
class EmbeddedData {
  constructor() {}
  async fetch({ kind, filename }) {
    if (kind === 'wasmUrl') {
      if (!WASM[filename]) {
        const id = { 'jbig2.wasm': 'pdfjs-wasm-jbig2', 'openjpeg.wasm': 'pdfjs-wasm-openjpeg' }[filename];
        const b64 = id && document.getElementById(id)?.textContent.trim();
        if (!b64) throw new Error('tidak ada ' + filename);
        const bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        WASM[filename] = u;
      }
      return WASM[filename].slice();
    }
    throw new Error('data ' + kind + ' tidak tersedia');
  }
}
async function loadPdf(file, hooks) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({
    data, BinaryDataFactory: EmbeddedData, useWorkerFetch: false, isEvalSupported: false, enableXfa: false,
    disableAutoFetch: true, verbosity: 0, useSystemFonts: true,
  });
  let cancelled = false;
  task.onPassword = async (update, reason) => {
    const pw = hooks.password ? await hooks.password(reason === lib.PasswordResponses.INCORRECT_PASSWORD) : null;
    if (pw == null) { cancelled = true; task.destroy(); } else update(pw);
  };
  let pdf;
  try { pdf = await task.promise; } catch (e) {
    if (cancelled || e?.name === 'PasswordException') throw new FormatError('Dokumen PDF ini dilindungi kata sandi.');
    if (e?.name === 'InvalidPDFException') throw new FormatError('Berkas PDF rusak atau tidak lengkap.');
    throw e;
  }
  const n = pdf.numPages;
  const pages = new Map(), sizes = new Array(n);
  const getPage = i => { if (!pages.has(i)) pages.set(i, pdf.getPage(i + 1)); return pages.get(i); };
  const p0 = await getPage(0);
  const vp0 = p0.getViewport({ scale: 1 });
  sizes[0] = { w: vp0.width, h: vp0.height };
  let info = {};
  try { info = (await pdf.getMetadata()).info || {}; } catch (e) { /* tanpa metadata */ }
  const destPage = async dest => {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const ref = dest[0];
      return typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
    } catch (e) { return null; }
  };
  const toc = [];
  try {
    const outline = await pdf.getOutline();
    const walk = async (items, lvl) => {
      for (const it of items || []) {
        if (toc.length > 2000) return;
        const p = it.dest ? await destPage(it.dest) : null;
        toc.push({ title: String(it.title || '').trim() || '(tanpa judul)', lvl: Math.min(lvl, 4), page: p, url: it.url || null });
        if (it.items?.length) await walk(it.items, lvl + 1);
      }
    };
    await walk(outline, 0);
  } catch (e) { /* tanpa kerangka */ }
  const texts = new Map();
  const textOf = async i => {
    if (!texts.has(i)) texts.set(i, (async () => {
      const page = await getPage(i);
      const tc = await page.getTextContent();
      return tc.items.map(t => (t.str || '') + (t.hasEOL ? '\n' : '')).join('');
    })().catch(() => ''));
    return texts.get(i);
  };
  // ukuran semua halaman diambil di latar supaya tata letak gulir stabil
  const sizesReady = (async () => {
    for (let i = 1; i < n; i++) {
      try { const p = await getPage(i); const v = p.getViewport({ scale: 1 }); sizes[i] = { w: v.width, h: v.height }; } catch (e) { sizes[i] = sizes[0]; }
      if (i % 50 === 0) await sleep(0);
      if (pdf.destroyed) return;
    }
  })();
  return {
    kind: 'fixed', format: 'pdf', pdf, lib, toc,
    title: (typeof info.Title === 'string' && info.Title.trim().length > 1 && !/^(untitled|microsoft word|document\d*)/i.test(info.Title.trim())) ? info.Title.trim() : niceTitle(file.name),
    author: typeof info.Author === 'string' && !/^(anonymous|unknown|user|admin(istrator)?|owner)$/i.test(info.Author.trim()) ? info.Author.trim() : '',
    lang: typeof info.Language === 'string' ? info.Language : '',
    pageCount: n, unit: 96 / 72, hasText: true,
    size: i => sizes[i] || sizes[0],
    sizesReady,
    getPage, destPage, text: textOf,
    async cover() {
      const page = await getPage(0);
      const vp = page.getViewport({ scale: 1 });
      const sc = 360 / vp.width;
      const v = page.getViewport({ scale: sc });
      const c = document.createElement('canvas'); c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, viewport: v }).promise;
      return thumbnail(c, 360);
    },
    close() { try { task.destroy(); } catch (e) { /* sudah ditutup */ } },
  };
}

/* ---------- gambar & komik ---------- */
function imagePages(meta, list) {
  const urls = new Map(), sizes = [];
  const url = async i => {
    if (!urls.has(i)) urls.set(i, list[i].blob().then(blobUrl));
    return urls.get(i);
  };
  return {
    kind: 'fixed', ...meta, pageCount: list.length, unit: 1, hasText: false, preferSingle: true, toc: [],
    size: i => sizes[i] || sizes.find(Boolean) || { w: 1000, h: 1414 },
    async sizeAsync(i) { if (!sizes[i]) sizes[i] = (await imageSize(await url(i))) || { w: 1000, h: 1414 }; return sizes[i]; },
    url, text: async () => '',
    async cover() { return thumbnail(await list[0].blob()); },
    close() { for (const p of urls.values()) p.then(revokeUrl); urls.clear(); },
  };
}
async function loadImage(file) {
  const doc = imagePages({ format: 'image', title: niceTitle(file.name), author: '' }, [{ name: file.name, blob: async () => file }]);
  await doc.sizeAsync(0);
  return doc;
}
async function loadCbz(zip, file) {
  const names = zip.names.filter(n => isImageName(n) && !/(^|\/)(__MACOSX|\.)/.test(n)).sort(collator.compare);
  if (!names.length) throw new FormatError('Komik ini tidak berisi gambar.');
  let title = niceTitle(file.name), author = '';
  const ci = zip.names.find(n => /comicinfo\.xml$/i.test(n));
  if (ci) { try { const d = parseXML(await zip.text(ci)); title = txt(desc1(d, 'Title')) || title; author = txt(desc1(d, 'Writer')); } catch (e) { /* abaikan */ } }
  const doc = imagePages({ format: 'cbz', title, author }, names.map(n => ({ name: n, blob: () => zip.blob(n) })));
  await doc.sizeAsync(0);
  return doc;
}

/* ---------- EPUB ---------- */
async function loadEpub(zip, file) {
  let opfPath = '';
  try {
    const c = parseXML(await zip.text('META-INF/container.xml'));
    opfPath = desc(c, 'rootfile').map(r => r.getAttribute('full-path')).find(p => p && /\.opf$/i.test(p)) || desc1(c, 'rootfile')?.getAttribute('full-path') || '';
  } catch (e) { /* cari manual */ }
  if (!opfPath || !zip.has(opfPath)) opfPath = zip.names.find(n => /\.opf$/i.test(n));
  if (!opfPath) throw new FormatError('EPUB rusak: berkas paket (.opf) tidak ditemukan.');
  const opf = parseXML(await zip.text(opfPath));
  const md = desc1(opf, 'metadata');
  const dc = name => desc(md, name).map(txt).filter(Boolean);
  const manifest = new Map();
  for (const it of desc(opf, 'item')) manifest.set(it.getAttribute('id'), { href: resolvePath(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const byPath = new Map([...manifest.values()].map(m => [m.href, m]));
  const spineEl = desc1(opf, 'spine');
  const spine = desc(spineEl, 'itemref').map(r => manifest.get(r.getAttribute('idref'))).filter(m => m && /x?html|xml|^$/.test(m.type) && !/ncx/.test(m.type) && zip.has(m.href));
  if (!spine.length) throw new FormatError('EPUB ini tidak berisi bab yang bisa dibaca.');
  const secOf = new Map(spine.map((m, i) => [m.href.toLowerCase(), i]));
  const target = (base, href) => {
    const [p, frag] = String(href || '').split('#');
    const path = p ? resolvePath(base, p) : base;
    const sec = secOf.get(path.toLowerCase());
    if (sec == null) return null;
    let anc = frag || '';
    try { anc = decodeURIComponent(anc); } catch (e) { /* biarkan */ }
    return { sec, anc: anc ? 's' + sec + '-' + anc : '' };
  };
  // daftar isi: nav EPUB 3, lalu NCX EPUB 2
  let toc = [];
  const navItem = [...manifest.values()].find(m => /\bnav\b/.test(m.props));
  if (navItem && zip.has(navItem.href)) {
    try {
      const d = parseXHTML(await zip.text(navItem.href));
      const navs = Array.from(d.getElementsByTagName('nav'));
      const nav = navs.find(n => /toc/.test(epubType(n))) || navs[0];
      const walk = (ol, lvl) => {
        for (const li of kids(ol, 'li')) {
          const a = kid(li, 'a') || kid(li, 'span');
          const t = target(navItem.href, a?.getAttribute('href'));
          const title = txt(a);
          if (title) toc.push({ title, lvl: Math.min(lvl, 4), sec: t?.sec, anc: t?.anc });
          const sub = kid(li, 'ol') || kid(li, 'ul');
          if (sub) walk(sub, lvl + 1);
        }
      };
      const ol = nav && (kid(nav, 'ol') || nav.querySelector('ol'));
      if (ol) walk(ol, 0);
    } catch (e) { toc = []; }
  }
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncx = manifest.get(ncxId) || [...manifest.values()].find(m => /ncx/.test(m.type));
    if (ncx && zip.has(ncx.href)) {
      try {
        const d = parseXML(await zip.text(ncx.href));
        const walk = (node, lvl) => {
          for (const np of kids(node, 'navPoint')) {
            const t = target(ncx.href, kid(np, 'content')?.getAttribute('src'));
            const title = txt(desc1(kid(np, 'navLabel'), 'text'));
            if (title) toc.push({ title, lvl: Math.min(lvl, 4), sec: t?.sec, anc: t?.anc });
            walk(np, lvl + 1);
          }
        };
        walk(desc1(d, 'navMap'), 0);
      } catch (e) { toc = []; }
    }
  }
  toc = toc.filter(t => t.sec != null).slice(0, 3000);
  // sampul
  const metaCover = desc(md, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
  let coverPath = [...manifest.values()].find(m => /cover-image/.test(m.props))?.href || manifest.get(metaCover)?.href || '';
  if (!coverPath && metaCover && zip.has(resolvePath(opfPath, metaCover))) coverPath = resolvePath(opfPath, metaCover);
  if (!coverPath) coverPath = [...manifest.values()].find(m => /^image\//.test(m.type) && /cover/i.test(m.href))?.href || '';

  const urls = new Map(), css = new Map();
  const res = async path => {
    if (!urls.has(path)) urls.set(path, zip.blob(path, byPath.get(path)?.type).then(blobUrl).catch(() => null));
    return urls.get(path);
  };
  const cssText = async path => {
    if (!css.has(path)) css.set(path, zip.text(path).catch(() => ''));
    return css.get(path);
  };
  const lang = dc('language')[0] || '';
  const sections = spine.map((m, i) => ({
    title: '', weight: Math.max(1, zip.size(m.href)),
    async load(opts = {}) {
      const d = parseXHTML(await zip.text(m.href));
      const map = new Map();
      if (!opts.textOnly) {
        const sheets = [];
        for (const l of d.querySelectorAll('link')) if (/stylesheet/i.test(l.getAttribute('rel') || '')) sheets.push(await cssText(resolvePath(m.href, l.getAttribute('href'))));
        for (const s of d.querySelectorAll('style')) sheets.push(s.textContent);
        applyBookCss(d, sheets);
        const refs = new Set();
        for (const e of d.querySelectorAll('img[src], video[src], audio[src], source[src]')) refs.add(e.getAttribute('src'));
        for (const e of d.getElementsByTagNameNS(NS.svg, 'image')) refs.add(e.getAttributeNS(NS.xlink, 'href') || e.getAttribute('href'));
        await Promise.all([...refs].filter(Boolean).map(async r => {
          if (/^data:/i.test(r)) { map.set(r, safeDataImg(r)); return; }
          const p = resolvePath(m.href, r);
          if (zip.has(p)) map.set(r, await res(p));
        }));
      }
      return sanitize(d.body || d.documentElement, {
        prefix: 's' + i + '-', textOnly: opts.textOnly,
        img: src => map.get(src) || null,
        link: href => {
          if (/^(https?:|mailto:)/i.test(href)) return { ext: href };
          if (/^[a-z][\w+.-]*:/i.test(href)) return null;
          return target(m.href, href) || null;
        },
      });
    },
  }));
  toc.forEach(t => { if (!sections[t.sec].title) sections[t.sec].title = t.title; });
  return {
    kind: 'flow', format: 'epub', toc, sections, lang,
    title: dc('title')[0] || niceTitle(file.name),
    author: dc('creator').join(', '),
    async cover() {
      if (coverPath && zip.has(coverPath)) return thumbnail(await zip.blob(coverPath));
      // sampul berupa halaman XHTML pertama yang hanya berisi gambar
      try {
        const d = parseXHTML(await zip.text(spine[0].href));
        const im = d.querySelector('img') || d.getElementsByTagNameNS(NS.svg, 'image')[0];
        const src = im && (im.getAttribute('src') || im.getAttributeNS(NS.xlink, 'href') || im.getAttribute('href'));
        if (src && !/^data:/.test(src)) { const p = resolvePath(spine[0].href, src); if (zip.has(p)) return thumbnail(await zip.blob(p)); }
      } catch (e) { /* tanpa sampul */ }
      return null;
    },
    close() { for (const p of urls.values()) p.then(revokeUrl); urls.clear(); },
  };
}

/* ---------- HTML, Markdown, TXT, kode ---------- */
async function loadHtml(bytes, file) {
  const text = decodeText(bytes, htmlEncoding(bytes));
  const d = new DOMParser().parseFromString(text, 'text/html');
  applyBookCss(d, Array.from(d.querySelectorAll('style')).map(s => s.textContent));
  const frag = sanitize(d.body, { prefix: 'x-' });
  return buildFlow({
    format: 'html', title: txt(d.querySelector('title')) || niceTitle(file.name),
    author: d.querySelector('meta[name="author" i]')?.getAttribute('content') || '',
    lang: d.documentElement.getAttribute('lang') || '',
  }, [{ frag }]);
}
async function loadMd(text, file) {
  // front matter YAML (Pandoc, Obsidian, Jekyll): ambil judul/penulis/bahasa, jangan ditampilkan
  const meta = {};
  text = text.replace(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, (m, body) => {
    // hanya bila isinya memang berbentuk YAML; garis --- biasa di awal dokumen dibiarkan
    if (!body.split(/\r?\n/).every(l => !l.trim() || /^([\w-]+\s*:|\s+\S|\s*-\s|#)/.test(l))) return m;
    for (const line of body.split(/\r?\n/)) {
      const kv = /^(title|author|lang|language)\s*:\s*(.+?)\s*$/i.exec(line);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    return '';
  });
  const html = mdToHtml(text);
  const d = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
  const frag = sanitize(d.body, { prefix: 'x-' });
  const h1 = frag.querySelector('h1');
  return buildFlow({ format: 'md', title: (meta.title || (h1 && txt(h1)) || '').slice(0, 140) || niceTitle(file.name), author: meta.author || '', lang: meta.lang || meta.language || '' }, [{ frag }]);
}
const CHAPTER = /^\s*(bab|chapter|bagian|part|buku|book|jilid|prolog|prologue|epilog|epilogue|kata pengantar|pengantar|pendahuluan|penutup|lampiran|daftar pustaka|appendix|introduction|preface)\b[^\n]{0,80}$/i;
function textToFrag(text) {
  text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/\f/g, '\n\n');
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  const filled = lines.filter(l => l.trim());
  const lens = filled.map(l => l.trim().length).sort((a, b) => a - b);
  const median = lens[lens.length >> 1] || 0;
  const blankSep = lines.length - filled.length > filled.length * 0.08;
  const join = blankSep && median > 45;
  const add = blockLines => {
    const t = blockLines.map(l => l.trim()).filter(Boolean);
    if (!t.length) return;
    if (t.length === 1 && t[0].length < 90 && CHAPTER.test(t[0])) { frag.append(el('h2', { text: t[0] })); return; }
    if (t.length === 1 && /^([*~=•·-]\s*){3,}$/.test(t[0])) { frag.append(el('hr')); return; }
    const p = el('p');
    if (join) p.textContent = t.join(' ').replace(/(\w)- (\w)/g, '$1-$2');
    else t.forEach((l, k) => { if (k) p.append(el('br')); p.append(l); });
    frag.append(p);
  };
  if (blankSep) {
    let cur = [];
    for (const l of lines) { if (l.trim()) cur.push(l); else { add(cur); cur = []; } }
    add(cur);
  } else for (const l of lines) add([l]);
  return frag;
}
function loadTxt(text, file) {
  return buildFlow({ format: 'txt', title: niceTitle(file.name), author: '' }, [{ frag: textToFrag(text) }]);
}
function codeToParts(text, ext) {
  if (ext === 'json' && text.length < 3e6) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* biarkan apa adanya */ } }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += 3000) {
    const f = document.createDocumentFragment();
    f.append(el('pre', { class: 'code-file', text: lines.slice(i, i + 3000).join('\n') }));
    parts.push({ frag: f, title: lines.length > 3000 ? `Baris ${i + 1}–${Math.min(lines.length, i + 3000)}` : '' });
  }
  return parts;
}
function csvToFrag(text, ext) {
  text = text.replace(/\r\n?/g, '\n');
  const sample = text.slice(0, 20000).split('\n').slice(0, 20);
  let delim = ext === 'tsv' ? '\t' : ',';
  if (ext !== 'tsv') {
    let best = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = sample.filter(Boolean).map(l => l.split(d).length - 1);
      const min = Math.min(...counts), score = min > 0 ? min * 10 - (Math.max(...counts) - min) : -1;
      if (score > best) { best = score; delim = d; }
    }
  }
  const rows = [];
  let row = [], cell = '', q = false;
  const LIMIT = 20000;
  for (let i = 0; i < text.length && rows.length < LIMIT; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(c => !c.trim())) rows.pop();
  const frag = document.createDocumentFragment();
  const t = el('table', { class: 'csv' });
  const head = rows[0] && rows[0].every(c => c.trim() && !/^-?[\d.,\s%Rp]+$/.test(c.trim())) && rows.length > 1;
  const cols = Math.max(0, ...rows.map(r => r.length));
  if (head) {
    const tr = el('tr', null, el('th', { text: '#' }));
    for (let k = 0; k < cols; k++) tr.append(el('th', { text: rows[0][k] ?? '' }));
    t.append(el('thead', null, tr));
  }
  const tb = el('tbody');
  rows.slice(head ? 1 : 0).forEach((r, i) => {
    const tr = el('tr', null, el('td', { text: String(i + 1) }));
    for (let k = 0; k < cols; k++) tr.append(el('td', { text: r[k] ?? '' }));
    tb.append(tr);
  });
  t.append(tb);
  frag.append(el('div', { class: 'tbl' }, t));
  if (rows.length >= LIMIT) frag.append(el('p', { class: 'img-miss', text: 'Hanya ' + NF.format(LIMIT) + ' baris pertama yang ditampilkan.' }));
  return frag;
}

/* ---------- Markdown ---------- */
function mdToHtml(src) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const refs = {}, notes = [], noteIds = new Map();
  for (let i = 0; i < lines.length; i++) {
    let m = /^ {0,3}\[\^([^\]]+)\]:\s?(.*)$/.exec(lines[i]);
    if (m) {
      const body = [m[2]];
      lines[i] = '\u0000';
      while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) { body.push(lines[++i].trim()); lines[i] = '\u0000'; }
      notes.push({ id: m[1], body: body.join(' ') });
      continue;
    }
    m = /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(](.*)["')])?\s*$/.exec(lines[i]);
    if (m) { refs[m[1].toLowerCase()] = m[2]; lines[i] = '\u0000'; }
  }
  const noteNum = id => { if (!noteIds.has(id)) noteIds.set(id, noteIds.size + 1); return noteIds.get(id); };
  const BLOCK = /^ {0,3}(`{3,}|~{3,}|#{1,6}(\s|$)|>|([-*_])( *\3){2,} *$|[-*+]\s+\S|\d{1,9}[.)]\s+\S|<(div|table|pre|h[1-6]|ul|ol|blockquote|figure|details|hr|section|center|dl|p)\b)/i;
  const stash = [];
  const keep = h => '\u0001' + (stash.push(h) - 1) + '\u0001';
  const url = u => { u = u.replace(/&amp;/g, '&'); return /^(https?:|mailto:|#|data:image\/)/i.test(u) || !/^[a-z][\w+.-]*:/i.test(u) ? esc(u) : '#'; };
  function inline(s) {
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, f, c) => keep('<code>' + esc(c.replace(/^ (.*) $/, '$1')) + '</code>'));
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (m, c) => keep(esc(c)));
    s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (m, u) => keep(`<a href="${esc(u)}">${esc(u)}</a>`));
    // tag HTML mentah dibiarkan (nanti disaring), teks lain di-escape
    s = s.split(/(<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*)?\/?>|<\!--[\s\S]*?-->)/).map((part, k) => k % 2 ? keep(part) : esc(part).replace(/&quot;/g, '"').replace(/&#39;/g, "'")).join('');
    s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, (m, alt, u) => keep(`<img src="${url(u)}" alt="${esc(alt)}">`));
    s = s.replace(/\[\^([^\]]+)\]/g, (m, id) => keep(`<sup><a class="footnote" href="#fn-${esc(id)}">${noteNum(id)}</a></sup>`));
    s = s.replace(/\[([^\]]+)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, (m, t, u) => `<a href="${url(u)}">${t}</a>`);
    s = s.replace(/\[([^\]]+)\]\s?\[([^\]]*)\]/g, (m, t, r) => { const u = refs[(r || t).toLowerCase()]; return u ? `<a href="${url(u)}">${t}</a>` : m; });
    s = s.replace(/\[([^\]]+)\](?![(\[])/g, (m, t) => { const u = refs[t.toLowerCase()]; return u ? `<a href="${url(u)}">${t}</a>` : m; });
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    s = s.replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (m, a, u) => `${a}<a href="${u}">${u}</a>`);
    s = s.replace(/( {2,}|\\)\n/g, '<br>');
    for (let k = 0; k < 3 && s.includes('\u0001'); k++) s = s.replace(/\u0001(\d+)\u0001/g, (m, n) => stash[+n]);
    return s;
  }
  const row = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());
  function list(ls, i) {
    const first = /^( *)([-*+]|\d{1,9}[.)])/.exec(ls[i]);
    const ordered = /\d/.test(first[2]), base = first[1].length;
    const items = [];
    let loose = false;
    while (i < ls.length) {
      const l = ls[i];
      const m = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/.exec(l);
      if (m && m[1].length <= base + 1 && /\d/.test(m[2]) === ordered) { items.push({ lines: [m[4]], ind: m[1].length + m[2].length + Math.min(m[3].length, 4) }); i++; continue; }
      if (!l.trim() || l === '\u0000') {
        const nx = ls[i + 1];
        if (nx != null && items.length && (/^ {2,}\S/.test(nx) || (/^( *)([-*+]|\d{1,9}[.)])\s/.test(nx) && (/^( *)(\d)/.test(nx)) === ordered))) { items[items.length - 1].lines.push(''); loose = true; i++; continue; }
        break;
      }
      if (items.length && (/^ {2,}/.test(l) || !BLOCK.test(l))) {
        const it = items[items.length - 1];
        it.lines.push(l.replace(new RegExp('^ {0,' + it.ind + '}'), ''));
        i++; continue;
      }
      break;
    }
    const start = ordered ? parseInt(first[2], 10) : 1;
    let h = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
    for (const it of items) {
      let body = it.lines;
      let task = '';
      const tm = /^\[( |x|X)\]\s+/.exec(body[0]);
      if (tm) { task = tm[1] === ' ' ? '☐ ' : '☑ '; body = [body[0].slice(tm[0].length), ...body.slice(1)]; }
      let inner = blocks(body);
      if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      h += `<li${task ? ' class="task"' : ''}>${task}${inner}</li>`;
    }
    return [h + (ordered ? '</ol>' : '</ul>'), i];
  }
  function blocks(ls) {
    let h = '', i = 0, m;
    while (i < ls.length) {
      const l = ls[i];
      if (l === '\u0000' || !l.trim()) { i++; continue; }
      if ((m = /^ {0,3}(`{3,}|~{3,})/.exec(l))) {
        const fence = m[1], body = [];
        i++;
        while (i < ls.length && !ls[i].trimStart().startsWith(fence)) body.push(ls[i++]);
        i++;
        h += '<pre><code>' + esc(body.join('\n')) + '</code></pre>';
        continue;
      }
      if ((m = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/.exec(l))) { const n = m[1].length; h += `<h${n}>${inline(m[2] || '')}</h${n}>`; i++; continue; }
      if (/^ {0,3}([-*_])( *\1){2,} *$/.test(l)) { h += '<hr>'; i++; continue; }
      if (/^ {0,3}>/.test(l)) {
        const q = [];
        while (i < ls.length && ls[i].trim() && (/^ {0,3}>/.test(ls[i]) || !BLOCK.test(ls[i]))) q.push(ls[i++].replace(/^ {0,3}> ?/, ''));
        h += '<blockquote>' + blocks(q) + '</blockquote>';
        continue;
      }
      if (/^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/.test(l)) { const [lh, ni] = list(ls, i); h += lh; i = ni; continue; }
      if (l.includes('|') && i + 1 < ls.length && /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(ls[i + 1]) && ls[i + 1].includes('-')) {
        const head = row(l), al = row(ls[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
        const cell = (tag, c, k) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</${tag}>`;
        h += '<table><thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>';
        i += 2;
        while (i < ls.length && ls[i].trim() && ls[i].includes('|')) { h += '<tr>' + row(ls[i]).map((c, k) => cell('td', c, k)).join('') + '</tr>'; i++; }
        h += '</tbody></table>';
        continue;
      }
      if (/^ {4,}\S/.test(l)) {
        const body = [];
        while (i < ls.length && (/^ {4,}/.test(ls[i]) || !ls[i].trim())) body.push(ls[i++].slice(4));
        while (body.length && !body[body.length - 1].trim()) body.pop();
        h += '<pre><code>' + esc(body.join('\n')) + '</code></pre>';
        continue;
      }
      if (/^ {0,3}<(\/?)(div|table|pre|h[1-6]|ul|ol|blockquote|figure|details|hr|section|center|dl|p|img|br|iframe|script|style)\b/i.test(l)) {
        const b = [];
        while (i < ls.length && ls[i].trim()) b.push(ls[i++]);
        h += b.join('\n');
        continue;
      }
      const p = [];
      let setext = 0;
      while (i < ls.length && ls[i].trim() && ls[i] !== '\u0000') {
        if (p.length && /^ {0,3}(=+|-+) *$/.test(ls[i])) { setext = ls[i].trim()[0] === '=' ? 1 : 2; i++; break; }
        if (p.length && BLOCK.test(ls[i])) break;
        p.push(ls[i++]);
      }
      if (p.length) h += setext ? `<h${setext}>${inline(p.join('\n'))}</h${setext}>` : `<p>${inline(p.join('\n'))}</p>`;
    }
    return h;
  }
  let html = blocks(lines);
  if (notes.length) {
    html += '<section class="notes"><ol>' + notes.sort((a, b) => noteNum(a.id) - noteNum(b.id)).map(n => `<li id="fn-${esc(n.id)}">${inline(n.body)}</li>`).join('') + '</ol></section>';
  }
  return html;
}

/* ---------- DOCX (Word) ---------- */
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const wa = (e, name) => e ? (e.getAttributeNS(W_NS, name) ?? e.getAttribute('w:' + name)) : null;
const wv = (e, name) => { const c = kid(e, name); return c ? wa(c, 'val') : null; };
const wOn = (e, name) => { const c = kid(e, name); if (!c) return null; const v = wa(c, 'val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); };
const rId = (e, name) => e ? (e.getAttributeNS(R_NS, name) || e.getAttribute('r:' + name)) : null;
async function readRels(zip, path) {
  const m = new Map();
  if (!zip.has(path)) return m;
  try {
    const d = parseXML(await zip.text(path));
    for (const r of desc(d, 'Relationship')) m.set(r.getAttribute('Id'), { target: r.getAttribute('Target') || '', ext: r.getAttribute('TargetMode') === 'External', type: r.getAttribute('Type') || '' });
  } catch (e) { /* tanpa relasi */ }
  return m;
}
const SAFE_IMG = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml|avif)$/;
async function attachImages(zip, list, urls) {
  await Promise.all(list.map(async ({ img, path }) => {
    try {
      const b = await zip.blob(path);
      if (!SAFE_IMG.test(b.type)) throw new Error('jenis gambar');
      const u = await blobUrl(b);
      if (!u) throw new Error('jenis gambar');
      urls.push(u); img.src = u;
    } catch (e) { img.replaceWith(el('span', { class: 'img-miss', text: '[gambar]' })); }
  }));
}
async function loadDocx(zip, file) {
  const top = await readRels(zip, '_rels/.rels');
  const mainRel = [...top.values()].find(r => /officeDocument$/.test(r.type));
  const main = mainRel ? resolvePath('', mainRel.target) : 'word/document.xml';
  const doc = parseXML(await zip.text(main));
  const rels = await readRels(zip, dirOf(main) + '_rels/' + baseName(main) + '.rels');
  const part = async type => { const r = [...rels.values()].find(x => x.type.endsWith('/' + type)); const p = r ? resolvePath(main, r.target) : ''; return p && zip.has(p) ? parseXML(await zip.text(p)) : null; };
  const styles = new Map();
  const sd = await part('styles');
  for (const s of desc(sd, 'style')) {
    const pPr = kid(s, 'pPr'), rPr = kid(s, 'rPr'), np = kid(pPr, 'numPr');
    const ol = wv(pPr, 'outlineLvl');
    styles.set(wa(s, 'styleId'), { name: (wv(s, 'name') || '').toLowerCase(), based: wv(s, 'basedOn'), outline: ol != null ? +ol : null, numId: wv(np, 'numId'), ilvl: wv(np, 'ilvl'), b: wOn(rPr, 'b'), i: wOn(rPr, 'i') });
  }
  const sprop = (id, f) => { for (let k = 0; id && k < 15; k++) { const s = styles.get(id); if (!s) return null; const v = f(s); if (v != null) return v; id = s.based; } return null; };
  const headingOf = id => sprop(id, s => { const m = /^heading (\d)$/.exec(s.name); if (m) return +m[1]; if (s.name === 'title') return 1; if (s.outline != null && s.outline < 9) return s.outline + 1; return null; });
  const nd = await part('numbering');
  const absFmt = new Map(), numAbs = new Map();
  for (const a of desc(nd, 'abstractNum')) absFmt.set(wa(a, 'abstractNumId'), kids(a, 'lvl').map(l => ({ fmt: wv(l, 'numFmt') || 'decimal', start: +(wv(l, 'start') || 1) })));
  for (const n of desc(nd, 'num')) numAbs.set(wa(n, 'numId'), wv(n, 'abstractNumId'));
  const notesXml = { fn: await part('footnotes'), en: await part('endnotes') };
  const noteEls = { fn: new Map(), en: new Map() };
  for (const k of ['fn', 'en']) for (const n of desc(notesXml[k], k === 'fn' ? 'footnote' : 'endnote')) noteEls[k].set(wa(n, 'id'), n);
  const usedNotes = [];
  const images = [], urls = [];
  let title = '', author = '';
  if (zip.has('docProps/core.xml')) { try { const c = parseXML(await zip.text('docProps/core.xml')); title = txt(desc1(c, 'title')); author = txt(desc1(c, 'creator')); } catch (e) { /* abaikan */ } }

  const counters = new Map();
  function numOf(p) {
    const pPr = kid(p, 'pPr'), np = kid(pPr, 'numPr');
    const sid = wv(pPr, 'pStyle');
    let numId = np ? wv(np, 'numId') : sprop(sid, s => s.numId);
    if (!numId || numId === '0') return null;
    const ilvl = +((np && wv(np, 'ilvl')) ?? sprop(sid, s => s.ilvl) ?? 0) || 0;
    const lv = (absFmt.get(numAbs.get(numId)) || [])[ilvl] || { fmt: 'decimal', start: 1 };
    return { numId, ilvl, fmt: lv.fmt, start: lv.start, ordered: !/bullet|none/.test(lv.fmt) };
  }
  function addToList(out, stack, np, content) {
    while (stack.length && stack[stack.length - 1].lvl > np.ilvl) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.lvl === np.ilvl && (top.ordered !== np.ordered || top.numId !== np.numId)) { stack.pop(); top = stack[stack.length - 1]; }
    const key = np.numId + ':' + np.ilvl;
    if (!top || top.lvl < np.ilvl) {
      const L = document.createElement(np.ordered ? 'ol' : 'ul');
      if (np.ordered) {
        const t = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' }[np.fmt];
        if (t) L.type = t;
        const startAt = counters.has(key) ? counters.get(key) + 1 : np.start;
        if (startAt !== 1) L.start = startAt;
      }
      if (top) (top.el.lastElementChild || top.el).append(L); else out.append(L);
      top = { lvl: np.ilvl, el: L, ordered: np.ordered, numId: np.numId };
      stack.push(top);
    }
    counters.set(key, (counters.get(key) ?? np.start - 1) + 1);
    for (const k of counters.keys()) if (k.startsWith(np.numId + ':') && +k.split(':')[1] > np.ilvl) counters.delete(k);
    top.el.append(el('li', null, content));
  }
  function blocks(parent, out) {
    const stack = [];
    for (const n of kids(parent)) {
      const ln = n.localName;
      if (ln === 'p') {
        const np = numOf(n);
        const node = para(n, !!np);
        if (!node) { if (!np) stack.length = 0; continue; }
        if (np && node.localName === 'span') addToList(out, stack, np, node);
        else { stack.length = 0; out.append(node); }
      } else if (ln === 'tbl') { stack.length = 0; out.append(table(n)); }
      else if (ln === 'sdt') blocks(kid(n, 'sdtContent'), out);
      else if (ln === 'customXml' || ln === 'ins' || ln === 'moveTo' || ln === 'smartTag') blocks(n, out);
      else if (ln === 'AlternateContent') blocks(kid(n, 'Choice') || kid(n, 'Fallback'), out);
    }
  }
  function para(p, inList) {
    const pPr = kid(p, 'pPr'), sid = wv(pPr, 'pStyle');
    let lvl = headingOf(sid);
    const ol = wv(pPr, 'outlineLvl');
    if (ol != null && +ol < 9) lvl = +ol + 1;
    const f = document.createDocumentFragment();
    inlines(p, f, { instr: false });
    if (!f.textContent.trim() && !f.querySelector('img')) return null;
    if (inList && !lvl) { const s = el('span'); s.append(f); return s; }
    const sname = (sid && styles.get(sid)?.name) || '';
    const tag = lvl ? 'h' + Math.min(lvl, 6) : /quote|block text/.test(sname) ? 'blockquote' : 'p';
    const e = el(tag, sname === 'subtitle' ? { class: 'subtitle' } : null);
    const jc = wv(pPr, 'jc');
    const al = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc];
    if (al) e.style.textAlign = al;
    e.append(f);
    return e;
  }
  function inlines(node, out, st) {
    for (const n of kids(node)) {
      switch (n.localName) {
        case 'r': run(n, out, st); break;
        case 'hyperlink': {
          const a = el('a');
          const id = rId(n, 'id'), anc = wa(n, 'anchor'), r = id && rels.get(id);
          if (r && r.ext && /^(https?:|mailto:)/i.test(r.target)) { a.href = r.target; a.dataset.ext = ''; a.rel = 'noopener noreferrer'; a.target = '_blank'; }
          else if (anc) { a.href = '#'; a.dataset.sec = ''; a.dataset.anc = 'd-' + anc; }
          inlines(n, a, st);
          out.append(a);
          break;
        }
        case 'ins': case 'smartTag': case 'customXml': case 'fldSimple': case 'moveTo': case 'dir': case 'bdo': inlines(n, out, st); break;
        case 'sdt': inlines(kid(n, 'sdtContent'), out, st); break;
        case 'AlternateContent': inlines(kid(n, 'Choice') || kid(n, 'Fallback'), out, st); break;
        case 'bookmarkStart': { const nm = wa(n, 'name'); if (nm && !/^_GoBack$/.test(nm)) out.append(el('span', { id: 'd-' + nm })); break; }
        case 'oMath': case 'oMathPara': out.append(el('i', { text: desc(n, 't').map(t => t.textContent).join('') })); break;
      }
    }
  }
  function run(r, out, st) {
    const rPr = kid(r, 'rPr');
    if (wOn(rPr, 'vanish')) return;
    const cs = wv(rPr, 'rStyle');
    const b = wOn(rPr, 'b') ?? sprop(cs, s => s.b), i = wOn(rPr, 'i') ?? sprop(cs, s => s.i);
    const u = (wv(rPr, 'u') || 'none') !== 'none', s = wOn(rPr, 'strike') || wOn(rPr, 'dstrike');
    const va = wv(rPr, 'vertAlign');
    let box = null;
    const target = () => {
      if (box) return box;
      let inner = null, outer = null;
      const wrap = tag => { const e = el(tag); if (inner) inner.append(e); else outer = e; inner = e; };
      if (b) wrap('strong'); if (i) wrap('em'); if (u) wrap('u'); if (s) wrap('s');
      if (va === 'superscript') wrap('sup'); else if (va === 'subscript') wrap('sub');
      if (wOn(rPr, 'smallCaps')) { wrap('span'); inner.style.fontVariant = 'small-caps'; }
      if (wOn(rPr, 'caps')) { wrap('span'); inner.style.textTransform = 'uppercase'; }
      if (outer) out.append(outer);
      box = inner || out;
      return box;
    };
    const put = t => target().append(t);
    for (const c of kids(r)) {
      switch (c.localName) {
        case 'fldChar': { const t = wa(c, 'fldCharType'); st.instr = t === 'begin'; break; }
        case 't': if (!st.instr) put(c.textContent); break;
        case 'tab': if (!st.instr) put('\u2003'); break;
        case 'br': case 'cr': if (wa(c, 'type') !== 'page' && wa(c, 'type') !== 'column') target().append(el('br')); break;
        case 'noBreakHyphen': put('\u2011'); break;
        case 'softHyphen': put('\u00AD'); break;
        case 'sym': { const f = (wa(c, 'font') || '').toLowerCase(); const ch = parseInt(wa(c, 'char') || '', 16); if (ch && !/symbol|wingding|webding/.test(f)) put(String.fromCharCode(ch >= 0xF000 ? ch - 0xF000 : ch)); break; }
        case 'drawing': case 'pict': case 'object': image(c, out); break;
        case 'AlternateContent': image(kid(c, 'Choice') || kid(c, 'Fallback'), out); break;
        case 'footnoteReference': case 'endnoteReference': {
          const k = c.localName[0] === 'f' ? 'fn' : 'en', id = wa(c, 'id');
          if (!noteEls[k].has(id)) break;
          let num = usedNotes.findIndex(x => x.k === k && x.id === id) + 1;
          if (!num) { usedNotes.push({ k, id }); num = usedNotes.length; }
          out.append(el('sup', null, el('a', { href: '#', 'data-sec': '', 'data-anc': `d-${k}-${id}`, 'data-note': '', text: String(num) })));
          break;
        }
      }
    }
  }
  function image(node, out) {
    if (!node) return;
    const blips = desc(node, 'blip').map(b => rId(b, 'embed')).concat(desc(node, 'imagedata').map(b => rId(b, 'id'))).filter(Boolean);
    if (blips.length) {
      const ext = desc1(node, 'extent');
      const w = ext ? Math.round(+ext.getAttribute('cx') / 9525) : 0;
      const alt = desc1(node, 'docPr')?.getAttribute('descr') || '';
      for (const id of [...new Set(blips)]) {
        const r = rels.get(id);
        if (!r || r.ext) continue;
        const img = el('img', { alt });
        if (w > 0 && w < 5000) img.setAttribute('width', w);
        images.push({ img, path: resolvePath(main, r.target) });
        out.append(img);
      }
      return;
    }
    for (const tb of desc(node, 'txbxContent')) for (const p of kids(tb, 'p')) {
      const s = el('span'); inlines(p, s, { instr: false });
      if (s.textContent.trim()) out.append(s, el('br'));
    }
  }
  function table(tbl) {
    const t = el('table'), tb = el('tbody');
    t.append(tb);
    const cellsOf = tr => kids(tr).flatMap(c => c.localName === 'tc' ? [c] : /sdt|customXml/.test(c.localName) ? kids(kid(c, 'sdtContent') || c, 'tc') : []);
    const grid = kids(tbl, 'tr').map(tr => {
      let col = +(wv(kid(tr, 'trPr'), 'gridBefore') || 0);
      return { head: !!kid(kid(tr, 'trPr'), 'tblHeader'), cells: cellsOf(tr).map(tc => {
        const pr = kid(tc, 'tcPr'), span = Math.max(1, +(wv(pr, 'gridSpan') || 1));
        const vm = kid(pr, 'vMerge');
        const c = { tc, col, span, vm: vm ? (wa(vm, 'val') || 'continue') : null };
        col += span;
        return c;
      }) };
    });
    grid.forEach((row, ri) => {
      const tr = el('tr');
      for (const c of row.cells) {
        if (c.vm === 'continue') continue;
        const td = el(row.head ? 'th' : 'td');
        if (c.span > 1) td.colSpan = c.span;
        if (c.vm === 'restart') {
          let rs = 1;
          for (let k = ri + 1; k < grid.length; k++) { const b = grid[k].cells.find(x => x.col === c.col); if (b && b.vm === 'continue') rs++; else break; }
          if (rs > 1) td.rowSpan = rs;
        }
        blocks(c.tc, td);
        if (td.childElementCount === 1 && td.firstElementChild.localName === 'p') td.replaceChildren(...td.firstElementChild.childNodes);
        tr.append(td);
      }
      tb.append(tr);
    });
    return el('div', { class: 'tbl' }, t);
  }
  const frag = document.createDocumentFragment();
  blocks(desc1(doc, 'body'), frag);
  if (usedNotes.length) {
    const ol = el('ol');
    for (let k = 0; k < usedNotes.length; k++) {
      const { k: kind, id } = usedNotes[k];
      const li = el('li', { id: `d-${kind}-${id}` });
      blocks(noteEls[kind].get(id), li);
      ol.append(li);
    }
    frag.append(el('section', { class: 'notes' }, el('h2', { text: 'Catatan' }), ol));
  }
  await attachImages(zip, images, urls);
  const first = frag.querySelector('h1');
  return buildFlow({
    format: 'docx', title: title || (first && txt(first).slice(0, 140)) || niceTitle(file.name), author,
    close: () => urls.forEach(revokeUrl),
  }, [{ frag }]);
}

/* ---------- ODT (LibreOffice / OpenDocument) ---------- */
const ODF = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
};
async function loadOdt(zip, file) {
  const content = parseXML(await zip.text('content.xml'));
  const otherStyles = zip.has('styles.xml') ? parseXML(await zip.text('styles.xml')) : null;
  const st = new Map(), listSt = new Map();
  for (const d of [otherStyles, content]) {
    if (!d) continue;
    for (const s of d.getElementsByTagNameNS(ODF.style, 'style')) {
      const tp = s.getElementsByTagNameNS(ODF.style, 'text-properties')[0], pp = s.getElementsByTagNameNS(ODF.style, 'paragraph-properties')[0];
      const g = (e, ns, n) => e ? e.getAttributeNS(ns, n) : null;
      const fw = g(tp, ODF.fo, 'font-weight');
      const auto = s.parentNode?.localName === 'automatic-styles';
      st.set(s.getAttributeNS(ODF.style, 'name'), {
        parent: s.getAttributeNS(ODF.style, 'parent-style-name'), display: auto ? null : (s.getAttributeNS(ODF.style, 'display-name') || s.getAttributeNS(ODF.style, 'name') || '').toLowerCase(),
        b: fw ? (fw === 'bold' || +fw >= 600) : null, i: g(tp, ODF.fo, 'font-style') ? g(tp, ODF.fo, 'font-style') === 'italic' : null,
        u: g(tp, ODF.style, 'text-underline-style') ? g(tp, ODF.style, 'text-underline-style') !== 'none' : null,
        s: g(tp, ODF.style, 'text-line-through-style') ? g(tp, ODF.style, 'text-line-through-style') !== 'none' : null,
        pos: g(tp, ODF.style, 'text-position'), align: g(pp, ODF.fo, 'text-align'),
      });
    }
    for (const ls of d.getElementsByTagNameNS(ODF.text, 'list-style')) {
      const lv = {};
      for (const c of ls.children) lv[+c.getAttributeNS(ODF.text, 'level') || 1] = c.localName === 'list-level-style-number';
      listSt.set(ls.getAttributeNS(ODF.style, 'name'), lv);
    }
  }
  const sp = (name, f) => { for (let k = 0; name && k < 15; k++) { const s = st.get(name); if (!s) return null; const v = f(s); if (v != null) return v; name = s.parent; } return null; };
  const ta = (e, n) => e.getAttributeNS(ODF.text, n);
  const images = [], urls = [], notes = [];
  let title = '', author = '';
  if (zip.has('meta.xml')) { try { const m = parseXML(await zip.text('meta.xml')); title = txt(desc1(m, 'title')); author = txt(desc1(m, 'creator')) || txt(desc1(m, 'initial-creator')); } catch (e) { /* abaikan */ } }
  function inline(node, out) { for (let n = node.firstChild; n; n = n.nextSibling) inlineOne(n, out); }
  function inlineOne(n, out) {
    {
      if (n.nodeType === 3) { out.append(n.data); return; }
      if (n.nodeType !== 1) return;
      switch (n.localName) {
        case 'span': {
          const name = ta(n, 'style-name');
          let box = out;
          const wrap = tag => { const e = el(tag); box.append(e); box = e; };
          if (sp(name, s => s.b)) wrap('strong');
          if (sp(name, s => s.i)) wrap('em');
          if (sp(name, s => s.u)) wrap('u');
          if (sp(name, s => s.s)) wrap('s');
          const pos = sp(name, s => s.pos);
          if (pos && /^(super|\d)/.test(pos)) wrap('sup'); else if (pos && /^(sub|-)/.test(pos)) wrap('sub');
          inline(n, box);
          break;
        }
        case 'a': {
          const href = n.getAttributeNS(NS.xlink, 'href') || '';
          const a = el('a');
          if (/^(https?:|mailto:)/i.test(href)) { a.href = href; a.dataset.ext = ''; a.rel = 'noopener noreferrer'; a.target = '_blank'; }
          else if (href.startsWith('#')) { a.href = '#'; a.dataset.sec = ''; a.dataset.anc = 'o-' + href.slice(1); }
          inline(n, a); out.append(a);
          break;
        }
        case 's': out.append(' '.repeat(Math.min(50, +ta(n, 'c') || 1))); break;
        case 'tab': out.append('\u2003'); break;
        case 'line-break': out.append(el('br')); break;
        case 'bookmark': case 'bookmark-start': { const nm = ta(n, 'name'); if (nm) out.append(el('span', { id: 'o-' + nm })); break; }
        case 'note': {
          const body = desc1(n, 'note-body');
          notes.push(body);
          const num = notes.length;
          out.append(el('sup', null, el('a', { href: '#', 'data-sec': '', 'data-anc': 'o-note-' + num, 'data-note': '', text: String(num) })));
          break;
        }
        case 'frame': {
          const im = desc(n, 'image').find(x => x.namespaceURI === ODF.draw);
          const href = im?.getAttributeNS(NS.xlink, 'href');
          if (href && !/^[a-z]+:/i.test(href)) {
            const img = el('img', { alt: txt(desc1(n, 'title')) || '' });
            const m = /^([\d.]+)(cm|mm|in|pt|pc|px)?$/.exec(n.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'width') || '');
            const w = m ? Math.round(+m[1] * { cm: 37.8, mm: 3.78, in: 96, pt: 4 / 3, pc: 16, px: 1 }[m[2] || 'px']) : 0;
            if (w > 0 && w < 5000) img.setAttribute('width', w);
            images.push({ img, path: resolvePath('', href) });
            out.append(img);
          } else {
            const tb = desc1(n, 'text-box');
            if (tb) for (const p of tb.children) { const s = el('span'); inline(p, s); if (s.textContent.trim()) out.append(s, el('br')); }
          }
          break;
        }
        case 'annotation': case 'soft-page-break': case 'change-start': case 'change-end': case 'change': case 'bookmark-end': break;
        default: inline(n, out);
      }
    }
  }
  function blocks(node, out, depth = 0) {
    for (const n of kids(node)) {
      switch (n.localName) {
        case 'h': case 'p': {
          const f = document.createDocumentFragment();
          inline(n, f);
          if (!f.textContent.trim() && !f.querySelector('img')) break;
          const name = ta(n, 'style-name');
          const lvl = n.localName === 'h' ? clamp(+ta(n, 'outline-level') || 1, 1, 6) : 0;
          // gaya bawaan LibreOffice (mis. "Title") kadang dipakai tanpa didefinisikan di berkas
          const disp = sp(name, s => s.display) || (name && !st.has(name) ? name.replace(/_20_/g, ' ').toLowerCase() : '');
          const e = el(lvl ? 'h' + lvl : disp === 'title' ? 'h1' : disp === 'subtitle' ? 'p' : /quotation/.test(disp) ? 'blockquote' : 'p', disp === 'subtitle' ? { class: 'subtitle' } : null);
          const al = sp(name, s => s.align);
          if (/^(center|end|right|justify)$/.test(al)) e.style.textAlign = al === 'end' ? 'right' : al;
          e.append(f);
          out.append(e);
          break;
        }
        case 'list': {
          const sname = ta(n, 'style-name');
          const ordered = sname && listSt.get(sname) ? !!listSt.get(sname)[depth + 1] : false;
          const L = el(ordered ? 'ol' : 'ul');
          for (const it of kids(n)) if (it.localName === 'list-item' || it.localName === 'list-header') {
            const li = el('li');
            blocks(it, li, depth + 1);
            if (li.childElementCount === 1 && li.firstElementChild.localName === 'p') li.replaceChildren(...li.firstElementChild.childNodes);
            L.append(li);
          }
          out.append(L);
          break;
        }
        case 'table': {
          const t = el('table'), tb = el('tbody');
          const rows = [];
          for (const c of kids(n)) {
            if (c.localName === 'table-row') rows.push(c);
            else if (/^table-(header-rows|rows|row-group)$/.test(c.localName)) rows.push(...kids(c, 'table-row'));
          }
          for (const r of rows) {
            const tr = el('tr');
            for (const c of kids(r)) {
              if (c.localName !== 'table-cell') continue;
              const td = el(r.parentElement.localName === 'table-header-rows' ? 'th' : 'td');
              const cs = +c.getAttributeNS(ODF.table, 'number-columns-spanned') || 1, rs = +c.getAttributeNS(ODF.table, 'number-rows-spanned') || 1;
              if (cs > 1) td.colSpan = cs; if (rs > 1) td.rowSpan = rs;
              blocks(c, td, depth);
              if (td.childElementCount === 1 && td.firstElementChild.localName === 'p') td.replaceChildren(...td.firstElementChild.childNodes);
              tr.append(td);
            }
            tb.append(tr);
          }
          t.append(tb);
          out.append(el('div', { class: 'tbl' }, t));
          break;
        }
        case 'section': case 'index-body': case 'table-of-content': case 'illustration-index': case 'alphabetical-index': case 'user-index': case 'bibliography': blocks(n, out, depth); break;
        case 'frame': { const f = el('p'); inlineOne(n, f); if (f.childNodes.length) out.append(f); break; }
      }
    }
  }
  const body = content.getElementsByTagNameNS(ODF.office, 'text')[0];
  if (!body) throw new FormatError('Dokumen ODT ini bukan dokumen teks (mungkin lembar kerja atau presentasi).');
  const frag = document.createDocumentFragment();
  blocks(body, frag);
  if (notes.length) {
    const ol = el('ol');
    notes.forEach((b, k) => { const li = el('li', { id: 'o-note-' + (k + 1) }); if (b) blocks(b, li); ol.append(li); });
    frag.append(el('section', { class: 'notes' }, el('h2', { text: 'Catatan' }), ol));
  }
  await attachImages(zip, images, urls);
  const first = frag.querySelector('h1');
  return buildFlow({ format: 'odt', title: title || (first && txt(first).slice(0, 140)) || niceTitle(file.name), author, close: () => urls.forEach(revokeUrl) }, [{ frag }]);
}

/* ---------- FB2 (FictionBook) ---------- */
async function loadFb2(bytes, file) {
  const text = decodeText(bytes, xmlEncoding(bytes));
  let d;
  try { d = parseXML(text); } catch (e) { d = new DOMParser().parseFromString(text, 'text/html'); }
  const L = e => (e.localName || '').toLowerCase();
  const find = (e, n) => e ? Array.from(e.children).find(c => L(c) === n) || null : null;
  const findAll = (e, n) => e ? Array.from(e.children).filter(c => L(c) === n) : [];
  const all = n => Array.from(d.getElementsByTagName('*')).filter(e => L(e) === n);
  const ti = all('title-info')[0];
  const href = e => { for (const a of Array.from(e.attributes)) if (/(^|:)href$/i.test(a.name)) return a.value; return ''; };
  const bins = new Map(all('binary').map(b => [b.getAttribute('id'), b]));
  const urls = new Map();
  const imgUrl = h => {
    const id = h.replace(/^#/, '');
    if (urls.has(id)) return urls.get(id);
    const b = bins.get(id);
    let u = null;
    if (b) {
      try {
        const bin = atob(b.textContent.replace(/\s+/g, ''));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const type = sniffImage(arr);
        if (type) u = mediaUrl(arr, type);
      } catch (e) { u = null; }
    }
    urls.set(id, u);
    return u;
  };
  const INL = { strong: 'strong', emphasis: 'em', strikethrough: 's', sub: 'sub', sup: 'sup', code: 'code', style: 'span' };
  function inline(n, out) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out.append(c.data); continue; }
      if (c.nodeType !== 1) continue;
      const t = L(c);
      if (INL[t]) { const e = el(INL[t]); inline(c, e); out.append(e); }
      else if (t === 'a') {
        const h = href(c), a = el('a');
        if (h.startsWith('#')) { a.href = '#'; a.dataset.sec = ''; a.dataset.anc = 'f-' + h.slice(1); if ((c.getAttribute('type') || '') === 'note' || /^\[?\d{1,3}\]?$|^\*+$/.test(c.textContent.trim())) a.dataset.note = ''; }
        else if (/^(https?:|mailto:)/i.test(h)) { a.href = h; a.dataset.ext = ''; a.rel = 'noopener noreferrer'; a.target = '_blank'; }
        inline(c, a); out.append(a);
      } else if (t === 'image') { const u = imgUrl(href(c)); if (u) out.append(el('img', { src: u, alt: c.getAttribute('alt') || '' })); }
      else inline(c, out);
    }
  }
  function block(n, out, depth) {
    for (const c of Array.from(n.children)) {
      const t = L(c);
      const id = c.getAttribute('id');
      let e = null;
      switch (t) {
        case 'section': e = el('section'); block(c, e, depth + 1); break;
        case 'title': {
          e = el('h' + clamp(depth + 1, 1, 6));
          findAll(c, 'p').forEach((p, k) => { if (k) e.append(el('br')); inline(p, e); });
          if (!e.textContent.trim()) e = null;
          break;
        }
        case 'p': e = el('p'); inline(c, e); break;
        case 'subtitle': e = el('p', { class: 'subtitle' }); inline(c, e); break;
        case 'empty-line': e = el('p', null, el('br')); break;
        case 'epigraph': e = el('blockquote', { class: 'epigraph' }); block(c, e, depth); break;
        case 'cite': e = el('blockquote'); block(c, e, depth); break;
        case 'annotation': e = el('div'); block(c, e, depth); break;
        case 'text-author': e = el('p', { class: 'byline' }); inline(c, e); break;
        case 'poem': e = el('div', { class: 'poem' }); block(c, e, depth); break;
        case 'stanza': e = el('div', { class: 'stanza' }); block(c, e, depth); break;
        case 'v': e = el('p', { class: 'verse' }); inline(c, e); break;
        case 'image': { const u = imgUrl(href(c)); if (u) e = el('p', { style: 'text-align:center' }, el('img', { src: u, alt: c.getAttribute('alt') || '' })); break; }
        case 'table': {
          const tb = el('tbody');
          for (const r of findAll(c, 'tr')) { const tr = el('tr'); for (const cell of Array.from(r.children)) { const td = el(L(cell) === 'th' ? 'th' : 'td'); inline(cell, td); const cs = +cell.getAttribute('colspan'); if (cs > 1) td.colSpan = cs; tr.append(td); } tb.append(tr); }
          e = el('div', { class: 'tbl' }, el('table', null, tb));
          break;
        }
      }
      if (e) { if (id) e.id = 'f-' + id; out.append(e); }
    }
  }
  const bodies = all('body');
  if (!bodies.length) throw new FormatError('Berkas FB2 ini tidak berisi teks.');
  const main = bodies.find(b => !b.getAttribute('name')) || bodies[0];
  const parts = [];
  const front = document.createDocumentFragment();
  for (const c of Array.from(main.children)) {
    if (L(c) === 'section') {
      const f = document.createDocumentFragment();
      const s = el('section'); if (c.getAttribute('id')) s.id = 'f-' + c.getAttribute('id');
      block(c, s, 1);
      f.append(s);
      parts.push({ frag: f, title: txt(find(c, 'title')) });
    } else { const tmp = el('div'); tmp.append(c.cloneNode(true)); block(tmp, front, 0); }
  }
  // halaman judul yang pendek digabung ke bagian pertama supaya tidak tampil sebagai halaman nyaris kosong
  if (front.childNodes.length) {
    if (parts.length && front.textContent.trim().length < 400 && !front.querySelector('img')) parts[0].frag.prepend(front);
    else parts.unshift({ frag: front });
  }
  for (const b of bodies) {
    if (b === main) continue;
    const f = document.createDocumentFragment();
    block(b, f, 1);
    parts.push({ frag: f, title: b.getAttribute('name') === 'notes' ? 'Catatan' : txt(find(b, 'title')) || 'Lampiran' });
  }
  const authors = findAll(ti, 'author').map(a => ['first-name', 'middle-name', 'last-name'].map(k => txt(find(a, k))).filter(Boolean).join(' ') || txt(find(a, 'nickname'))).filter(Boolean);
  const coverImg = find(find(ti, 'coverpage'), 'image');
  return buildFlow({
    format: 'fb2', title: txt(find(ti, 'book-title')) || niceTitle(file.name), author: authors.join(', '), lang: txt(find(ti, 'lang')),
    cover: async () => { const id = coverImg && href(coverImg).replace(/^#/, ''); const u = id && imgUrl(id); if (!u) return null; return thumbnail(await loadImg(u)); },
    close: () => urls.forEach(revokeUrl),
  }, parts);
}
async function loadImg(url) {
  const img = new Image(); img.src = url; await img.decode();
  return img;
}

/* ---------- MOBI / PRC (Mobipocket tanpa DRM) ---------- */
function palmdoc(src) {
  const out = new Uint8Array(src.length * 8 + 16);
  let o = 0;
  for (let i = 0; i < src.length;) {
    let c = src[i++];
    if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++]; }
    else if (c < 0x80) out[o++] = c;
    else if (c >= 0xC0) { out[o++] = 32; out[o++] = c ^ 0x80; }
    else {
      if (i >= src.length) break;
      c = (c << 8) | src[i++];
      const dist = (c >> 3) & 0x7FF, len = (c & 7) + 3;
      if (!dist || dist > o) continue;
      for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
    }
  }
  return out.subarray(0, o);
}
function stripTrailing(r, flags) {
  if (!flags) return r;
  let end = r.length;
  for (let bit = 15; bit >= 1; bit--) {
    if (!(flags & (1 << bit))) continue;
    let v = 0;
    for (const b of r.subarray(Math.max(0, end - 4), end)) { if (b & 0x80) v = 0; v = (v << 7) | (b & 0x7f); }
    end -= v;
  }
  if (flags & 1) end -= (r[end - 1] & 3) + 1;
  return r.subarray(0, Math.max(0, end));
}
async function loadMobi(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const nrec = dv.getUint16(76);
  const off = i => dv.getUint32(78 + i * 8);
  const rec = i => buf.subarray(off(i), i + 1 < nrec ? off(i + 1) : buf.length);
  const r0 = rec(0), d0 = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const comp = d0.getUint16(0), textRecs = d0.getUint16(8), crypt = d0.getUint16(12);
  if (crypt) throw new FormatError('Buku ini dilindungi DRM sehingga tidak bisa dibuka di aplikasi lain.');
  if (comp === 17480) throw new FormatError('MOBI berkompresi HUFF/CDIC belum didukung. Konversi ke EPUB (mis. dengan Calibre) lalu buka lagi.');
  let enc = 'windows-1252', firstImg = 0, title = '', author = [], lang = '', coverOff = -1, flags = 0;
  const isMobi = latin1(r0.subarray(16, 20)) === 'MOBI';
  if (isMobi) {
    const hl = d0.getUint32(20);
    if (d0.getUint32(28) === 65001) enc = 'utf-8';
    const ver = d0.getUint32(36);
    const no = d0.getUint32(84), nl = d0.getUint32(88);
    firstImg = d0.getUint32(108);
    if (hl >= 0xE4 && r0.length >= 0xF4) flags = d0.getUint16(0xF2);
    if (d0.getUint32(0x80) & 0x40) {
      let p = 16 + hl;
      if (latin1(r0.subarray(p, p + 4)) === 'EXTH') {
        const cnt = d0.getUint32(p + 8);
        p += 12;
        for (let k = 0; k < cnt && p + 8 <= r0.length; k++) {
          const type = d0.getUint32(p), len = d0.getUint32(p + 4);
          const data = r0.subarray(p + 8, p + len);
          const str = () => td(enc).decode(data).trim();
          if (type === 100) author.push(str());
          else if (type === 503) title = str();
          else if (type === 524) lang = str();
          else if (type === 201 && data.length >= 4) coverOff = new DataView(data.buffer, data.byteOffset, 4).getUint32(0);
          if (len < 8) break;
          p += len;
        }
      }
    }
    if (!title && nl && no + nl <= r0.length) title = td(enc).decode(r0.subarray(no, no + nl)).trim();
    if (ver >= 8 && !firstImg) throw new FormatError('Format KF8/AZW3 belum didukung. Konversi ke EPUB lalu buka lagi.');
  }
  if (!title) title = latin1(buf.subarray(0, 32)).replace(/\0.*$/, '').replace(/_/g, ' ').trim();
  const parts = [];
  let total = 0;
  for (let i = 1; i <= textRecs && i < nrec; i++) {
    const r = stripTrailing(rec(i), flags);
    const o = comp === 2 ? palmdoc(r) : r;
    parts.push(o); total += o.length;
  }
  const bytes = new Uint8Array(total);
  { let p = 0; for (const x of parts) { bytes.set(x, p); p += x.length; } }
  if (!isMobi) return buildFlow({ format: 'mobi', title: title || niceTitle(file.name), author: '' }, [{ frag: textToFrag(td(enc).decode(bytes)) }]);
  // jangkar filepos: posisi byte yang dirujuk tautan & daftar isi
  let raw = latin1(bytes);
  const targets = new Set();
  raw.replace(/filepos\s*=\s*["']?0*(\d+)/gi, (m, n) => { targets.add(+n); return m; });
  if (targets.size) {
    const pieces = [];
    let last = 0;
    for (const pos of [...targets].sort((a, b) => a - b)) {
      if (pos >= raw.length || pos < last) continue;
      let p = pos;
      const lt = raw.lastIndexOf('<', p), gt = raw.lastIndexOf('>', p - 1);
      if (lt > gt && lt >= last) p = lt;
      pieces.push(raw.slice(last, p), `<a id="filepos${pos}"></a>`);
      last = p;
    }
    pieces.push(raw.slice(last));
    raw = pieces.join('');
  }
  raw = raw.replace(/filepos\s*=\s*["']?0*(\d+)["']?/gi, 'href="#filepos$1"');
  const html = td(enc).decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
  const urls = new Map();
  const recUrl = n => {
    const idx = firstImg + n - 1;
    if (urls.has(idx)) return urls.get(idx);
    let u = null;
    if (firstImg && idx < nrec) { const b = rec(idx); const type = sniffImage(b); if (type) u = mediaUrl(b, type); }
    urls.set(idx, u);
    return u;
  };
  const chunks = html.split(/<mbp:pagebreak\s*\/?>|<\/mbp:pagebreak>/i);
  const out = [];
  let carry = null;
  chunks.forEach((c, k) => {
    const d = new DOMParser().parseFromString(k === 0 ? c : '<body>' + c, 'text/html');
    const frag = sanitize(d.body, {
      prefix: 'm-',
      img: src => { const m = /^rec:0*(\d+)$/.exec(src); return m ? recUrl(+m[1]) : null; },
      link: href => { if (/^#/.test(href)) return { sec: '', anc: 'm-' + href.slice(1) }; if (/^(https?:|mailto:)/i.test(href)) return { ext: href }; return null; },
    });
    if (carry) { carry.append(frag); } else carry = frag;
    if (carry.textContent.trim().length > 300 || carry.querySelector('img') || k === chunks.length - 1) { out.push({ frag: carry }); carry = null; }
  });
  if (carry) out.push({ frag: carry });
  // daftar isi dari halaman TOC (rujukan guide type="toc")
  let toc = null;
  const g = /<reference[^>]*type\s*=\s*["']?toc["']?[^>]*>/i.exec(chunks[0] || '');
  const tocAnc = g && /href="#(filepos\d+)"/.exec(g[0])?.[1];
  if (tocAnc) {
    const si = out.findIndex(p => p.frag.querySelector('[id="m-' + tocAnc + '"]'));
    if (si >= 0) {
      const links = Array.from(out[si].frag.querySelectorAll('a[data-anc]')).filter(a => txt(a) && a.dataset.anc !== 'm-' + tocAnc);
      if (links.length > 1) toc = links.map(a => ({ title: txt(a).slice(0, 160), lvl: 0, sec: null, anc: a.dataset.anc }));
    }
  }
  return buildFlow({
    format: 'mobi', title: title || niceTitle(file.name), author: author.join(', '), lang, toc,
    cover: async () => { const u = coverOff >= 0 ? recUrl(coverOff + 1) : null; return u ? thumbnail(await loadImg(u)) : null; },
    close: () => urls.forEach(revokeUrl),
  }, out);
}

/* ---------- RTF ---------- */
const RTF_SKIP = new Set('fonttbl colortbl stylesheet info header footer headerl headerr headerf footerl footerr footerf listtable listoverridetable rsidtbl generator xmlnstbl themedata colorschememapping datastore latentstyles pgdsctbl revtbl fldinst private filetbl mmathPr footnote annotation atnid atnauthor nonshppict objdata bkmkstart bkmkend userprops docvar template xe tc txe ftnsep ftnsepc aftnsep aftnsepc pnseclvl pntxta pntxtb'.split(' '));
const RTF_CHAR = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', tab: '\u2003', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005', zwj: '\u200D', zwnj: '\u200C' };
function rtfToFrag(bytes) {
  const s = latin1(bytes);
  const frag = document.createDocumentFragment();
  let cp = 'windows-1252';
  let st = { b: 0, i: 0, u: 0, x: 0, sup: 0, sub: 0, skip: 0, uc: 1, dest: '', al: '', lv: 0, tb: false };
  const stack = [];
  let para = null, row = null, cell = null, table = null;
  let bbuf = [], ucSkip = 0, star = false, first = false, pict = null;
  const WORD = /\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;
  // tingkat judul dari stylesheet: {\s1 …\outlinelevel0 … Heading 1;}
  const styleLevel = new Map();
  for (const m of s.slice(0, 200000).matchAll(/\{(?:\\\*)?\\s(\d+)\b[^{};]*?\\outlinelevel(\d)/g)) styleLevel.set(+m[1], +m[2] + 1);
  const flushTable = () => { if (table) { frag.append(el('div', { class: 'tbl' }, table)); table = null; } };
  const p = () => para || (para = el('p'));
  const emit = t => {
    if (!t) return;
    let n = document.createTextNode(t);
    if (st.sub) n = el('sub', null, n); else if (st.sup) n = el('sup', null, n);
    if (st.x) n = el('s', null, n);
    if (st.u) n = el('u', null, n);
    if (st.i) n = el('em', null, n);
    if (st.b) n = el('strong', null, n);
    p().append(n);
  };
  const flush = () => { if (bbuf.length) { emit(td(cp).decode(new Uint8Array(bbuf))); bbuf = []; } };
  const endPara = () => {
    flush();
    const has = para && (para.textContent.trim() || para.querySelector('img'));
    if (st.tb) { if (para) { cell = cell || el('td'); if (has) cell.append(para); } }
    else {
      flushTable();
      if (has) {
        if (st.lv && st.lv <= 6 && para.textContent.length < 300) { const h = el('h' + st.lv); h.append(...para.childNodes); para = h; }
        if (st.al) para.style.textAlign = st.al;
        frag.append(para);
      }
    }
    para = null;
  };
  const fmt = (k, v) => { flush(); st[k] = v; };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '{') { flush(); stack.push(st); st = { ...st }; first = true; i++; continue; }
    if (c === '}') {
      flush();
      if (st.dest === 'pict' && pict && pict.type && !stack[stack.length - 1]?.skip) {
        const hex = pict.hex.join('').replace(/[^0-9a-f]/gi, '');
        const arr = new Uint8Array(hex.length >> 1);
        for (let k = 0; k < arr.length; k++) arr[k] = parseInt(hex.substr(k * 2, 2), 16);
        const img = el('img', { src: mediaUrl(arr, pict.type), alt: '' });
        if (pict.w) img.setAttribute('width', Math.round(pict.w / 15));
        p().append(img);
        pict = null;
      }
      st = stack.pop() || st; first = false; i++; continue;
    }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '\\' || n === '{' || n === '}') { if (!st.skip) bbuf.push(n.charCodeAt(0)); i += 2; first = false; continue; }
      if (n === "'") { if (ucSkip > 0) ucSkip--; else if (!st.skip && st.dest !== 'pict') bbuf.push(parseInt(s.substr(i + 2, 2), 16) || 32); i += 4; continue; }
      if (n === '*') { star = true; i += 2; continue; }
      if (n === '~') { flush(); if (!st.skip) emit('\u00A0'); i += 2; continue; }
      if (n === '_') { flush(); if (!st.skip) emit('\u2011'); i += 2; continue; }
      if (n === '-') { i += 2; continue; }
      if (n === '\n' || n === '\r') { if (!st.skip) endPara(); i += 2; continue; }
      WORD.lastIndex = i;
      const m = WORD.exec(s);
      if (!m) { i++; continue; }
      i = WORD.lastIndex;
      const w = m[1], v = m[2] != null ? +m[2] : null;
      const wasFirst = first; first = false;
      if (star) { star = false; if (w !== 'shppict') { st.skip = 1; continue; } }
      if (wasFirst && RTF_SKIP.has(w)) { st.skip = 1; continue; }
      if (w === 'bin' && v > 0) { i += v; continue; }
      if (st.skip) continue;
      if (st.dest === 'pict') {
        if (w === 'pngblip') pict.type = 'image/png'; else if (w === 'jpegblip') pict.type = 'image/jpeg'; else if (w === 'picwgoal') pict.w = v;
        continue;
      }
      switch (w) {
        case 'ansicpg': cp = v === 65001 ? 'utf-8' : v === 10000 ? 'macintosh' : 'windows-' + v; break;
        case 'mac': cp = 'macintosh'; break;
        case 'pca': case 'pc': cp = 'ibm866'; break;
        case 'pict': flush(); st.dest = 'pict'; pict = { hex: [], type: '', w: 0 }; break;
        case 'b': fmt('b', v !== 0); break;
        case 'i': fmt('i', v !== 0); break;
        case 'ul': fmt('u', v !== 0); break;
        case 'ulnone': fmt('u', false); break;
        case 'strike': case 'striked': fmt('x', v !== 0); break;
        case 'super': fmt('sup', true); break;
        case 'sub': fmt('sub', true); break;
        case 'nosupersub': flush(); st.sup = st.sub = false; break;
        case 'plain': flush(); st.b = st.i = st.u = st.x = st.sup = st.sub = false; break;
        case 'par': case 'sect': case 'page': endPara(); break;
        case 'line': flush(); p().append(el('br')); break;
        case 'pard': flush(); st.al = ''; st.lv = 0; st.tb = false; break;
        case 'outlinelevel': st.lv = v != null && v < 9 ? v + 1 : 0; break;
        case 's': if (styleLevel.has(v)) st.lv = styleLevel.get(v); break;
        case 'qc': st.al = 'center'; break;
        case 'qr': st.al = 'right'; break;
        case 'qj': st.al = 'justify'; break;
        case 'ql': st.al = ''; break;
        case 'intbl': st.tb = true; break;
        case 'cell': endPara(); row = row || el('tr'); { const td_ = cell || el('td'); if (td_.childElementCount === 1 && td_.firstElementChild.localName === 'p') td_.replaceChildren(...td_.firstElementChild.childNodes); row.append(td_); } cell = null; break;
        case 'row': if (row) { table = table || el('table'); table.append(row); row = null; } st.tb = false; break;
        case 'uc': st.uc = v ?? 1; break;
        case 'u': flush(); emit(String.fromCharCode(v < 0 ? v + 65536 : v)); ucSkip = st.uc; break;
        default: if (RTF_CHAR[w]) { flush(); emit(RTF_CHAR[w]); }
      }
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    first = false;
    if (st.skip) { i++; continue; }
    if (st.dest === 'pict') { if (pict) pict.hex.push(c); i++; continue; }
    if (ucSkip > 0) { ucSkip--; i++; continue; }
    bbuf.push(c.charCodeAt(0));
    i++;
  }
  endPara();
  if (row) { table = table || el('table'); table.append(row); }
  flushTable();
  return frag;
}
/* judul & penulis dari {\info{\title …}{\author …}} */
function rtfMeta(bytes) {
  const s = latin1(bytes.subarray(0, 65536));
  const get = k => {
    const i = s.indexOf('{\\' + k + ' ');
    if (i < 0) return '';
    let out = '';
    for (let j = i + k.length + 3; j < s.length && s[j] !== '}' && s[j] !== '{'; j++) {
      if (s[j] !== '\\') { out += s[j]; continue; }
      if (s[j + 1] === "'") { out += String.fromCharCode(parseInt(s.substr(j + 2, 2), 16) || 32); j += 3; continue; }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(s.slice(j, j + 40));
      if (!m) { out += s[j + 1] || ''; j++; continue; }
      j += m[0].length - 1;
      if (m[1] === 'u' && m[2]) { out += String.fromCharCode(+m[2] < 0 ? +m[2] + 65536 : +m[2]); j++; }
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  return { title: get('title'), author: get('author') };
}
