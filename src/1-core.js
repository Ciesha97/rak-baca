'use strict';
/* ================= Utilitas ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const NF = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return NF.format(n / 1024) + ' KB';
  if (n < 1073741824) return NF.format(n / 1048576) + ' MB';
  return NF.format(n / 1073741824) + ' GB';
}
function fmtDate(t) { const d = new Date(t); return `${d.getDate()} ${BLN[d.getMonth()]} ${d.getFullYear()}`; }
function fmtAgo(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  if (s < 172800) return 'kemarin';
  if (s < 604800) return Math.floor(s / 86400) + ' hari lalu';
  return fmtDate(t);
}
function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const baseName = n => String(n || '').split(/[\\/]/).pop();
const stripExt = n => baseName(n).replace(/\.[a-z0-9]{1,5}(\.zip)?$/i, '');
const extOf = n => { const m = /\.([a-z0-9]{1,5})$/i.exec(baseName(n)); return m ? m[1].toLowerCase() : ''; };
const niceTitle = n => stripExt(n).replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || 'Tanpa judul';

/* Pencarian tanpa membedakan huruf besar, tanda aksen, dan spasi ganda;
   peta indeks menjaga posisi di teks asli */
const MARKS = /[\u0300-\u036F]/g;
const WS = /\s/;
function fold(s) {
  let out = '';
  const map = [];
  let sp = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 10 || c === 9 || c === 13 || c === 160 || (c > 127 && WS.test(s[i]))) {
      if (!sp) { out += ' '; map.push(i); sp = true; }
      continue;
    }
    sp = false;
    if (c < 128) { out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]; map.push(i); continue; }
    const f = s[i].normalize('NFD').replace(MARKS, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { out += f[k]; map.push(i); }
  }
  map.push(s.length);
  return { s: out, map };
}
const foldQuery = q => String(q || '').normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
function snippet(text, start, end, pad = 50) {
  const a = Math.max(0, start - pad), b = Math.min(text.length, end + pad);
  const clean = t => t.replace(/\s+/g, ' ');
  return (a > 0 ? '…' : '') + esc(clean(text.slice(a, start))) + '<mark>' + esc(clean(text.slice(start, end))) + '</mark>' + esc(clean(text.slice(end, b))) + (b < text.length ? '…' : '');
}
/* semua kemunculan kueri (sudah lewat foldQuery) sebagai rentang [awal, akhir) di teks asli */
function findAll(text, q, limit = 1e6) {
  if (!q) return [];
  const f = fold(text);
  const res = [];
  let i = f.s.indexOf(q);
  while (i >= 0 && res.length < limit) {
    res.push([f.map[i], f.map[i + q.length - 1] + 1]);
    i = f.s.indexOf(q, i + q.length);
  }
  return res;
}

/* ================= Pengaturan (per perangkat) ================= */
const Settings = (() => {
  const KEY = 'rakbaca.settings.v1';
  const DEF = { theme: 'auto', font: 'serif', fontSize: 19, lineHeight: 1.6, measure: 'sedang', align: 'kiri', flowMode: 'paged', twoCols: false, indent: false, darkPages: true, ttsRate: 1, ttsVoice: '', sort: 'opened' };
  let s = { ...DEF };
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* penyimpanan tidak tersedia */ }
  const subs = new Set();
  return {
    get: k => s[k],
    all: () => ({ ...s }),
    set(patch) {
      Object.assign(s, patch);
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* abaikan */ }
      subs.forEach(f => f(patch));
    },
    on: f => subs.add(f),
  };
})();
function applyTheme() {
  const t = Settings.get('theme');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
const isDark = () => {
  const t = Settings.get('theme');
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
};

/* ================= Penyimpanan rak (IndexedDB, cadangan di memori) ================= */
const Store = (() => {
  let db = null;
  const mem = { books: new Map(), files: new Map() };
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (name, mode) => db.transaction(name, mode).objectStore(name);
  async function open() {
    try {
      db = await new Promise((res, rej) => {
        const r = indexedDB.open('rak-baca', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      });
      db.onversionchange = () => db.close();
    } catch (e) {
      console.warn('IndexedDB tidak tersedia, rak hanya bertahan selama halaman terbuka', e);
      db = null;
    }
    return !!db;
  }
  const store = name => ({
    async all() { return db ? wrap(tx(name, 'readonly').getAll()) : [...mem[name].values()]; },
    async get(k) { return db ? wrap(tx(name, 'readonly').get(k)) : mem[name].get(k); },
    async put(v, k) {
      if (!db) { mem[name].set(k ?? v.id, v); return; }
      await wrap(name === 'files' ? tx(name, 'readwrite').put(v, k) : tx(name, 'readwrite').put(v));
    },
    async del(k) { if (!db) { mem[name].delete(k); return; } await wrap(tx(name, 'readwrite').delete(k)); },
  });
  return {
    open,
    get persistent() { return !!db; },
    books: store('books'),
    files: store('files'),
    async estimate() { try { return await navigator.storage.estimate(); } catch (e) { return null; } },
    async persist() { try { return await navigator.storage.persist(); } catch (e) { return false; } },
  };
})();

/* ================= Notifikasi & dialog ================= */
function toast(msg, kind = '') {
  const t = el('div', { class: 'toast ' + kind, role: kind === 'bad' ? 'alert' : 'status', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}
/* ask({title, body, input, ok, cancel, danger}) -> nilai isian / true, atau null bila dibatalkan */
function ask(o) {
  const d = $('#dlg');
  return new Promise(resolve => {
    d.innerHTML = `<div class="dlg"><h2>${esc(o.title || '')}</h2>${o.body ? `<div class="body">${o.body}</div>` : ''}${o.input ? `<input type="${o.input.type || 'text'}" placeholder="${esc(o.input.placeholder || '')}" value="${esc(o.input.value || '')}" autocomplete="off">` : ''}<div class="acts">${o.cancel === false ? '' : `<button class="btn" data-a="no">${esc(o.cancel || 'Batal')}</button>`}<button class="btn ${o.danger ? 'danger' : 'primary'}" data-a="ok">${esc(o.ok || 'OK')}</button></div></div>`;
    const inp = $('input', d);
    let done = false;
    const finish = v => { if (done) return; done = true; d.close(); resolve(v); };
    d.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (a) finish(a.dataset.a === 'ok' ? (inp ? inp.value : true) : null);
      else if (e.target === d) finish(null);
    };
    d.onkeydown = e => { if (e.key === 'Enter' && inp) { e.preventDefault(); finish(inp.value); } };
    d.oncancel = e => { e.preventDefault(); finish(null); };
    d.showModal();
    (inp || $('[data-a="ok"]', d)).focus();
    if (inp) inp.select();
  });
}
let menuClose = null;
function popMenu(anchor, items) {
  if (menuClose) menuClose();
  const m = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(el('hr')); continue; }
    const b = el('button', { role: 'menuitem', class: it.danger ? 'danger' : '' });
    b.innerHTML = (it.icon ? icon(it.icon) : '') + esc(it.label);
    b.onclick = () => { close(); it.run(); };
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = clamp(r.right - mw, 8, innerWidth - mw - 8) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  const away = e => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  function close() {
    m.remove(); anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true);
    menuClose = null;
  }
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); });
  menuClose = close;
  $('button', m)?.focus();
}
function download(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = el('a', { href: u, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}

/* ================= Teks & berkas ================= */
const td = (label, opts) => { try { return new TextDecoder(label, opts); } catch (e) { return new TextDecoder('windows-1252'); } };
/* BOM -> UTF-8 ketat -> label dari dokumen -> windows-1252 */
function decodeText(bytes, hint) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return td('utf-8').decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return td('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return td('utf-16be').decode(b.subarray(2));
  if (hint && !/^utf-?8$/i.test(hint)) { try { return new TextDecoder(hint).decode(b); } catch (e) { /* label tak dikenal */ } }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* bukan UTF-8 */ }
  // UTF-16 tanpa BOM: banyak byte nol berselang-seling
  let z0 = 0, z1 = 0; const n = Math.min(b.length, 2000);
  for (let i = 0; i < n; i += 2) { if (!b[i]) z0++; if (!b[i + 1]) z1++; }
  if (n > 20 && z1 > n / 5) return td('utf-16le').decode(b);
  if (n > 20 && z0 > n / 5) return td('utf-16be').decode(b);
  return td(hint || 'windows-1252').decode(b);
}
const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return s; };
function xmlEncoding(bytes) {
  const head = latin1(bytes.subarray(0, 300));
  const m = /<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head);
  return m ? m[1] : null;
}
function htmlEncoding(bytes) {
  const head = latin1(bytes.subarray(0, 2048));
  const m = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head) || /<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head);
  return m ? m[1] : null;
}
function parseXML(text) {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length && !d.documentElement?.firstElementChild) throw new Error('XML rusak');
  return d;
}
/* XHTML dari EPUB: coba XML ketat dulu, bila rusak baca sebagai HTML biasa */
function parseXHTML(text) {
  let d = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (d.getElementsByTagName('parsererror').length || !d.body) d = new DOMParser().parseFromString(text, 'text/html');
  return d;
}
/* anak/turunan berdasarkan nama lokal (tanpa memedulikan prefiks namespace) */
const kids = (e, name) => e ? Array.from(e.children).filter(c => !name || c.localName === name) : [];
const kid = (e, name) => e ? Array.from(e.children).find(c => c.localName === name) || null : null;
const desc = (e, name) => e ? Array.from(e.getElementsByTagNameNS('*', name)) : [];
const desc1 = (e, name) => e ? e.getElementsByTagNameNS('*', name)[0] || null : null;
const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { const brand = latin1(b.subarray(8, 12)); if (/avi[fs]/.test(brand)) return 'image/avif'; }
  const head = latin1(b.subarray(0, 256)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<\!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return '';
}
const IMG_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' };
const isImageName = n => !!IMG_EXT[extOf(n)];
async function imageSize(url) {
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { return null; }
  return { w: img.naturalWidth || 600, h: img.naturalHeight || 800 };
}
/* gambar kecil untuk sampul di rak */
async function thumbnail(src, maxW = 360) {
  let bmp;
  try {
    if (src instanceof Blob) {
      try { bmp = await createImageBitmap(src); } catch (e) {
        const u = URL.createObjectURL(src);
        try { const img = new Image(); img.src = u; await img.decode(); bmp = img; } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
      }
    } else bmp = src;
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    if (!w0 || !h0) return null;
    const k = Math.min(1, maxW / w0), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  } catch (e) { return null; } finally { bmp?.close?.(); }
}

/* ================= ZIP (EPUB, DOCX, ODT, CBZ) ================= */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Peramban ini belum mendukung dekompresi ZIP. Perbarui Chrome/Edge/Firefox.');
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function openZip(blob) {
  const size = blob.size;
  const tailLen = Math.min(size, 65557);
  const tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
  let p = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error('Berkas ZIP rusak atau terpotong.');
  let count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdOff = tail.getUint32(p + 16, true);
  if ((cdOff === 0xFFFFFFFF || count === 0xFFFF) && p >= 20 && tail.getUint32(p - 20, true) === 0x07064b50) {
    const z64 = Number(tail.getBigUint64(p - 12, true));
    const r = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
    if (r.getUint32(0, true) === 0x06064b50) { count = Number(r.getBigUint64(32, true)); cdSize = Number(r.getBigUint64(40, true)); cdOff = Number(r.getBigUint64(48, true)); }
  }
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const u8 = new Uint8Array(cd.buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: true }), loose = new TextDecoder('windows-1252');
  const entries = new Map();
  let o = 0;
  for (let n = 0; n < count && o + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(o, true) !== 0x02014b50) break;
    const flags = cd.getUint16(o + 8, true), method = cd.getUint16(o + 10, true);
    let csize = cd.getUint32(o + 20, true), usize = cd.getUint32(o + 24, true), off = cd.getUint32(o + 42, true);
    const nl = cd.getUint16(o + 28, true), xl = cd.getUint16(o + 30, true), cl = cd.getUint16(o + 32, true);
    const nb = u8.subarray(o + 46, o + 46 + nl);
    let name; try { name = utf8.decode(nb); } catch (e) { name = loose.decode(nb); }
    let x = o + 46 + nl;
    const xEnd = x + xl;
    while (x + 4 <= xEnd) {
      const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (off === 0xFFFFFFFF) { off = Number(cd.getBigUint64(q, true)); }
      }
      x += 4 + len;
    }
    if (!name.endsWith('/')) entries.set(name.replace(/\\/g, '/'), { name, flags, method, csize, usize, off });
    o += 46 + nl + xl + cl;
  }
  const lower = new Map([...entries.keys()].map(k => [k.toLowerCase(), k]));
  const find = path => {
    path = String(path || '').replace(/^\/+/, '');
    return entries.get(path) || entries.get(lower.get(path.toLowerCase()));
  };
  async function bytes(path) {
    const e = find(path);
    if (!e) throw new Error('Bagian dokumen tidak ditemukan: ' + path);
    if (e.flags & 1) throw new Error('Berkas ZIP ini terenkripsi (berkata sandi).');
    const h = new DataView(await blob.slice(e.off, e.off + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw new Error('Isi ZIP rusak.');
    const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const raw = new Uint8Array(await blob.slice(start, start + e.csize).arrayBuffer());
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('Metode kompresi ZIP tidak didukung (' + e.method + ').');
  }
  return {
    names: [...entries.keys()],
    has: path => !!find(path),
    size: path => find(path)?.usize || 0,
    bytes,
    async text(path) { const b = await bytes(path); return decodeText(b, xmlEncoding(b)); },
    async blob(path, type) {
      const b = await bytes(path);
      return new Blob([b], { type: type || sniffImage(b) || IMG_EXT[extOf(path)] || 'application/octet-stream' });
    },
  };
}
/* ZIP tanpa kompresi (untuk membuat .docx) */
const CRC_T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files, type) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? enc.encode(content) : content, nb = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(h.buffer, nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    cd.push(c.buffer, nb);
    off += 30 + nb.length + data.length;
  }
  const size = cd.reduce((t, x) => t + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cd, e.buffer], { type: type || 'application/zip' });
}
function resolvePath(base, rel) {
  rel = String(rel || '').split('#')[0].split('?')[0];
  try { rel = decodeURIComponent(rel); } catch (e) { /* biarkan apa adanya */ }
  if (rel.startsWith('/')) base = '';
  const parts = (base ? base.split('/').slice(0, -1) : []).concat(rel.split('/'));
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';

/* ================= Penyaring HTML ================= */
/* Isi dokumen dibangun ulang dari daftar elemen & atribut yang aman, jadi skrip,
   event handler, iframe, formulir, dan tautan javascript: tidak pernah ikut tampil. */
const NS = { html: 'http://www.w3.org/1999/xhtml', svg: 'http://www.w3.org/2000/svg', math: 'http://www.w3.org/1998/Math/MathML', xlink: 'http://www.w3.org/1999/xlink', epub: 'http://www.idpf.org/2007/ops' };
const DROP = new Set('script style link meta base title head iframe frame frameset object embed applet param form input button select option optgroup textarea datalist output keygen template noscript canvas dialog slot portal fencedframe map area track'.split(' '));
const KEEP = new Set('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr audio video'.split(' '));
const RENAME = { center: 'div', font: 'span', big: 'span', tt: 'code', strike: 's', listing: 'pre', xmp: 'pre', plaintext: 'pre', blink: 'span', marquee: 'div', acronym: 'abbr', dir: 'ul', menu: 'ul', hgroup: 'div', search: 'div', body: 'div', html: 'div', picture: null };
const ATTR = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], col: ['span'], colgroup: ['span'], ol: ['start', 'reversed', 'type'], li: ['value'], time: ['datetime'], details: ['open'], audio: ['src'], video: ['src', 'width', 'height'], bdo: ['dir'] };
const SVG_KEEP = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs title desc image linearGradient radialGradient stop clipPath mask pattern symbol marker'.split(' '));
const SVG_ATTR = new Set('viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-miterlimit opacity font-size font-family font-weight font-style text-anchor dominant-baseline offset stop-color stop-opacity gradientUnits gradientTransform patternUnits clip-path clipPathUnits mask markerWidth markerHeight refX refY orient fx fy dx dy'.split(' '));
const MATH_KEEP = new Set('math mi mn mo ms mtext mspace mrow mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mstyle mpadded mphantom menclose merror semantics annotation mmultiscripts mprescripts none'.split(' '));
const MATH_ATTR = new Set('display mathvariant displaystyle scriptlevel stretchy fence separator lspace rspace accent accentunder columnalign rowalign columnspan rowspan linethickness notation width height depth largeop movablelimits form'.split(' '));
const STYLE_OK = new Set(['text-align', 'text-indent', 'font-style', 'font-weight', 'font-variant', 'font-variant-caps', 'text-decoration', 'text-decoration-line', 'text-decoration-style', 'text-transform', 'vertical-align', 'white-space', 'letter-spacing', 'margin-left', 'margin-right', 'padding-left', 'list-style-type', 'float', 'clear', 'font-size', 'text-align-last']);
/* kelas yang hanya dipakai lembar gaya pembaca sendiri (aman bila dipakai dokumen) */
const KEEP_CLASS = new Set(['notes', 'task', 'verse', 'poem', 'stanza', 'epigraph', 'byline', 'subtitle']);
const BAD_VAL = /url\s*\(|expression|javascript:|@import|[\\<>]|var\s*\(|env\s*\(|attr\s*\(/i;
const SIZE_WORD = { 'xx-small': '.6em', 'x-small': '.75em', small: '.875em', smaller: '.85em', large: '1.15em', larger: '1.15em', 'x-large': '1.4em', 'xx-large': '1.7em' };
function safeStyle(p, v) {
  v = String(v).trim();
  if (!v || BAD_VAL.test(v) || v.length > 80) return null;
  // nilai bawaan tidak perlu disalin (lembar gaya EPUB sering mengulangnya di setiap elemen)
  if (/^(margin|padding|text-indent|letter-spacing)/.test(p) && /^(0|0px|0em|0%|0pt|normal)$/.test(v)) return null;
  if ((p === 'vertical-align' && v === 'baseline') || (p === 'font-size' && /^(1(\.0+)?em|100%|medium|inherit)$/.test(v))) return null;
  if (/^(inherit|initial|unset|revert)$/.test(v)) return null;
  if (p === 'font-size') {
    if (SIZE_WORD[v]) return SIZE_WORD[v];
    const m = /^(\d*\.?\d+)(em|rem|%)$/.exec(v);
    if (!m) return null;
    const n = m[2] === '%' ? +m[1] / 100 : +m[1];
    return clamp(n, .55, 2.6).toFixed(3) + 'em';
  }
  if (p === 'float') return /^(left|right)$/.test(v) ? v : null;
  if (p === 'white-space') return /^(normal|pre|pre-wrap|pre-line|nowrap)$/.test(v) ? v : null;
  if (/^(margin|padding|text-indent|letter-spacing)/.test(p)) {
    const m = /^(-?\d*\.?\d+)(em|rem|%|px|pt|ex|ch)?$/.exec(v);
    if (!m) return /^(0|auto|normal)$/.test(v) ? v : null;
    const n = +m[1], u = m[2] || 'px';
    const em = u === 'px' ? n / 16 : u === 'pt' ? n / 12 : u === '%' ? n / 10 : n;
    return Math.abs(em) > 12 ? null : v;
  }
  return v;
}
/* aturan CSS buku diterapkan sebagai gaya langsung (yang lolos saringan), lalu lembar gaya dibuang */
function applyBookCss(doc, cssTexts) {
  const own = new Map();
  for (const css of cssTexts) {
    if (!css) continue;
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(css.replace(/@import[^;]*;/g, '')); } catch (e) { continue; }
    const rules = [];
    const walk = list => { for (const r of list) { if (r.selectorText !== undefined) rules.push(r); else if (r.cssRules && (r.conditionText === undefined || /^(all|screen)?\b/i.test(r.conditionText || 'all'))) walk(r.cssRules); } };
    try { walk(sheet.cssRules); } catch (e) { continue; }
    for (const r of rules) {
      const decl = [];
      for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (STYLE_OK.has(p)) decl.push([p, r.style.getPropertyValue(p)]); }
      if (!decl.length) continue;
      let list; try { list = doc.querySelectorAll(r.selectorText); } catch (e) { continue; }
      for (const node of list) {
        if (!node.style) continue;
        if (!own.has(node)) own.set(node, new Set(Array.from(node.style)));
        const mine = own.get(node);
        for (const [p, v] of decl) if (!mine.has(p)) node.style.setProperty(p, v);
      }
    }
  }
}
const epubType = e => (e.getAttributeNS?.(NS.epub, 'type') || e.getAttribute?.('epub:type') || '') + ' ' + (e.getAttribute?.('role') || '');
/* ctx: { prefix, img(src,el)->url|null|undefined(=tunda), link(href)->{sec,anc}|{ext}|null, textOnly } */
function sanitize(src, ctx) {
  const frag = document.createDocumentFragment();
  const out = (parent, node) => { if (node) parent.append(node); };
  const P = ctx.prefix || '';
  function attrsCommon(from, to) {
    const id = from.getAttribute('id') || from.getAttribute('name') && from.localName === 'a' && from.getAttribute('name');
    if (id) to.id = P + id;
    for (const a of ['title', 'dir']) { const v = from.getAttribute(a); if (v && v.length < 300) to.setAttribute(a, v); }
    const cls = (from.getAttribute('class') || '').split(/\s+/).filter(c => KEEP_CLASS.has(c));
    if (cls.length) to.setAttribute('class', cls.join(' '));
    const lang = from.getAttribute('lang') || from.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'lang');
    if (lang && /^[\w-]{1,20}$/.test(lang)) to.setAttribute('lang', lang);
    const st = from.style;
    const css = [];
    if (st) for (let i = 0; i < st.length; i++) {
      const p = st[i];
      if (!STYLE_OK.has(p)) continue;
      if (p === 'float' && from.localName !== 'img') continue;
      const v = safeStyle(p, st.getPropertyValue(p));
      if (v) css.push(p + ':' + v);
    }
    const al = from.getAttribute('align');
    if (al && /^(left|right|center|justify)$/i.test(al) && !/^(img|table)$/.test(from.localName)) css.push('text-align:' + al.toLowerCase());
    if (css.length) to.setAttribute('style', css.join(';'));
  }
  function walk(node, parent, inSvg) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 || n.nodeType === 4) { parent.append(document.createTextNode(n.data)); continue; }
      if (n.nodeType !== 1) continue;
      const ns = n.namespaceURI, ln = (n.localName || '').toLowerCase();
      if (ns === NS.svg || (inSvg && ns == null)) { out(parent, svgEl(n)); continue; }
      if (ns === NS.math) { out(parent, mathEl(n)); continue; }
      if (DROP.has(ln) || ln === 'annotation-xml' || ln.includes(':') && ln !== 'mbp:pagebreak') {
        if (ln.includes(':') && !DROP.has(ln)) walk(n, parent);
        continue;
      }
      if (ln === 'mbp:pagebreak') { parent.append(el('hr', { 'data-pb': '' })); continue; }
      if (ln === 'source') continue;
      let tag = KEEP.has(ln) ? ln : RENAME[ln];
      if (tag === undefined && ln in RENAME) tag = null;
      if (!tag) { walk(n, parent); continue; }
      if (tag === 'img') { out(parent, imgEl(n)); continue; }
      if ((tag === 'audio' || tag === 'video')) { out(parent, mediaEl(n, tag)); continue; }
      const e = document.createElement(tag);
      attrsCommon(n, e);
      for (const a of ATTR[tag] || []) {
        if (a === 'href' || a === 'src') continue;
        const v = n.getAttribute(a);
        if (v != null && v.length < 40 && /^[\w\s.%-]*$/.test(v)) e.setAttribute(a, v);
      }
      if (ln === 'center') e.style.textAlign = 'center';
      if (ln === 'font' || ln === 'big') { const sz = n.getAttribute('size'); if (ln === 'big' || /^\+/.test(sz || '')) e.style.fontSize = '1.15em'; else if (/^-/.test(sz || '')) e.style.fontSize = '.85em'; }
      const et = epubType(n);
      if (tag === 'aside' && /footnote|endnote|rearnote|doc-footnote|doc-endnote/.test(et)) e.setAttribute('data-fn', '');
      if (tag === 'a') linkAttrs(n, e, et);
      if (tag === 'table') {
        walk(n, e);
        const w = el('div', { class: 'tbl' }); w.append(e); parent.append(w);
        continue;
      }
      walk(n, e);
      parent.append(e);
    }
  }
  function linkAttrs(n, e, et) {
    const href = n.getAttribute('href') ?? n.getAttributeNS?.(NS.xlink, 'href');
    if (!href) return;
    const r = ctx.link ? ctx.link(href.trim()) : defaultLink(href.trim(), P);
    if (!r) return;
    e.setAttribute('href', r.ext || '#');
    if (r.ext) { e.setAttribute('data-ext', ''); e.setAttribute('rel', 'noopener noreferrer'); e.setAttribute('target', '_blank'); }
    else { e.setAttribute('data-sec', r.sec ?? ''); if (r.anc) e.setAttribute('data-anc', r.anc); }
    const cls = n.getAttribute('class') || '';
    if (/noteref|doc-noteref|annoref/.test(et) || /footnote|noteref|fnref|endnote/i.test(cls) || n.getAttribute('type') === 'note') e.setAttribute('data-note', '');
  }
  function imgEl(n) {
    const src = n.getAttribute('src') || n.getAttribute('data-src') || n.getAttribute('recindex') && 'rec:' + n.getAttribute('recindex') || '';
    const url = ctx.textOnly ? '' : ctx.img ? ctx.img(src, n) : safeDataImg(src);
    if (!url && !ctx.textOnly) {
      const alt = (n.getAttribute('alt') || '').trim();
      return alt && alt.length < 200 ? el('span', { class: 'img-miss', text: '[' + alt + ']' }) : null;
    }
    const e = document.createElement('img');
    attrsCommon(n, e);
    if (url) e.src = url;
    e.alt = (n.getAttribute('alt') || '').slice(0, 300);
    for (const a of ['width', 'height']) { const v = parseInt(n.getAttribute(a), 10); if (v > 0 && v < 10000) e.setAttribute(a, v); }
    e.loading = 'eager'; e.decoding = 'async';
    return e;
  }
  function mediaEl(n, tag) {
    if (ctx.textOnly) return null;
    let src = n.getAttribute('src');
    if (!src) { const s = Array.from(n.children).find(c => c.localName === 'source'); src = s?.getAttribute('src'); }
    const url = src && ctx.img ? ctx.img(src, n) : null;
    if (!url) return null;
    const e = document.createElement(tag);
    e.src = url; e.controls = true; e.preload = 'metadata';
    return e;
  }
  function svgEl(n) {
    const ln = n.localName;
    if (!SVG_KEEP.has(ln)) return null;
    if (ln === 'svg') {
      // sampul EPUB lazim berupa <svg><image href=…></svg>: cukup tampilkan gambarnya
      const imgs = Array.from(n.getElementsByTagNameNS(NS.svg, 'image'));
      const others = n.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text');
      if (imgs.length === 1 && !others.length) {
        const href = imgs[0].getAttributeNS(NS.xlink, 'href') || imgs[0].getAttribute('href') || '';
        const url = ctx.textOnly ? '' : ctx.img ? ctx.img(href, imgs[0]) : safeDataImg(href);
        if (!url && !ctx.textOnly) return null;
        const e = document.createElement('img'); if (url) e.src = url; e.alt = '';
        return e;
      }
    }
    if (ctx.textOnly) { const s = document.createElement('span'); if (ln === 'text' || ln === 'tspan' || ln === 'svg' || ln === 'g') s.textContent = n.textContent; return s; }
    const e = document.createElementNS(NS.svg, ln);
    for (const a of Array.from(n.attributes)) {
      const name = a.localName;
      let v = a.value;
      if (name === 'id') { e.setAttribute('id', P + v); continue; }
      if (name === 'href' && ln === 'image') { const url = ctx.img ? ctx.img(v, n) : safeDataImg(v); if (url) e.setAttribute('href', url); continue; }
      if (!SVG_ATTR.has(name) || v.length > 5000) continue;
      if (/url\s*\(/i.test(v)) { if (!/^\s*url\(\s*#[\w.-]+\s*\)\s*$/.test(v)) continue; v = v.replace(/#([\w.-]+)/, '#' + P + '$1'); }
      if (/javascript:|expression/i.test(v)) continue;
      e.setAttribute(name, v);
    }
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) e.append(document.createTextNode(c.data));
      else if (c.nodeType === 1) { const k = c.namespaceURI === NS.svg || c.namespaceURI == null ? svgEl(c) : null; if (k) e.append(k); }
    }
    return e;
  }
  function mathEl(n) {
    const ln = n.localName;
    if (!MATH_KEEP.has(ln)) { const f = document.createDocumentFragment(); for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) f.append(c.data); else if (c.nodeType === 1 && c.namespaceURI === NS.math) { const k = mathEl(c); if (k) f.append(k); } return f; }
    const e = document.createElementNS(NS.math, ln);
    for (const a of Array.from(n.attributes)) if (MATH_ATTR.has(a.localName) && a.value.length < 60 && !/[<>]|javascript:/i.test(a.value)) e.setAttribute(a.localName, a.value);
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) e.append(document.createTextNode(c.data));
      else if (c.nodeType === 1 && c.namespaceURI === NS.math) { const k = mathEl(c); if (k) e.append(k); }
    }
    return e;
  }
  walk(src, frag);
  return frag;
}
function safeDataImg(src) {
  src = String(src || '').trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(src) && src.length < 20e6) return src;
  if (/^blob:/i.test(src)) return src;
  return null;
}
function defaultLink(href, prefix) {
  if (/^#/.test(href)) { let a = href.slice(1); try { a = decodeURIComponent(a); } catch (e) { /* biarkan */ } return { sec: '', anc: a ? prefix + a : '' }; }
  if (/^(https?:|mailto:)/i.test(href)) return { ext: href };
  if (/^www\./i.test(href)) return { ext: 'https://' + href };
  return null;
}
