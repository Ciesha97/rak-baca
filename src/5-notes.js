/* ================= Catatan: kutipan + insight, ekspor ke Word ================= */
const Notes = (() => {
  let chip = null, chipSel = '';

  /* lokasi kutipan: blok/halaman tempat pilihan teks dimulai */
  function posOf(node) {
    const v = Reader.view, d = Reader.doc;
    const e = node && (node.nodeType === 1 ? node : node.parentElement);
    if (d.kind === 'flow') {
      const bl = v.blocks();
      const b = e ? bl.findIndex(x => x === e || x.contains(e) || e.contains(x)) : -1;
      if (b >= 0) return { kind: 'flow', s: v.sec, b, o: 0 };
    } else {
      const pg = e?.closest('.pgv');
      if (pg) return { kind: 'fixed', p: +pg.dataset.i, y: 0 };
    }
    return Reader.posRecord();
  }
  function whereOf(p) {
    const d = Reader.doc, v = Reader.view;
    if (p.kind === 'fixed') return 'Halaman ' + (p.p + 1);
    // judul bab terdekat di atas kutipan
    if (v.sec === p.s) {
      const bl = v.blocks();
      for (let i = Math.min(p.b, bl.length - 1); i >= 0; i--) if (/^h[1-3]$/.test(bl[i].localName)) { const h = txt(bl[i]); if (h) return h.slice(0, 120); }
    }
    const t = d.sections[p.s]?.title;
    return t || (d.sections.length > 1 ? 'Bagian ' + (p.s + 1) : '');
  }
  const selText = () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !$('#stage').contains(s.anchorNode)) return '';
    if (s.anchorNode && s.anchorNode.parentElement?.closest('.tr-pop,.panel,.pop,.note-pop,dialog')) return '';
    // nomor catatan kaki tidak ikut; antarblok dipisah baris baru
    const f = s.getRangeAt(0).cloneContents();
    f.querySelectorAll('a[data-note], .links').forEach(x => (x.closest('sup') && x.closest('sup').textContent === x.textContent ? x.closest('sup') : x).remove());
    let out = '';
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeType === 1) {
          if (c.localName === 'br') { out += '\n'; continue; }
          const block = /^(p|div|li|h[1-6]|blockquote|tr|pre|dd|dt|figcaption|section)$/.test(c.localName);
          if (block && out && !out.endsWith('\n')) out += '\n';
          walk(c);
          if (block) out += '\n';
        }
      }
    };
    walk(f);
    return (out.trim() ? out : s.toString()).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  /* ---------- editor ---------- */
  function editor(n, isNew) {
    const d = $('#dlg');
    return new Promise(resolve => {
      d.innerHTML = `<div class="dlg note-ed"><h2>${isNew ? 'Catatan baru' : 'Ubah catatan'}</h2>
        <label>Kutipan dari bacaan<textarea data-f="quote" rows="4" placeholder="Tempel atau ketik kutipan (boleh kosong)">${esc(n.quote || '')}</textarea></label>
        <label>Insight saya<textarea data-f="note" rows="5" placeholder="Tulis pemikiran, ringkasan, atau pertanyaan Anda…">${esc(n.note || '')}</textarea></label>
        <p class="muted" style="margin:0;font-size:12.5px">${esc(n.where ? n.where + ' · ' : '')}${n.progress != null ? Math.round(n.progress * 100) + '%' : ''}</p>
        <div class="acts">${isNew ? '' : '<button class="btn danger" data-a="del" style="margin-right:auto">Hapus</button>'}<button class="btn" data-a="no">Batal</button><button class="btn primary" data-a="ok">Simpan</button></div></div>`;
      const q = $('[data-f="quote"]', d), t = $('[data-f="note"]', d);
      let done = false;
      const finish = v => { if (done) return; done = true; d.close(); resolve(v); };
      d.onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'ok') finish({ quote: q.value.trim(), note: t.value.trim() });
        else if (a === 'del') finish('del');
        else if (a === 'no' || e.target === d) finish(null);
      };
      d.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish({ quote: q.value.trim(), note: t.value.trim() }); } };
      d.oncancel = e => { e.preventDefault(); finish(null); };
      d.showModal();
      (n.quote && !n.note ? t : q.value ? t : q).focus();
    });
  }
  function save() { Reader.persist(); Reader.refreshPanel('notes'); mark(); }
  async function add(quote) {
    const book = Reader.book;
    if (!book || !Reader.view) return;
    const s = getSelection();
    const p = quote ? posOf(s?.anchorNode) : Reader.posRecord();
    const n = { id: uid(), quote: quote || '', note: '', pos: p, where: whereOf(p), progress: Reader.view.progress(), at: Date.now() };
    hideChip();
    const r = await editor(n, true);
    if (!r || (!r.quote && !r.note)) return;
    Object.assign(n, r);
    (book.notes = book.notes || []).push(n);
    book.notes.sort((a, b) => (a.progress - b.progress) || (a.at - b.at));
    s?.removeAllRanges();
    save();
    toast('Catatan disimpan');
  }
  async function edit(n) {
    const book = Reader.book || Shelf.books.find(b => b.notes?.includes(n));
    const r = await editor(n, false);
    if (!r) return;
    if (r === 'del') {
      if (!(await ask({ title: 'Hapus catatan?', body: '<p>Kutipan dan insight ini akan dihapus.</p>', ok: 'Hapus', danger: true }))) return;
      book.notes = book.notes.filter(x => x !== n);
    } else { Object.assign(n, r, { edited: Date.now() }); }
    save();
  }
  /* catatan dari tombol: dengan kutipan bila ada teks terpilih, kosong bila tidak */
  function fromSelection() { const t = selText(); if (t) add(t); else Reader.openPanel('notes'); }

  /* ---------- panel ---------- */
  function renderPanel(body) {
    const book = Reader.book;
    const list = book?.notes || [];
    body.innerHTML = `<div class="notes-tools"><button class="btn primary" data-n="new">${icon('plus')}Catatan baru</button>${list.length ? `<button class="btn" data-n="docx">${icon('download')}Word</button><button class="btn" data-n="copy">Salin semua</button>` : ''}</div>`;
    if (!list.length) body.insertAdjacentHTML('beforeend', '<p class="p-empty">Belum ada catatan. Blok teks saat membaca lalu tekan <b>Catat</b>, atau tekan tombol N. Kutipan tersimpan bersama insight Anda dan bisa diekspor ke Word.</p>');
    const ul = el('ul', { class: 'note-list' });
    for (const n of list) {
      const li = el('li');
      li.innerHTML = `<button class="go"><small>${esc(n.where || '')}${n.where ? ' · ' : ''}${Math.round((n.progress || 0) * 100)}% · ${esc(fmtAgo(n.at))}</small>${n.quote ? `<q>${esc(n.quote.length > 400 ? n.quote.slice(0, 400) + '…' : n.quote)}</q>` : ''}${n.note ? `<span class="ins">${esc(n.note)}</span>` : ''}</button><button class="icon-btn" data-e title="Ubah catatan" aria-label="Ubah catatan">${icon('more')}</button>`;
      $('.go', li).onclick = () => { Reader.jumpTo(n.pos); if (innerWidth < 900) Reader.closePanel(); };
      $('[data-e]', li).onclick = () => edit(n);
      ul.append(li);
    }
    body.append(ul);
    body.querySelector('[data-n="new"]').onclick = () => add('');
    const dx = body.querySelector('[data-n="docx"]'); if (dx) dx.onclick = () => exportDocx(book);
    const cp = body.querySelector('[data-n="copy"]'); if (cp) cp.onclick = () => copyAll(book);
  }

  /* ---------- sorotan kutipan di teks ---------- */
  function mark() {
    const v = Reader.view, d = Reader.doc, book = Reader.book;
    if (!v || !d || d.kind !== 'flow' || typeof Highlight === 'undefined' || !CSS.highlights) return;
    const mine = (book.notes || []).filter(n => n.quote && n.pos?.kind === 'flow' && n.pos.s === v.sec);
    if (!mine.length) { CSS.highlights.delete('rb-note'); return; }
    const map = v.textMap(), ranges = [];
    for (const n of mine) {
      // cocokkan awal & akhir kutipan saja: kutipan bisa beda sedikit (baris baru, nomor catatan kaki dibuang)
      const q = n.quote.replace(/\s+/g, ' ').trim();
      const lines = n.quote.split(/\n+/).map(x => x.trim()).filter(Boolean);
      const head = findAll(map.text, foldQuery(lines[0].slice(0, 40)), 50);
      if (!head.length) continue;
      const tail = foldQuery(lines[lines.length - 1].slice(-30));
      let best = null;
      for (const [a] of head) {
        const t = findAll(map.text.slice(a, a + q.length * 2 + 200), tail, 1)[0];
        if (t) { best = [a, a + t[1]]; break; }
      }
      best = best || [head[0][0], head[0][1]];
      ranges.push(v.rangeOf(map, best[0], best[1]));
    }
    if (ranges.length) CSS.highlights.set('rb-note', new Highlight(...ranges)); else CSS.highlights.delete('rb-note');
  }

  /* ---------- tombol kecil di atas teks yang diblok ---------- */
  function hideChip() { chip?.remove(); chip = null; }
  const onSel = debounce(() => {
    const t = selText();
    if (!t || !Reader.view || $('#dlg').open) { hideChip(); return; }
    const r = getSelection().getRangeAt(0).getBoundingClientRect(), st = $('#stage').getBoundingClientRect();
    if (!r.width && !r.height) { hideChip(); return; }
    if (!chip) {
      chip = el('div', { class: 'sel-chip', role: 'toolbar', 'aria-label': 'Teks terpilih' });
      chip.innerHTML = `<button data-c="note">${icon('note')}Catat</button><button data-c="tr">${icon('translate')}Terjemahkan</button><button data-c="copy">Salin</button>`;
      chip.addEventListener('pointerdown', e => e.preventDefault());
      chip.addEventListener('click', e => {
        const c = e.target.closest('[data-c]')?.dataset.c;
        if (c === 'note') add(chipSel);
        else if (c === 'tr') { hideChip(); Translate.open(); }
        else if (c === 'copy') { navigator.clipboard?.writeText(chipSel).then(() => toast('Teks disalin'), () => toast('Tekan Ctrl+C untuk menyalin', 'bad')); hideChip(); }
      });
      $('#stage').append(chip);
    }
    chipSel = t;
    const w = chip.offsetWidth, h = chip.offsetHeight;
    const above = r.top - st.top - h - 10;
    chip.style.left = clamp(r.left - st.left + r.width / 2 - w / 2, 8, st.width - w - 8) + 'px';
    chip.style.top = (above > 4 ? above : Math.min(r.bottom - st.top + 10, st.height - h - 8)) + 'px';
  }, 180);
  document.addEventListener('selectionchange', onSel);

  /* ---------- ekspor ---------- */
  function plain(book) {
    const lines = [`Catatan: ${book.title}`, book.author ? `Penulis: ${book.author}` : '', ''];
    (book.notes || []).forEach((n, i) => {
      lines.push(`${i + 1}. ${n.where ? n.where + ' · ' : ''}${Math.round((n.progress || 0) * 100)}%`);
      if (n.quote) lines.push(`“${n.quote}”`);
      if (n.note) lines.push(`Insight: ${n.note}`);
      lines.push('');
    });
    return lines.filter((l, i) => l || i > 2).join('\n').trim() + '\n';
  }
  async function copyAll(book) {
    try { await navigator.clipboard.writeText(plain(book)); toast('Semua catatan disalin'); }
    catch (e) { toast('Tidak bisa menyalin di sini; pakai ekspor Word.', 'bad'); }
  }
  const X = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const run = (t, rpr = '') => String(t).split(/\r?\n/).map((line, i) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${X(line)}</w:t></w:r>`).join('');
  const para = (content, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${content}</w:p>`;
  function docxBlob(book) {
    const now = new Date();
    const body = [
      para(run('Catatan Bacaan'), 'Title'),
      para(run(book.title) + (book.author ? run(' — ' + book.author) : ''), 'Subtitle'),
      para(run(`${book.notes.length} catatan · diekspor ${fmtDate(now)} dari Rak Baca`), 'Meta'),
    ];
    book.notes.forEach((n, i) => {
      body.push(para(run(`${i + 1}. ${n.where ? n.where + ' · ' : ''}${Math.round((n.progress || 0) * 100)}%`), 'Heading2'));
      if (n.quote) body.push(para(run('“' + n.quote + '”'), 'Quote'));
      if (n.note) body.push(para(run('Insight saya: ', '<w:b/><w:color w:val="8B3A2B"/>') + run(n.note)));
    });
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
      + st('Title', 'Title', '<w:spacing w:after="80"/>', '<w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/>')
      + st('Subtitle', 'Subtitle', '<w:spacing w:after="40"/>', '<w:i/><w:color w:val="404040"/><w:sz w:val="28"/><w:szCs w:val="28"/>')
      + st('Meta', 'Meta', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="CDC2AE"/></w:pBdr><w:spacing w:after="240"/>', '<w:color w:val="7B7166"/><w:sz w:val="18"/><w:szCs w:val="18"/>')
      + st('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="320" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:color w:val="8B3A2B"/><w:sz w:val="24"/><w:szCs w:val="24"/>')
      + st('Quote', 'Quote', '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="CDC2AE"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F7F2E8"/><w:ind w:left="284" w:right="284"/>', '<w:i/><w:color w:val="3D3229"/>')
      + `</w:styles>`;
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X('Catatan: ' + book.title)}</dc:title><dc:creator>Rak Baca</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
    return makeZip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/document.xml', doc],
      ['word/styles.xml', styles],
      ['docProps/core.xml', core],
    ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
  function exportDocx(book) {
    if (!book?.notes?.length) { toast('Belum ada catatan untuk diekspor.', 'bad'); return; }
    const name = ('Catatan - ' + book.title).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.docx';
    download(docxBlob(book), name);
    toast('Berkas Word dibuat: ' + name);
  }
  return { add, fromSelection, renderPanel, mark, exportDocx, copyAll, docxBlob, hideChip };
})();
