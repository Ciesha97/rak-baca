// Membuat dokumen contoh untuk menguji Rak Baca: node tools/make-samples.js <folder-tujuan>
// Tanpa modul tambahan: ZIP, PNG, PDF, dan MOBI ditulis langsung dengan Node.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = process.argv[2] || path.join(__dirname, '..', 'contoh');
fs.mkdirSync(out, { recursive: true });
const put = (name, data) => fs.writeFileSync(path.join(out, name), data);

/* ---------- CRC32, PNG, ZIP ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = (x + y) % 40 < 20 ? 1 : 0.8;
      raw[o] = rgb[0] * band; raw[o + 1] = rgb[1] * band; raw[o + 2] = rgb[2] * band;
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, content, store] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = store ? data : zlib.deflateRawSync(data);
    const nb = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(store ? 0 : 8, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    locals.push(h, nb, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const IMG_RED = png(120, 180, [190, 60, 50]), IMG_BLUE = png(160, 100, [50, 90, 180]), IMG_GREEN = png(100, 150, [40, 140, 80]);

/* ---------- PDF ---------- */
function pdf() {
  const page = (contents, annots) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R >> >> /Contents ${contents} 0 R${annots ? ' /Annots [' + annots + ']' : ''} >>`;
  const stream = s => `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`;
  const t = (size, y, s) => `BT /F1 ${size} Tf 72 ${y} Td (${s}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines /Lang (id) >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    page(6, '13 0 R'), page(7), page(8),
    stream([t(28, 760, 'Halo Rak Baca'), t(14, 720, 'Halaman pertama dokumen PDF contoh.'), t(14, 690, 'Klik di sini untuk ke halaman tiga')].join('\n')),
    stream([t(24, 760, 'Bab Dua'), t(14, 720, 'Isi halaman kedua.')].join('\n')),
    stream([t(24, 760, 'Bab Tiga'), t(14, 720, 'Di sini ada kata kunci unik untuk pencarian.')].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 2 >>',
    '<< /Title (Bab Dua) /Parent 10 0 R /Next 12 0 R /Dest [4 0 R /XYZ 0 842 0] >>',
    '<< /Title (Bab Tiga) /Parent 10 0 R /Prev 11 0 R /Dest [5 0 R /XYZ 0 842 0] >>',
    '<< /Type /Annot /Subtype /Link /Rect [70 684 330 706] /Border [0 0 0] /Dest [5 0 R /XYZ 0 842 0] >>',
    '<< /Title (Dokumen PDF Contoh) /Author (Tim Uji Rak Baca) >>',
  ];
  let s = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(s, 'latin1')); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 14 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}
put('contoh.pdf', pdf());

/* ---------- EPUB ---------- */
const xhtml = (title, body, css = true) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="id" xml:lang="id">
<head><title>${title}</title>${css ? '<link rel="stylesheet" type="text/css" href="../css/gaya.css"/>' : ''}<script>window.__pwned = 'epub-head';</script></head>
<body>${body}</body></html>`;
const longPara = n => Array.from({ length: n }, (_, i) => `<p>Paragraf ${i + 1}. Rak Baca membaca dokumen langsung di perangkat tanpa internet. Kalimat ini sengaja dibuat panjang supaya bab ini memenuhi beberapa halaman ketika dibaca dalam mode halaman dengan ukuran huruf yang besar.</p>`).join('\n');
put('contoh.epub', zip([
  ['mimetype', 'application/epub+zip', true],
  ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/paket.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
  ['OEBPS/paket.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:rak-baca-contoh</dc:identifier><dc:title>Buku EPUB Contoh</dc:title><dc:creator>Penulis Uji</dc:creator><dc:language>id</dc:language></metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="sampul" href="gambar/sampul.png" media-type="image/png" properties="cover-image"/>
<item id="gbr" href="gambar/biru%20muda.png" media-type="image/png"/>
<item id="css" href="css/gaya.css" media-type="text/css"/>
<item id="b1" href="teks/bab1.xhtml" media-type="application/xhtml+xml"/>
<item id="b2" href="teks/bab2.xhtml" media-type="application/xhtml+xml"/>
<item id="b3" href="teks/bab3.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="b1"/><itemref idref="b2"/><itemref idref="b3"/></spine>
</package>`],
  ['OEBPS/nav.xhtml', xhtml('Daftar Isi', '<nav epub:type="toc"><h1>Daftar Isi</h1><ol><li><a href="teks/bab1.xhtml">Bab Satu</a></li><li><a href="teks/bab2.xhtml">Bab Dua</a><ol><li><a href="teks/bab2.xhtml#sub">Subbab Dua A</a></li></ol></li><li><a href="teks/bab3.xhtml">Bab Tiga</a></li></ol></nav>', false)],
  ['OEBPS/css/gaya.css', '@import url("http://contoh.invalid/x.css"); .tengah { text-align: center; } .miring { font-style: italic; } .bahaya { background: url(http://contoh.invalid/lacak.png); position: fixed; } body { display: none; }'],
  ['OEBPS/gambar/sampul.png', IMG_RED],
  ['OEBPS/gambar/biru muda.png', IMG_BLUE],
  ['OEBPS/teks/bab1.xhtml', xhtml('Bab Satu', `<h1 class="tengah">Bab Satu</h1>
<p class="miring">Pembuka bab pertama yang dimiringkan lewat CSS buku.</p>
<p>Lihat juga <a href="bab3.xhtml#akhir">bagian akhir</a> dan catatan<a epub:type="noteref" href="#cat1">1</a>.</p>
<p><img src="../gambar/biru%20muda.png" alt="Gambar biru"/></p>
<p><img src="x" onerror="window.__pwned='epub-img'" alt="gambar rusak"/></p>
<p><a href="javascript:window.__pwned='epub-link'">tautan jahat</a> <span onclick="window.__pwned='epub-click'">klik</span></p>
<iframe src="http://contoh.invalid/"></iframe><form><input value="x"/></form>
${longPara(40)}
<aside epub:type="footnote" id="cat1"><p>Ini isi catatan kaki pertama.</p></aside>`)],
  ['OEBPS/teks/bab2.xhtml', xhtml('Bab Dua', `<h1>Bab Dua</h1><p>Isi bab kedua.</p><h2 id="sub">Subbab Dua A</h2><p>Teks subbab dengan kata kunci unik di dalamnya.</p><svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#c84"/><script>window.__pwned='svg'</script></svg>`)],
  ['OEBPS/teks/bab3.xhtml', xhtml('Bab Tiga', `<h1>Bab Tiga</h1><p>Bab terakhir.</p><p id="akhir">Ini bagian akhir buku.</p>`)],
]));

/* ---------- DOCX ---------- */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const wp = (text, opts = {}) => `<w:p>${opts.style || opts.num || opts.jc ? `<w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${opts.num ? `<w:numPr><w:ilvl w:val="${opts.lvl || 0}"/><w:numId w:val="${opts.num}"/></w:numPr>` : ''}${opts.jc ? `<w:jc w:val="${opts.jc}"/>` : ''}</w:pPr>` : ''}${text}</w:p>`;
const wr = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const cell = (t, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${wp(wr(t))}</w:tc>`;
put('contoh.docx', zip([
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
  ['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Laporan Word Contoh</dc:title><dc:creator>Penyusun Uji</dc:creator></cp:coreProperties>'],
  ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://contoh.invalid/" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>'],
  ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Judul1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Judul2"><w:name w:val="heading 2"/><w:basedOn w:val="Judul1"/></w:style><w:style w:type="paragraph" w:styleId="Kutipan"><w:name w:val="Quote"/></w:style></w:styles>`],
  ['word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`],
  ['word/footnotes.xml', `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:id="-1" w:type="separator"><w:p/></w:footnote><w:footnote w:id="1">${wp('<w:r><w:footnoteRef/></w:r>' + wr(' Isi catatan kaki Word.'))}</w:footnote></w:footnotes>`],
  ['word/media/image1.png', IMG_GREEN],
  ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
${wp(wr('Pendahuluan'), { style: 'Judul1' })}
${wp(wr('Teks biasa, ') + wr('tebal', '<w:b/>') + wr(', ') + wr('miring', '<w:i/>') + wr(' dan ') + wr('bergaris', '<w:u w:val="single"/>') + wr('. Catatan') + '<w:r><w:footnoteReference w:id="1"/></w:r>' + wr('.'))}
${wp(wr('Rata tengah'), { jc: 'center' })}
${wp(wr('Langkah satu'), { num: 1 })}
${wp(wr('Rincian a'), { num: 1, lvl: 1 })}
${wp(wr('Langkah dua'), { num: 1 })}
${wp(wr('Butir poin'), { num: 2 })}
${wp('<w:hyperlink r:id="rId5">' + wr('Tautan luar') + '</w:hyperlink> <w:hyperlink r:id="rId6">' + wr('tautan jahat') + '</w:hyperlink>')}
${wp(wr('Kutipan penting.'), { style: 'Kutipan' })}
<w:tbl><w:tr>${cell('Kolom gabung', '<w:gridSpan w:val="2"/>')}${cell('C1', '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${cell('A2')}${cell('B2')}${cell('', '<w:vMerge/>')}</w:tr></w:tbl>
${wp('<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="1428750"/><wp:docPr id="1" name="Gambar" descr="Gambar hijau"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')}
${wp(wr('Bagian Kedua'), { style: 'Judul2' })}
${wp(wr('Isi bagian kedua dengan kata kunci unik.'))}
<w:sectPr/></w:body></w:document>`],
]));

/* ---------- ODT ---------- */
const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
put('contoh.odt', zip([
  ['mimetype', 'application/vnd.oasis.opendocument.text', true],
  ['META-INF/manifest.xml', '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>'],
  ['meta.xml', `<?xml version="1.0"?><office:document-meta ${ODT_NS}><office:meta><dc:title>Dokumen ODT Contoh</dc:title><meta:initial-creator>Penulis ODT</meta:initial-creator></office:meta></office:document-meta>`],
  ['Pictures/gambar.png', IMG_BLUE],
  ['content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODT_NS}>
<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style><text:list-style style:name="L1"><text:list-level-style-number text:level="1"/></text:list-style></office:automatic-styles>
<office:body><office:text>
<text:h text:outline-level="1">Judul ODT</text:h>
<text:p>Teks <text:span text:style-name="T1">tebal</text:span> dan <text:span text:style-name="T2">miring</text:span>.<text:s text:c="3"/>Catatan<text:note text:id="n1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Isi catatan ODT.</text:p></text:note-body></text:note>.</text:p>
<text:p text:style-name="P1">Paragraf tengah</text:p>
<text:list text:style-name="L1"><text:list-item><text:p>Nomor satu</text:p></text:list-item><text:list-item><text:p>Nomor dua</text:p></text:list-item></text:list>
<table:table><table:table-row><table:table-cell><text:p>S1</text:p></table:table-cell><table:table-cell><text:p>S2</text:p></table:table-cell></table:table-row></table:table>
<text:p><draw:frame svg:width="3cm" svg:height="2cm"><draw:image xlink:href="Pictures/gambar.png"/></draw:frame></text:p>
<text:h text:outline-level="2">Subjudul ODT</text:h><text:p>Ada kata kunci unik di sini. <text:a xlink:href="https://contoh.invalid/">tautan</text:a></text:p>
</office:text></office:body></office:document-content>`],
]));

/* ---------- FB2 ---------- */
put('contoh.fb2', `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Ayu</first-name><last-name>Pratiwi</last-name></author><book-title>Cerita FB2 Contoh</book-title><lang>id</lang><coverpage><image l:href="#sampul.png"/></coverpage></title-info></description>
<body><title><p>Cerita FB2 Contoh</p></title>
<section id="s1"><title><p>Bagian Satu</p></title><p>Awal cerita dengan <emphasis>penekanan</emphasis> dan <strong>huruf tebal</strong>.<a l:href="#n1" type="note">1</a></p><poem><stanza><v>Baris puisi satu</v><v>Baris puisi dua</v></stanza></poem></section>
<section id="s2"><title><p>Bagian Dua</p></title><p>Kelanjutan dengan kata kunci unik.</p><image l:href="#sampul.png"/></section>
</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>Catatan FB2 di akhir buku.</p></section></body>
<binary id="sampul.png" content-type="image/png">${IMG_RED.toString('base64')}</binary>
</FictionBook>`);

/* ---------- MOBI (PalmDOC) ---------- */
function palmCompress(src) {
  const outb = [];
  let i = 0;
  while (i < src.length) {
    let best = 0, dist = 0;
    for (let d = 1; d <= Math.min(2047, i); d++) {
      let l = 0;
      while (l < 10 && i + l < src.length && src[i + l] === src[i - d + l]) l++;
      if (l > best) { best = l; dist = d; }
    }
    if (best >= 3) { const c = 0x8000 | (dist << 3) | (best - 3); outb.push(c >> 8, c & 0xFF); i += best; continue; }
    const c = src[i];
    if (c === 0x20 && i + 1 < src.length && src[i + 1] >= 0x40 && src[i + 1] <= 0x7F) { outb.push(src[i + 1] ^ 0x80); i += 2; continue; }
    if (c === 0 || (c >= 9 && c <= 0x7F)) { outb.push(c); i++; continue; }
    let j = i;
    while (j < src.length && j - i < 8 && ((src[j] >= 1 && src[j] <= 8) || src[j] >= 0x80)) j++;
    outb.push(j - i, ...src.subarray(i, j));
    i = j;
  }
  return Buffer.from(outb);
}
function mobi() {
  let html = '<html><head><guide><reference type="toc" title="Daftar Isi" filepos=@@TOC@@ /></guide></head><body>'
    + '<h1>Buku MOBI Contoh</h1><p>Halaman judul buku MOBI. Teks berulang berulang berulang untuk menguji kompresi.</p><mbp:pagebreak/>'
    + '<a name="toc"></a><h2>Daftar Isi</h2><p><a filepos=@@B1@@>Bab Pertama</a></p><p><a filepos=@@B2@@>Bab Kedua</a></p><mbp:pagebreak/>'
    + '<h2>Bab Pertama</h2><p>Isi bab pertama dengan huruf é dan “kutip”. ' + 'Kalimat panjang yang diulang agar teks melewati beberapa rekaman. '.repeat(90) + '</p><p><img recindex="00001" /></p><mbp:pagebreak/>'
    + '<h2>Bab Kedua</h2><p>Bab kedua memuat kata kunci unik.</p></body></html>';
  const fix = (h, key, needle) => h.replace(key, String(Buffer.byteLength(h.slice(0, h.indexOf(needle)), 'utf8')).padStart(10, '0'));
  // panjang placeholder = 10 digit, jadi posisi byte tidak bergeser setelah diganti
  html = html.replace(/@@(TOC|B1|B2)@@/g, m => m.padEnd(10, '0').slice(0, 10));
  html = fix(html, '@@TOC@@000', '<a name="toc">');
  html = fix(html, '@@B1@@0000', '<h2>Bab Pertama');
  html = fix(html, '@@B2@@0000', '<h2>Bab Kedua');
  const text = Buffer.from(html, 'utf8');
  const recs = [];
  for (let i = 0; i < text.length; i += 4096) recs.push(Buffer.concat([palmCompress(text.subarray(i, i + 4096)), Buffer.from([0x00, 0xAA, 0xBB, 0x83])]));
  const title = Buffer.from('Buku MOBI Contoh', 'utf8');
  const exthRec = (type, data) => { const b = Buffer.alloc(8); b.writeUInt32BE(type, 0); b.writeUInt32BE(8 + data.length, 4); return Buffer.concat([b, data]); };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const exthBody = Buffer.concat([exthRec(100, Buffer.from('Penulis MOBI', 'utf8')), exthRec(503, title), exthRec(201, u32(0)), exthRec(524, Buffer.from('id'))]);
  const exthHead = Buffer.alloc(12); exthHead.write('EXTH', 0); exthHead.writeUInt32BE(12 + exthBody.length, 4); exthHead.writeUInt32BE(4, 8);
  const exth = Buffer.concat([exthHead, exthBody, Buffer.alloc((4 - exthBody.length % 4) % 4)]);
  const hl = 232;
  const r0 = Buffer.alloc(16 + hl);
  r0.writeUInt16BE(2, 0); r0.writeUInt32BE(text.length, 4); r0.writeUInt16BE(recs.length, 8); r0.writeUInt16BE(4096, 10);
  r0.write('MOBI', 16); r0.writeUInt32BE(hl, 20); r0.writeUInt32BE(2, 24); r0.writeUInt32BE(65001, 28); r0.writeUInt32BE(6, 36);
  for (let o = 40; o < 80; o += 4) r0.writeUInt32BE(0xFFFFFFFF, o);
  const firstImg = recs.length + 1;
  r0.writeUInt32BE(firstImg, 80);
  r0.writeUInt32BE(16 + hl + exth.length, 84); r0.writeUInt32BE(title.length, 88);
  r0.writeUInt32BE(6, 104); r0.writeUInt32BE(firstImg, 108); r0.writeUInt32BE(0x40, 128);
  r0.writeUInt16BE(3, 0xF2);
  const rec0 = Buffer.concat([r0, exth, title, Buffer.alloc(4)]);
  const all = [rec0, ...recs, IMG_GREEN];
  const head = Buffer.alloc(78 + all.length * 8 + 2);
  head.write('Buku_MOBI_Contoh', 0); head.write('BOOKMOBI', 60); head.writeUInt16BE(all.length, 76);
  let off = head.length;
  all.forEach((r, i) => { head.writeUInt32BE(off, 78 + i * 8); head.writeUInt32BE(i * 2, 78 + i * 8 + 4); off += r.length; });
  return Buffer.concat([head, ...all]);
}
put('contoh.mobi', mobi());

/* ---------- RTF ---------- */
put('contoh.rtf', Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\info{\\title Judul RTF}}
\\pard\\qc\\b Judul Dokumen RTF\\b0\\par
\\pard Ini paragraf dengan \\i miring\\i0 , \\b tebal\\b0 , caf\\'e9, dan euro \\u8364?.\\par
\\trowd\\cellx2000\\cellx4000\\intbl Sel A\\cell Sel B\\cell\\row
\\trowd\\cellx2000\\cellx4000\\intbl Sel C\\cell Sel D\\cell\\row
\\pard Paragraf setelah tabel dengan kata kunci unik.\\par
{\\*\\shppict{\\pict\\pngblip\\picw10\\pich10\\picwgoal1500\\pichgoal1500 ${IMG_BLUE.toString('hex')}}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\par
}`, 'latin1'));

/* ---------- Markdown, TXT, HTML, CSV, kode, gambar ---------- */
put('contoh.md', `# Catatan Markdown

Paragraf dengan **tebal**, *miring*, \`kode\`, ~~coret~~ dan [tautan](https://contoh.invalid/).
Baris kedua paragraf yang sama.

## Daftar

- butir satu
- butir dua
  - anak butir
1. nomor satu
2. nomor dua

- [x] tugas selesai
- [ ] tugas belum

> Kutipan **penting**.

| Nama | Nilai |
|:-----|------:|
| Ani  | 90 |
| Budi | 85 |

\`\`\`js
console.log("<b>tidak tebal</b>");
\`\`\`

Catatan kaki[^1] dan kata kunci unik.

<script>window.__pwned = 'md'</script>
<img src="x" onerror="window.__pwned='md-img'">

[^1]: Isi catatan markdown.
`);
put('contoh.txt', Buffer.from(`BAB 1 Awal Mula

Ini novel teks biasa dengan huruf caf\xE9 yang disimpan dalam windows-1252.
Baris ini tergabung dengan baris sebelumnya karena teksnya dipotong rapi
pada lebar tertentu seperti berkas teks lama dari internet.

BAB 2 Kelanjutan

Paragraf bab dua berisi kata kunci unik.
`, 'latin1'));
put('contoh.html', `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Halaman HTML Contoh</title><meta name="author" content="Penulis HTML">
<style>.merah{color:red;text-align:center} body{display:none}</style><script>window.__pwned='html-head'</script></head>
<body><h1 class="merah">Halaman HTML Contoh</h1><p>Paragraf HTML dengan kata kunci unik.</p>
<img src="x" onerror="window.__pwned='html-img'"><iframe srcdoc="<script>parent.__pwned='iframe'</script>"></iframe>
<a href="javascript:window.__pwned='html-link'">jahat</a><a href="#bawah">ke bawah</a>
<object data="x.swf"></object><svg><a xlink:href="javascript:alert(1)"><text y="20">svg</text></a></svg>
<p id="bawah">Bagian bawah.</p></body></html>`);
put('contoh.csv', 'Nama;Kota;Nilai\nAni;Bandung;90\n"Budi; Jr.";Medan;85\nCitra;"Kota ""Lama""";77\n');
put('contoh.json', JSON.stringify({ aplikasi: 'Rak Baca', format: ['pdf', 'epub'], versi: 1 }));
put('contoh.png', IMG_BLUE);
put('contoh.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#2a6"/><script>window.top.__pwned="svg-file"</script><text x="20" y="60" fill="#fff">SVG</text></svg>');
put('contoh.cbz', zip([['01.png', IMG_RED], ['02.png', IMG_GREEN], ['10.png', IMG_BLUE], ['ComicInfo.xml', '<?xml version="1.0"?><ComicInfo><Title>Komik Contoh</Title><Writer>Komikus Uji</Writer></ComicInfo>']]));
// teks besar untuk menguji pemecahan bagian
const big = [];
for (let b = 1; b <= 12; b++) { big.push(`BAB ${b}\n`); for (let p = 0; p < 120; p++) big.push(`Paragraf ${p + 1} bab ${b}. ` + 'Kalimat isi yang cukup panjang untuk membuat berkas teks besar. '.repeat(3) + '\n'); }
put('besar.txt', big.join('\n'));
console.log('contoh dibuat di', out, fs.readdirSync(out).join(', '));
