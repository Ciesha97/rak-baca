// Uji menyeluruh Rak Baca di Chromium: node tools/test-reader.js <folder-contoh>
// Butuh paket "playwright" (atau "playwright-core" + CHROME_PATH). Membuka rak-baca.html lewat file://,
// memasukkan setiap dokumen contoh, lalu memeriksa tampilan, keamanan, navigasi, pencarian, dan penyimpanan.
'use strict';
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('playwright-core'); }

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'contoh'));
const page_url = 'file://' + path.resolve(__dirname, '..', 'rak-baca.html').replace(/\\/g, '/').replace(/^\/?/, '/');
const fails = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { fails.push(msg); console.log('  GAGAL:', msg); } };

(async () => {
  const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(page_url);
  await page.waitForSelector('#empty:not([hidden])');
  ok(await page.isVisible('#empty'), 'rak kosong tampil saat pertama dibuka');

  const pwned = () => page.evaluate(() => window.__pwned || window.top.__pwned || null);
  const toShelf = async () => {
    if (await page.isVisible('#reader')) { await page.click('#rd-back'); }
    await page.waitForSelector('#reader', { state: 'hidden' });
  };
  async function open(name) {
    await toShelf();
    await page.setInputFiles('#file', path.join(dir, name));
    await page.waitForSelector('#reader:not([hidden])');
    await page.waitForFunction(() => {
      const st = document.querySelector('#stage');
      if (st.querySelector('.rd-error')) return true;
      if (st.querySelector('.loading')) return false;
      const doc = st.querySelector('.doc');
      if (doc) return doc.textContent.trim().length > 0;
      return !!st.querySelector('.pgv canvas, .pgv img[src]');
    }, null, { timeout: 30000 });
    const err = await page.$eval('#stage', s => s.querySelector('.rd-error')?.textContent || '');
    ok(!err, `${name} terbuka tanpa galat ${err}`);
    await page.waitForTimeout(150);
  }
  const text = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => '');
  const count = sel => page.$$eval(sel, l => l.length);
  const imgsLoaded = sel => page.$$eval(sel, l => l.length > 0 && l.every(i => i.complete && i.naturalWidth > 0));
  async function tocTitles() {
    await page.click('#rd-toc');
    await page.waitForSelector('.panel');
    const t = await page.$$eval('.toc button', l => l.map(b => b.textContent.trim()));
    return t;
  }
  async function closePanel() { if (await page.$('.panel')) await page.keyboard.press('Escape'); await page.waitForSelector('.panel', { state: 'detached' }); }
  async function searchFor(q) {
    await page.keyboard.press('Control+f');
    await page.waitForSelector('.panel .search-row input');
    await page.fill('.panel .search-row input', q);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /hasil|Tidak ditemukan|tidak bisa/.test(document.querySelector('.s-stat')?.textContent || ''), null, { timeout: 15000 });
    const n = await count('.hits button');
    await page.waitForTimeout(400);
    return n;
  }

  /* ---------- PDF ---------- */
  console.log('PDF');
  await open('contoh.pdf');
  ok(await text('#rd-title') === 'Dokumen PDF Contoh', 'judul PDF dari metadata');
  await page.waitForFunction(() => /Halo Rak Baca/.test(document.querySelector('.pgv .textLayer')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok(/Halo Rak Baca/.test(await text('.pgv .textLayer')), 'lapisan teks PDF bisa dipilih');
  ok(await count('.pgv .links a') >= 1, 'tautan internal PDF terpasang');
  ok(await page.evaluate(async () => { for (const f of ['jbig2.wasm', 'openjpeg.wasm']) await WebAssembly.compile(await new EmbeddedData().fetch({ kind: 'wasmUrl', filename: f })); return true; }).catch(e => false), 'dekoder JBIG2/JPEG2000 (WebAssembly) diizinkan CSP');
  let toc = await tocTitles();
  ok(toc.length === 2 && /Bab Dua/.test(toc[0]) && /Bab Tiga/.test(toc[1]), 'kerangka (outline) PDF jadi daftar isi: ' + toc.join('|'));
  await page.click('.toc button >> nth=1');
  await page.waitForTimeout(500);
  ok(/^3\/3/.test(await text('#rd-pos')), 'klik daftar isi PDF ke halaman 3: ' + await text('#rd-pos'));
  await closePanel().catch(() => {});
  ok(await searchFor('kata kunci unik') >= 1, 'pencarian PDF menemukan hasil');
  await page.waitForSelector('.textLayer mark.cur', { timeout: 10000 }).catch(() => {});
  ok(await count('.textLayer mark.cur') >= 1, 'hasil pencarian PDF disorot');
  await closePanel().catch(() => {});
  await page.click('#rd-view');
  await page.click('.pop .seg[data-k="fxmode"] button[data-v="single"]');
  await page.waitForTimeout(300);
  ok(await page.$eval('.fixed', e => e.classList.contains('single')), 'PDF bisa mode per halaman');
  await page.keyboard.press('Escape');
  await page.click('#rd-prev');
  await page.waitForTimeout(300);
  ok(/^2\/3/.test(await text('#rd-pos')), 'tombol sebelumnya di mode per halaman: ' + await text('#rd-pos'));

  /* ---------- EPUB ---------- */
  console.log('EPUB');
  await open('contoh.epub');
  ok(await text('#rd-title') === 'Buku EPUB Contoh', 'judul EPUB dari OPF');
  ok(await page.$eval('.doc h1', e => getComputedStyle(e).textAlign) === 'center', 'CSS buku (kelas .tengah) diterapkan');
  ok(await page.$eval('.doc p', e => getComputedStyle(e).fontStyle) === 'italic', 'CSS buku (kelas .miring) diterapkan');
  ok(await page.$eval('.doc', e => getComputedStyle(e).display) !== 'none' && await page.isVisible('.doc h1'), 'CSS buku tidak bisa menyembunyikan isi');
  await page.waitForTimeout(300);
  ok(await imgsLoaded('.doc img'), 'gambar EPUB (nama berspasi) tampil');
  ok(await count('.doc script, .doc iframe, .doc form, .doc input, .doc [onerror], .doc [onclick], .doc a[href^="javascript"], .doc style, .doc link') === 0, 'skrip/iframe/formulir/handler dibuang dari EPUB');
  ok(await page.$eval('.doc', e => !/position:\s*fixed|url\(/.test(e.innerHTML)), 'gaya berbahaya dari CSS buku dibuang');
  toc = await tocTitles();
  ok(toc.join('|') === 'Bab Satu|Bab Dua|Subbab Dua A|Bab Tiga', 'daftar isi EPUB (nav): ' + toc.join('|'));
  await closePanel();
  const pos1 = await text('#rd-pos');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const pos2 = await text('#rd-pos');
  ok(pos1 !== pos2 && /^2\//.test(pos2), `halaman berikutnya di mode halaman (${pos1} -> ${pos2})`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  await page.click('.doc a[data-note]');
  await page.waitForSelector('.note-pop');
  ok(/catatan kaki pertama/.test(await text('.note-pop')), 'catatan kaki EPUB muncul sebagai pop-up');
  await page.keyboard.press('Escape');
  await page.click('.doc a[data-anc]:has-text("bagian akhir")');
  await page.waitForTimeout(500);
  ok(/Bab Tiga/.test(await text('#rd-sub')) && await page.isVisible('.doc [id$="akhir"]'), 'tautan antarbab EPUB berpindah ke Bab Tiga');
  ok(await page.isVisible('text=Kembali ke posisi tadi'), 'tombol kembali setelah lompat tautan');
  await page.click('text=Kembali ke posisi tadi');
  await page.waitForTimeout(400);
  ok(/Bab Satu/.test(await text('#rd-sub')), 'kembali ke posisi semula');
  ok(await searchFor('KATA kunci unik') === 1, 'pencarian EPUB tanpa membedakan huruf besar');
  await page.click('.hits button');
  await page.waitForTimeout(500);
  ok(/Bab Dua/.test(await text('#rd-sub')), 'klik hasil pencarian membuka Bab Dua');
  await closePanel().catch(() => {});
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  ok(await page.getAttribute('#rd-mark', 'aria-pressed') === 'true', 'penanda halaman aktif');
  // pengaturan tampilan
  await page.click('#rd-view');
  ok(await page.evaluate(() => Reader.view.geo.cols) === 1, 'bawaan 1 kolom walau layar lebar');
  await page.click('.pop .seg[data-k="layout"] button[data-v="2"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Reader.view.geo.cols) === 2, 'pilihan 2 kolom di layar lebar');
  await page.click('.pop .seg[data-k="layout"] button[data-v="1"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Reader.view.geo.cols) === 1 && /Subbab|Bab Dua/.test(await text('#rd-sub')), 'kembali ke 1 kolom, posisi baca tetap');
  await page.click('.pop .seg[data-k="layout"] button[data-v="scroll"]');
  await page.waitForTimeout(300);
  ok(await page.$eval('.flow', e => e.classList.contains('scroll')), 'mode gulir aktif');
  await page.click('.pop .seg[data-k="layout"] button[data-v="1"]');
  await page.click('.pop [data-fs="1"]');
  await page.click('.pop [data-theme="dark"]');
  await page.waitForTimeout(200);
  ok(await page.getAttribute('html', 'data-theme') === 'dark', 'tema gelap');
  await page.click('.pop [data-theme="auto"]');
  await page.keyboard.press('Escape');
  ok(!(await pwned()), 'tidak ada skrip dari EPUB yang berjalan');

  /* ---------- DOCX ---------- */
  console.log('DOCX');
  await open('contoh.docx');
  ok(await text('#rd-title') === 'Laporan Word Contoh', 'judul DOCX dari docProps');
  ok(await text('.doc h1') === 'Pendahuluan' && await text('.doc h2') === 'Bagian Kedua', 'judul bab DOCX dari gaya heading (ID gaya berbahasa Indonesia)');
  ok(await text('.doc strong') === 'tebal' && await text('.doc em') === 'miring' && await text('.doc u') === 'bergaris', 'format huruf DOCX');
  ok(await count('.doc > ol > li') === 2 && await page.$eval('.doc ol ol', e => e.type === 'a').catch(() => false) && await count('.doc > ul > li') === 1, 'daftar bernomor, bersarang, dan butir DOCX');
  ok(await page.$eval('.doc table', t => !!t.querySelector('td[colspan="2"]') && !!t.querySelector('td[rowspan="2"]')).catch(() => false), 'sel tabel gabungan DOCX');
  ok(await imgsLoaded('.doc img'), 'gambar DOCX tampil');
  ok(await page.$eval('.doc a[data-ext]', a => a.href.startsWith('https://contoh.invalid')).catch(() => false), 'tautan luar DOCX');
  ok(await count('.doc a[href^="javascript"]') === 0, 'tautan javascript: DOCX dibuang');
  ok(await count('.doc a[data-note]') === 1 && /catatan kaki Word/.test(await text('.doc .notes')), 'catatan kaki DOCX');
  ok(await text('.doc blockquote') === 'Kutipan penting.', 'gaya kutipan DOCX jadi blockquote');
  ok(await page.$eval('.doc p[style*="center"]', e => e.textContent).catch(() => '') === 'Rata tengah', 'perataan paragraf DOCX');

  /* ---------- ODT ---------- */
  console.log('ODT');
  await open('contoh.odt');
  ok(await text('#rd-title') === 'Dokumen ODT Contoh', 'judul ODT dari meta.xml');
  ok(await text('.doc h1') === 'Judul ODT' && await text('.doc strong') === 'tebal' && await text('.doc em') === 'miring', 'judul & format ODT');
  ok(await count('.doc > ol > li') === 2, 'daftar bernomor ODT');
  ok(await count('.doc table td') === 2, 'tabel ODT');
  ok(await imgsLoaded('.doc img'), 'gambar ODT tampil');
  ok(await count('.doc a[data-note]') === 1, 'catatan ODT');
  ok(await page.$eval('.doc p', e => e.textContent.includes('miring.   Catatan')).catch(() => false), 'spasi ganda ODT (text:s)');

  /* ---------- FB2 ---------- */
  console.log('FB2');
  await open('contoh.fb2');
  ok(await text('#rd-title') === 'Cerita FB2 Contoh', 'judul FB2');
  toc = await tocTitles();
  ok(toc.includes('Bagian Satu') && toc.includes('Bagian Dua'), 'daftar isi FB2: ' + toc.join('|'));
  await page.click('.toc button:has-text("Bagian Satu")');
  await page.waitForTimeout(400);
  await page.click('.doc a[data-note]');
  await page.waitForSelector('.note-pop');
  ok(/Catatan FB2/.test(await text('.note-pop')), 'catatan FB2 dari body notes');
  await page.keyboard.press('Escape');
  ok(await count('.doc .verse') === 2, 'puisi FB2');

  /* ---------- MOBI ---------- */
  console.log('MOBI');
  await open('contoh.mobi');
  ok(await text('#rd-title') === 'Buku MOBI Contoh', 'judul MOBI dari EXTH');
  toc = await tocTitles();
  ok(toc.join('|') === 'Bab Pertama|Bab Kedua', 'daftar isi MOBI dari halaman TOC: ' + toc.join('|'));
  await page.click('.toc button:has-text("Bab Pertama")');
  await page.waitForTimeout(500);
  ok(/huruf é dan “kutip”/.test(await page.$eval('.doc', e => e.textContent)), 'teks MOBI (PalmDOC, UTF-8) terurai benar');
  ok(await page.$eval('.doc', e => e.textContent.split('Kalimat panjang yang diulang agar teks melewati beberapa rekaman.').length - 1) === 90, 'kompresi PalmDOC lintas rekaman & data ekor terbuang');
  ok(await imgsLoaded('.doc img'), 'gambar MOBI (recindex) tampil');
  await page.click('#rd-toc');
  await page.click('.toc button:has-text("Bab Kedua")');
  await page.waitForTimeout(500);
  ok(await page.isVisible('.doc h2:has-text("Bab Kedua")'), 'lompat ke Bab Kedua MOBI (filepos)');
  await closePanel().catch(() => {});

  /* ---------- RTF ---------- */
  console.log('RTF');
  await open('contoh.rtf');
  ok(await page.$eval('.doc p strong', e => e.textContent).catch(() => '') === 'Judul Dokumen RTF', 'teks tebal RTF');
  ok(await page.$eval('.doc p', e => e.style.textAlign) === 'center', 'perataan RTF');
  const rtf = await page.$eval('.doc', e => e.textContent);
  ok(rtf.includes('café') && rtf.includes('€'), 'karakter khusus RTF (\\\'e9, \\u8364)');
  ok(await count('.doc table tr') === 2 && await count('.doc table td') === 4, 'tabel RTF');
  ok(await imgsLoaded('.doc img') && await count('.doc img') === 1, 'gambar PNG RTF (tanpa duplikat WMF)');

  /* ---------- Markdown ---------- */
  console.log('MD');
  await open('contoh.md');
  ok(await text('#rd-title') === 'Catatan Markdown', 'judul Markdown dari # pertama');
  ok(await count('.doc strong') >= 2 && await count('.doc em') >= 1 && await count('.doc s') === 1 && await count('.doc :not(pre) > code') === 1, 'format inline Markdown');
  ok(await count('.doc ul ul li') === 1 && await count('.doc > ol > li') === 2, 'daftar Markdown bersarang');
  ok(await count('.doc li.task') === 2, 'daftar tugas Markdown');
  ok(await page.$eval('.doc th:last-child', e => e.style.textAlign) === 'right', 'perataan kolom tabel Markdown');
  ok(await text('.doc pre code') === 'console.log("<b>tidak tebal</b>");', 'blok kode Markdown tidak ditafsirkan');
  ok(await count('.doc a[data-note]') === 1, 'catatan kaki Markdown');
  ok(await count('.doc script, .doc img[src="x"]') === 0, 'HTML berbahaya di Markdown dibuang');

  /* ---------- TXT ---------- */
  console.log('TXT');
  await open('contoh.txt');
  ok(await text('.doc h2') === 'BAB 1 Awal Mula', 'judul bab TXT terdeteksi');
  ok(/huruf café yang/.test(await page.$eval('.doc', e => e.textContent)), 'TXT windows-1252 terbaca');
  ok(await page.$eval('.doc p', e => !e.querySelector('br')), 'baris TXT terpotong digabung jadi paragraf');

  /* ---------- HTML ---------- */
  console.log('HTML');
  await open('contoh.html');
  ok(await text('#rd-title') === 'Halaman HTML Contoh', 'judul HTML');
  ok(await page.$eval('.doc h1', e => getComputedStyle(e).textAlign) === 'center', 'CSS <style> HTML diterapkan (aman)');
  ok(await count('.doc iframe, .doc object, .doc script, .doc [onerror], .doc a[href^="javascript"]') === 0, 'HTML berbahaya dibuang');
  ok(await page.$eval('.doc svg a', a => !a.getAttribute('href') && !a.getAttribute('xlink:href')).catch(() => true), 'tautan javascript di SVG dibuang');

  /* ---------- CSV, kode ---------- */
  console.log('CSV & kode');
  await open('contoh.csv');
  ok(await count('.doc tbody tr') === 3 && await count('.doc thead th') === 4, 'tabel CSV (titik koma) dengan judul kolom');
  ok(/Budi; Jr\./.test(await text('.doc tbody')) && /Kota "Lama"/.test(await text('.doc tbody')), 'tanda kutip CSV');
  ok(await page.$eval('.flow', e => e.classList.contains('scroll')), 'CSV memakai mode gulir');
  await open('contoh.json');
  ok(/"aplikasi": "Rak Baca"/.test(await text('.doc pre')), 'JSON dirapikan');

  /* ---------- gambar & komik ---------- */
  console.log('Gambar & CBZ');
  await open('contoh.png');
  ok(await imgsLoaded('.pgv img'), 'gambar PNG tampil');
  await open('contoh.svg');
  ok(await imgsLoaded('.pgv img'), 'gambar SVG tampil');
  ok(!(await pwned()), 'skrip di dalam SVG tidak berjalan');
  await open('contoh.cbz');
  ok(await text('#rd-title') === 'Komik Contoh', 'judul CBZ dari ComicInfo.xml');
  ok(/^1\/3/.test(await text('#rd-pos')), 'komik 3 halaman');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  ok(/^2\/3/.test(await text('#rd-pos')), 'halaman komik berikutnya');

  /* ---------- teks besar ---------- */
  console.log('Teks besar');
  await open('besar.txt');
  toc = await tocTitles();
  ok(toc.length === 12 && toc[0] === 'BAB 1' && toc[11] === 'BAB 12', 'bab di teks besar: ' + toc.length);
  ok(await page.evaluate(() => Reader.doc.sections.length) > 1, 'teks besar dipecah jadi beberapa bagian');
  await page.click('.toc button:has-text("BAB 12")');
  await page.waitForTimeout(500);
  ok(await page.isVisible('.doc h2:has-text("BAB 12")'), 'lompat ke bab terakhir');
  ok(await page.$eval('#rd-seek', e => +e.value) > 850, 'penggeser posisi mengikuti');
  await closePanel().catch(() => {});

  /* ---------- rak, sampul, penyimpanan ---------- */
  console.log('Rak & penyimpanan');
  await toShelf();
  await page.waitForTimeout(1500);
  const cards = await count('#grid .card');
  ok(cards === 16, 'semua dokumen ada di rak: ' + cards);
  ok(await count('#grid .cover img') >= 4, 'sampul dibuat untuk PDF/EPUB/CBZ/FB2/MOBI: ' + await count('#grid .cover img'));
  await page.setInputFiles('#file', path.join(dir, 'contoh.epub'));
  await page.waitForSelector('#reader:not([hidden])');
  await page.waitForSelector('.doc h1');
  ok(cards === await page.evaluate(() => Shelf.books.length), 'berkas sama tidak dobel di rak');
  ok(/Bab Dua/.test(await text('#rd-sub')), 'EPUB dibuka lagi di posisi terakhir');
  await toShelf();
  await page.reload();
  await page.waitForSelector('#grid .card');
  ok(await count('#grid .card') === 16, 'rak tetap ada setelah halaman dimuat ulang');
  ok(!(await page.isHidden('#resume-wrap')), 'kartu "Lanjutkan membaca" tampil');
  await page.click('#grid .card:has-text("Buku EPUB Contoh") .card-open');
  await page.waitForSelector('.doc h1');
  await page.waitForTimeout(300);
  ok(/Bab Dua/.test(await text('#rd-sub')), 'posisi baca bertahan setelah muat ulang');
  await page.click('#rd-toc');
  await page.click('.tabs [data-t="marks"]');
  ok(await count('.bms li') === 1, 'penanda tersimpan');
  await closePanel();
  await page.goBack();
  await page.waitForSelector('#reader', { state: 'hidden' });
  ok(true, 'tombol kembali peramban menutup layar baca');
  await page.click('#grid .card:has-text("Komik Contoh") .more');
  await page.click('.menu button:has-text("Hapus dari rak")');
  await page.click('#dlg [data-a="ok"]');
  await page.waitForTimeout(300);
  ok(await count('#grid .card') === 15, 'hapus dari rak');

  /* ---------- bacakan (mesin suara palsu: berhasil & gagal) ---------- */
  console.log('Bacakan');
  for (const delay of [150, 0]) {
    const tp = await ctx.newPage();
    tp.on('pageerror', e => errors.push('pageerror (bacakan): ' + e.message));
    await tp.addInitScript(d => {
      speechSynthesis.getVoices = () => [{ name: 'Suara Uji', lang: 'id-ID', default: true }];
      speechSynthesis.speak = u => { window.__spoken = (window.__spoken || 0) + 1; setTimeout(() => u.onend && u.onend(), d); };
      speechSynthesis.cancel = () => {};
    }, delay);
    await tp.goto(page_url);
    await tp.waitForSelector('#grid .card');
    await tp.click('#grid .card:has-text("Laporan Word Contoh") .card-open');
    await tp.waitForSelector('.doc h1');
    const before = await tp.textContent('#rd-pos');
    await tp.keyboard.press('r');
    await tp.waitForTimeout(1200);
    if (delay) {
      ok(await tp.isVisible('.tts') && await tp.evaluate(() => window.__spoken > 2 && CSS.highlights.has('rb-tts')), 'bacakan berjalan dan menyorot paragraf');
      await tp.keyboard.press('r');
      ok(!(await tp.$('.tts')), 'bacakan bisa dihentikan');
    } else {
      ok(!(await tp.$('.tts')) && /tidak bisa diputar/.test(await tp.textContent('#toasts')) && await tp.textContent('#rd-pos') === before, 'mesin suara rusak: berhenti dan posisi baca tidak bergeser');
    }
    await tp.close();
  }

  ok(!(await pwned()), 'tidak ada skrip dokumen yang berjalan selama pengujian');
  const bad = errors.filter(e => !/Failed to load resource|favicon/.test(e));
  ok(bad.length === 0, 'tidak ada galat JavaScript: ' + bad.join(' || '));
  await browser.close();
  console.log(`\n${passed} lolos, ${fails.length} gagal`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
