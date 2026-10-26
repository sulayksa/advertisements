/* التطبيق: استيراد الإكسل، قائمة الإعلانات، التعديل، التصدير */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- الحالة ---------- */
  const S = {
    ads: [], sel: null, filter: 'all', q: '',
    settings: { year: 1448, start: 675, font: 'Cairo', layout: {} },
    exp: { scope: 'checked', fmt: 'jpg', size: 2400, zip: true },
    source: '', tpl: null, tplUrl: 'assets/template.png',
    qr: (window.QR_DATA || []).map(x => ({ ...x, img: null, custom: false })),
  };
  let uid = 1;

  /* ---------- تخزين محلي (اختياري) ---------- */
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
  };
  const persist = () => { store.set('ads-v1', { ads: S.ads, source: S.source }); store.set('settings-v1', { settings: S.settings, exp: S.exp }); };

  /* ---------- تطبيع الأسماء ومطابقة الباركود ---------- */
  const DIG = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
  const latin = s => String(s ?? '').replace(/[٠-٩۰-۹]/g, d => DIG[d]);
  const nz = s => String(s ?? '').replace(/[ً-ٟـ‏‎]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['رضي', 'الله', 'عنه', 'عنها', 'بن', 'ابن', 'ال']);
  const toks = s => nz(s).split(' ').filter(t => t && !STOP.has(t));

  const qrIndex = () => {
    const m = new Map();
    S.qr.forEach(q => { m.set(nz(q.name), q); (q.aliases || []).forEach(a => m.set(nz(a), q)); });
    return m;
  };
  let QI = qrIndex();
  function matchQr(name) {
    const n = nz(name); if (!n || n === 'عن بعد') return null;
    if (QI.has(n)) return QI.get(n);
    const kind = n.split(' ')[0], t = new Set(toks(n)); if (!t.size) return null;
    let best = null, score = 0;
    for (const q of S.qr) {
      if (nz(q.name).split(' ')[0] !== kind) continue;
      const u = new Set(toks(q.name)); let i = 0; t.forEach(x => u.has(x) && i++);
      const sc = i / Math.max(t.size, u.size);
      if (sc > score) { score = sc; best = q; }
    }
    return score >= 0.67 ? best : null;
  }
  const qrFor = ad => {
    if (ad.remote) return null;
    if (ad.qr) return S.qr.find(q => q.name === ad.qr) || null;
    return matchQr(ad.mosque);
  };
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  async function qrImage(q) { if (!q) return null; if (!q.img) q.img = await loadImg(q.file).catch(() => null); return q.img; }

  /* ---------- قراءة الملف ---------- */
  const HEAD = {
    day: ['اليوم'], date: ['التاريخ'], time: ['الوقت'], mosque: ['المسجد', 'الجامع', 'المسجد/الجامع'],
    dist: ['الحي'], speaker: ['اسم الداعية', 'الداعية', 'الاسم', 'الداعيه'], title: ['عنوان المحاضرة', 'العنوان', 'عنوان'],
    fasah: ['رقم الفسح', 'الفسح'], num: ['رقم الاعلان', 'رقم العدد', 'رقم الحاضر', 'رقم'], qr: ['الباركود'],
  };
  const hnorm = s => nz(s).replace(/[\s/\\_()-]+/g, ' ').trim();
  function mapHeader(row) {
    const col = {};
    row.forEach((h, i) => {
      if (h == null) return; const n = hnorm(h);
      for (const [k, names] of Object.entries(HEAD)) {
        if (col[k] != null) continue;
        if (names.some(x => hnorm(x) === n) || (k === 'mosque' && n.includes('المسجد')) || (k === 'fasah' && n.includes('الفسح')) || (k === 'title' && n.startsWith('عنوان'))) { col[k] = i; break; }
      }
    });
    return col;
  }
  const DAYFIX = { 'الاحد': 'الأحد', 'الاربعاء': 'الأربعاء', 'الاثنين': 'الاثنين', 'الإثنين': 'الاثنين' };
  const normDay = d => { d = String(d ?? '').trim(); const k = nz(d); return DAYFIX[k] || (k === 'الاحد' ? 'الأحد' : d); };
  function fmtTime(v) {
    if (typeof v === 'number') {
      let mins = Math.round((v % 1) * 1440), h = Math.floor(mins / 60), m = mins % 60;
      const pm = h >= 12; h = h % 12 || 12;
      return `${h}:${String(m).padStart(2, '0')} ${pm || h < 6 ? 'م' : 'ص'}`;
    }
    return String(v ?? '').trim();
  }
  function parseDate(v, defY) {
    const p = latin(v).split(/[\/\-.\s]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
    if (p.length >= 3) return p[0] > 31 ? { y: p[0], m: p[1], d: p[2] } : { y: p[2], m: p[1], d: p[0] };
    if (p.length === 2) return { y: defY, m: p[1], d: p[0] };
    return { y: defY, m: '', d: '' };
  }
  function parseRows(rows, sheetName) {
    let hi = rows.findIndex(r => r && r.some(c => nz(c) === 'اليوم') && r.some(c => nz(c).includes('التاريخ')));
    if (hi < 0) return [];
    const c = mapHeader(rows[hi]); const out = [];
    const get = (r, k) => c[k] == null ? '' : r[c[k]];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r || !r.some(x => x != null && String(x).trim() !== '')) continue;
      const dateV = get(r, 'date'); if (dateV === '' || dateV == null) continue;
      const remote = c.mosque == null || /عن بعد/.test(String(get(r, 'mosque')));
      const dt = parseDate(dateV, S.settings.year);
      let fasah = get(r, 'fasah'); fasah = typeof fasah === 'number' ? String(Math.round(fasah)) : String(fasah ?? '').trim();
      const numV = get(r, 'num');
      out.push({
        id: uid++, num: numV === '' || numV == null ? '' : String(latin(numV)).trim(), numAuto: !numV,
        day: normDay(get(r, 'day')), ...dt, time: fmtTime(get(r, 'time')),
        mosque: remote ? 'عن بعد' : String(get(r, 'mosque') ?? '').trim(),
        dist: String(get(r, 'dist') ?? '').trim(), remote,
        speaker: String(get(r, 'speaker') ?? '').trim(), title: String(get(r, 'title') ?? '').replace(/\s+/g, ' ').trim(), fasah,
        qr: String(get(r, 'qr') ?? '').trim() && S.qr.some(q => q.name === String(get(r, 'qr')).trim()) ? String(get(r, 'qr')).trim() : '',
        sheet: sheetName, on: true,
      });
    }
    return out;
  }
  async function importFile(file) {
    try {
      let sheets;
      if (/\.csv$/i.test(file.name)) sheets = [{ name: file.name, rows: Lib.readCsv(await file.text()) }];
      else sheets = await Lib.readXlsx(await file.arrayBuffer());
      let ads = [];
      sheets.forEach(sh => ads.push(...parseRows(sh.rows, sh.name)));
      if (!ads.length) return toast('لم أجد جدولاً بأعمدة «اليوم» و«التاريخ» في الملف');
      ads.forEach(a => a.on = isComplete(a));
      S.ads = ads; S.source = file.name; S.sel = (ads.find(isComplete) || ads[0]).id;
      autoNumber(); persist(); refreshAll();
      const inc = ads.filter(a => !isComplete(a)).length, nq = ads.filter(a => status(a) === 'noqr').length;
      toast(`تم استيراد ${ads.length} إعلان` + (inc ? ` — ${inc} ناقص` : '') + (nq ? ` — ${nq} بدون باركود` : ''));
      $('#app').dataset.view = 'stage';
    } catch (e) { console.error(e); toast('تعذّرت قراءة الملف: ' + e.message); }
  }

  /* ---------- حالة الإعلان ---------- */
  const isComplete = a => !!(a.speaker && a.title);
  const status = a => !isComplete(a) ? 'incomplete' : (!a.remote && !qrFor(a) ? 'noqr' : 'ok');
  function autoNumber() {
    let n = +S.settings.start || 1;
    S.ads.forEach(a => { if (a.numAuto || a.num === '') { if (isComplete(a)) { a.num = String(n++); a.numAuto = true; } else a.num = ''; } else n = Math.max(n, (+a.num || 0) + 1); });
  }
  function renumberAll() {
    let n = +S.settings.start || 1;
    S.ads.forEach(a => { if (isComplete(a)) { a.num = String(n++); a.numAuto = true; } else a.num = ''; });
  }
  const cur = () => S.ads.find(a => a.id === S.sel);

  /* ---------- القائمة ---------- */
  const visible = () => {
    const q = nz(S.q);
    return S.ads.filter(a => {
      if (S.filter === 'noqr' && status(a) !== 'noqr') return false;
      if (S.filter === 'incomplete' && status(a) !== 'incomplete') return false;
      if (q && !nz([a.mosque, a.speaker, a.title, a.day, a.dist, `${a.y}/${a.m}/${a.d}`].join(' ')).includes(q)) return false;
      return true;
    });
  };
  function renderList() {
    const list = visible(), ul = $('#items');
    $('#cAll').textContent = S.ads.length;
    $('#cNoqr').textContent = S.ads.filter(a => status(a) === 'noqr').length;
    $('#cInc').textContent = S.ads.filter(a => status(a) === 'incomplete').length;
    $$('#chips .chip').forEach(c => c.classList.toggle('on', c.dataset.f === S.filter));
    if (!list.length) { ul.innerHTML = `<li class="none">${S.ads.length ? 'لا توجد نتائج' : ''}</li>`; }
    else ul.innerHTML = list.map(a => {
      const st = status(a);
      const badge = st === 'incomplete' ? '<span class="badge bad">ناقص</span>' : st === 'noqr' ? '<span class="badge warn">بدون باركود</span>' : '';
      return `<li class="item${a.id === S.sel ? ' sel' : ''}" data-id="${a.id}">
        <input type="checkbox" ${a.on ? 'checked' : ''} data-chk="${a.id}" aria-label="تحديد">
        <div>
          <div class="l1"><span class="mosque">${esc(a.mosque || '—')}${badge}</span><span class="when">${esc(a.day)} ${esc(a.d)}/${esc(a.m)}</span></div>
          <div class="l2">${esc(a.speaker || 'بدون داعية')} · ${esc(a.time)}</div>
          <div class="l3">${esc(a.title || '—')}</div>
        </div></li>`;
    }).join('');
    const checked = S.ads.filter(a => a.on).length;
    $('#checkAll').checked = S.ads.length > 0 && checked === S.ads.length;
    $('#checkAll').indeterminate = checked > 0 && checked < S.ads.length;
    $('#subtitle').textContent = S.ads.length ? `${S.source} · ${S.ads.length} إعلان` : 'لم يُستورد ملف بعد';
  }
  function patchItem(a) {
    const li = $(`.item[data-id="${a.id}"]`); if (!li) return;
    const tmp = document.createElement('ul'); const keep = S.sel;
    renderList(); const sel = $('.item.sel'); sel && sel.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- النموذج ---------- */
  const F = {
    num: $('#fNum'), time: $('#fTime'), day: $('#fDay'), y: $('#fY'), m: $('#fM'), d: $('#fD'),
    mosque: $('#fMosque'), speaker: $('#fSpeaker'), title: $('#fTitle'), fasah: $('#fFasah'),
  };
  F.m.innerHTML = '<option value="">—</option>' + Render.MONTHS.slice(1).map((n, i) => `<option value="${i + 1}">${i + 1} · ${n}</option>`).join('');
  function buildMosqueSelect() {
    const jam = S.qr.filter(q => q.name.startsWith('جامع')), mas = S.qr.filter(q => !q.name.startsWith('جامع'));
    const opt = q => `<option value="${esc(q.name)}">${esc(q.name)}</option>`;
    F.mosque.innerHTML = '<option value="">— بدون باركود —</option><option value="__remote">عن بعد</option>' +
      `<optgroup label="جوامع">${jam.sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(opt).join('')}</optgroup>` +
      `<optgroup label="مساجد">${mas.sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(opt).join('')}</optgroup>`;
  }
  function fillForm() {
    const a = cur(); const dis = !a;
    Object.values(F).forEach(el => el.disabled = dis);
    $('#btnDup').disabled = $('#btnDel').disabled = dis;
    if (!a) { Object.values(F).forEach(el => el.value = ''); $('#mosqueHint').textContent = ''; return; }
    F.num.value = a.num; F.time.value = a.time; F.day.value = a.day;
    if (a.day && ![...F.day.options].some(o => o.value === a.day)) F.day.add(new Option(a.day, a.day));
    F.day.value = a.day; F.y.value = a.y; F.m.value = a.m; F.d.value = a.d;
    const q = qrFor(a); F.mosque.value = a.remote ? '__remote' : (q ? q.name : '');
    F.speaker.value = a.speaker; F.title.value = a.title; F.fasah.value = a.fasah; $('#tsVal').textContent = Math.round((+a.ts || 1) * 100) + '%';
    const h = $('#mosqueHint');
    if (!a.remote && !q) { h.textContent = a.mosque ? `«${a.mosque}» من الملف — لا يوجد له باركود، اختر المسجد من القائمة.` : 'اختر المسجد ليظهر الباركود.'; h.className = 'hint warn'; }
    else if (a.mosque && q && nz(a.mosque) !== nz(q.name)) { h.textContent = `في الملف: «${a.mosque}»`; h.className = 'hint'; }
    else { h.textContent = ''; h.className = 'hint'; }
  }
  let drawQueued = false;
  const queueDraw = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawPreview(); }); } };
  function bind(el, apply) {
    el.addEventListener('input', () => { const a = cur(); if (!a) return; apply(a, el.value); persist(); queueDraw(); patchItem(a); });
  }
  bind(F.num, (a, v) => { a.num = latin(v).trim(); a.numAuto = false; });
  bind(F.time, (a, v) => a.time = v);
  bind(F.day, (a, v) => a.day = v);
  bind(F.y, (a, v) => a.y = latin(v).trim());
  bind(F.m, (a, v) => a.m = v);
  bind(F.d, (a, v) => a.d = latin(v).trim());
  bind(F.speaker, (a, v) => a.speaker = v);
  bind(F.title, (a, v) => a.title = v);
  bind(F.fasah, (a, v) => a.fasah = latin(v));
  F.mosque.addEventListener('change', () => {
    const a = cur(); if (!a) return;
    if (F.mosque.value === '__remote') { a.remote = true; a.qr = ''; a.mosque = 'عن بعد'; }
    else { a.remote = false; a.qr = F.mosque.value; if (F.mosque.value) a.mosque = F.mosque.value; }
    persist(); fillForm(); queueDraw(); renderList();
  });

  /* ---------- المعاينة ---------- */
  const cv = $('#cv'); const ctx = cv.getContext('2d');
  let fontReady = null;
  function ensureFont() {
    const fams = new Set([S.settings.font, ...Object.values(S.settings.layout || {}).map(x => x.f).filter(Boolean)]);
    return Promise.race([
      Promise.all([...fams].map(f => document.fonts.load(`${(Render.FONTS.find(x => x.name === f) || { w: 800 }).w} 40px "${f}"`, 'محاضرة الأربعاء 0123456789').catch(() => { }))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  }
  async function loadTemplate(url) { S.tpl = await loadImg(url); }
  async function drawPreview() {
    const a = cur(); if (!S.tpl) return;
    const box = $('#stageInner'); const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cssH = box.clientHeight - 30, cssW = Math.min(box.clientWidth - 30, cssH * 0.75);
    const W = Math.max(300, Math.round(Math.min(cssW, 900) * dpr));
    const H = Math.round(W * S.tpl.naturalHeight / S.tpl.naturalWidth);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    await ensureFont();
    const ad = a || { m: 4, y: '', d: '', num: '' };
    const img = a ? await qrImage(qrFor(a)) : null;
    Render.draw(ctx, W, S.tpl, img, ad, { font: S.settings.font, layout: S.settings.layout });
    updatePos();
  }
  function updatePos() {
    const list = visible(), i = list.findIndex(a => a.id === S.sel);
    $('#pos').textContent = list.length ? `${i + 1} من ${list.length}` : '—';
  }
  function go(d) {
    const list = visible(); if (!list.length) return;
    let i = list.findIndex(a => a.id === S.sel); i = Math.min(list.length - 1, Math.max(0, i + d));
    select(list[i].id, true);
  }
  function select(id, scroll) {
    S.sel = id; renderList(); fillForm(); queueDraw();
    if (scroll) { const el = $('.item.sel'); el && el.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---------- التصدير ---------- */
  const safe = s => String(s).replace(/[\\/:*?"<>|‏‎]/g, '').replace(/\s+/g, '_').slice(0, 60);
  const fname = (a, ext) => `${a.num || a.id}_${safe(a.mosque)}_${a.y}-${a.m}-${a.d}.${ext}`;
  const off = document.createElement('canvas');
  async function renderBlob(a, width, type) {
    await ensureFont();
    const H = Math.round(width * S.tpl.naturalHeight / S.tpl.naturalWidth);
    off.width = width; off.height = H;
    const c = off.getContext('2d');
    Render.draw(c, width, S.tpl, await qrImage(qrFor(a)), a, { font: S.settings.font, layout: S.settings.layout });
    const mime = type === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(r => off.toBlob(r, mime, 0.93));
    return { blob, w: width, h: H };
  }
  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob); const l = document.createElement('a');
    l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(() => URL.revokeObjectURL(u), 15000);
  }
  async function exportOne(share) {
    const a = cur(); if (!a) return;
    const fmt = S.exp.fmt === 'pdf' ? 'jpg' : S.exp.fmt;
    const { blob } = await renderBlob(a, +S.exp.size, fmt);
    const name = fname(a, fmt);
    if (share) {
      const file = new File([blob], name, { type: blob.type });
      try { await navigator.share({ files: [file], title: name }); } catch { }
    } else saveBlob(blob, name);
  }
  let cancelExport = false;
  async function exportMany() {
    let list = S.exp.scope === 'all' ? S.ads.filter(isComplete) : S.exp.scope === 'one' ? [cur()].filter(Boolean) : S.ads.filter(a => a.on);
    const skipped = list.filter(a => !isComplete(a)).length;
    list = list.filter(isComplete);
    if (!list.length) return toast('لا توجد إعلانات مكتملة للتصدير');
    const prog = $('#prog'), bar = $('#progBar'), txt = $('#progTxt'), go = $('#btnGo');
    prog.hidden = false; go.textContent = 'إيقاف'; cancelExport = false;
    go.onclick = () => { cancelExport = true; };
    const fmt = S.exp.fmt, W = +S.exp.size, files = [], pages = [];
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancelExport) throw new Error('cancel');
        txt.textContent = `${i + 1} / ${list.length}`; bar.style.width = (i / list.length * 100) + '%';
        await new Promise(r => setTimeout(r, 0));
        const a = list[i];
        const { blob, w, h } = await renderBlob(a, W, fmt === 'png' ? 'png' : 'jpg');
        const data = new Uint8Array(await blob.arrayBuffer());
        if (fmt === 'pdf') pages.push({ jpeg: data, w, h });
        else if (S.exp.zip && list.length > 1) files.push({ name: fname(a, fmt), data });
        else saveBlob(blob, fname(a, fmt));
      }
      bar.style.width = '100%';
      const stamp = new Date().toISOString().slice(0, 10);
      if (fmt === 'pdf') saveBlob(Lib.makePdf(pages), `إعلانات_${stamp}.pdf`);
      else if (files.length) saveBlob(Lib.makeZip(files), `إعلانات_${stamp}.zip`);
      toast(`تم تصدير ${list.length} إعلان` + (skipped ? ` (تجاوزت ${skipped} ناقص)` : ''));
      $('#dlgExport').close();
    } catch (e) { if (e.message !== 'cancel') { console.error(e); toast('تعذّر التصدير: ' + e.message); } else toast('أُوقف التصدير'); }
    finally { prog.hidden = true; go.textContent = 'ابدأ التصدير'; go.onclick = exportMany; bar.style.width = '0'; }
  }
  function updateExportInfo() {
    const n = S.exp.scope === 'all' ? S.ads.filter(isComplete).length : S.exp.scope === 'one' ? 1 : S.ads.filter(a => a.on && isComplete(a)).length;
    const W = +S.exp.size, H = Math.round(W * 4525 / 3394);
    const noqr = (S.exp.scope === 'one' ? [cur()].filter(Boolean) : S.ads.filter(a => (S.exp.scope === 'all' || a.on) && isComplete(a))).filter(a => status(a) === 'noqr').length;
    $('#xInfo').textContent = `${n} إعلان · ${W}×${H} بكسل` + (noqr ? ` · تنبيه: ${noqr} بدون باركود` : '');
    $('#xZip').disabled = S.exp.fmt === 'pdf';
  }
  function seg(id, key, parse) {
    const root = $(id);
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S.exp[key] = parse ? parse(b.dataset.v) : b.dataset.v; syncSeg(); updateExportInfo(); persist();
    });
  }
  function syncSeg() {
    [['#xScope', 'scope'], ['#xFmt', 'fmt'], ['#xSize', 'size']].forEach(([id, k]) => $$(id + ' button').forEach(b => b.classList.toggle('on', String(S.exp[k]) === b.dataset.v)));
    $('#xZip').checked = S.exp.zip;
  }
  seg('#xScope', 'scope'); seg('#xFmt', 'fmt'); seg('#xSize', 'size', Number);
  $('#xZip').addEventListener('change', e => { S.exp.zip = e.target.checked; persist(); });

  /* ---------- أحداث الواجهة ---------- */
  function refreshAll() { renderList(); fillForm(); queueDraw(); $('#app').classList.toggle('has-no-data', !S.ads.length); }
  $('#items').addEventListener('click', e => {
    const chk = e.target.closest('[data-chk]');
    if (chk) { const a = S.ads.find(x => x.id == chk.dataset.chk); a.on = chk.checked; persist(); renderList(); return; }
    const li = e.target.closest('.item'); if (!li) return;
    select(+li.dataset.id);
    if (matchMedia('(max-width:1099px)').matches) $('#app').dataset.view = 'stage';
  });
  $('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); updatePos(); });
  $('#chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; S.filter = c.dataset.f; renderList(); updatePos(); });
  $('#checkAll').addEventListener('change', e => { visible().forEach(a => a.on = e.target.checked); persist(); renderList(); });
  $('#prev').addEventListener('click', () => go(-1));
  $('#next').addEventListener('click', () => go(1));
  $('#btnOne').addEventListener('click', () => exportOne(false));
  $('#btnShare').addEventListener('click', () => exportOne(true));
  $('#btnToEdit').addEventListener('click', () => $('#app').dataset.view = 'edit');
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('#app').dataset.view = b.dataset.v; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); queueDraw(); });
  new MutationObserver(() => { $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.v === $('#app').dataset.view)); queueDraw(); }).observe($('#app'), { attributes: true, attributeFilter: ['data-view'] });
  new ResizeObserver(() => queueDraw()).observe($('#stageInner'));
  if (navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })) $('#btnShare').hidden = false;

  $('#btnDup').addEventListener('click', () => {
    const a = cur(); if (!a) return; const i = S.ads.indexOf(a);
    const c = { ...a, id: uid++, numAuto: true }; S.ads.splice(i + 1, 0, c); S.sel = c.id; renumberKeep(); persist(); refreshAll(); toast('تم تكرار الإعلان');
  });
  $('#btnDel').addEventListener('click', () => {
    const a = cur(); if (!a || !confirm('حذف هذا الإعلان من القائمة؟')) return;
    const i = S.ads.indexOf(a); S.ads.splice(i, 1); S.sel = (S.ads[i] || S.ads[i - 1] || {}).id ?? null; persist(); refreshAll();
  });
  $('#btnAdd').addEventListener('click', () => {
    const base = cur();
    const a = { id: uid++, num: '', numAuto: true, day: '', y: S.settings.year, m: base ? base.m : '', d: '', time: base ? base.time : 'المغرب', mosque: '', dist: '', remote: false, speaker: '', title: '', fasah: '', qr: '', sheet: '', on: false };
    S.ads.push(a); S.sel = a.id; persist(); refreshAll(); $('#app').dataset.view = 'edit'; F.speaker.focus();
  });
  function renumberKeep() { /* يبقي الأرقام المعدّلة يدوياً ويرقّم الباقي */ let n = +S.settings.start || 1; S.ads.forEach(a => { if (a.numAuto) { if (isComplete(a)) a.num = String(n++); else a.num = ''; } else n = Math.max(n, (+a.num || 0) + 1); }); }

  /* الاستيراد والسحب والإفلات */
  const fileIn = $('#file');
  $('#btnImport').addEventListener('click', () => fileIn.click());
  $('#btnPick').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) importFile(fileIn.files[0]); fileIn.value = ''; });
  let dragN = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragN++; $('#veil').classList.add('show'); } });
  addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#veil').classList.remove('show'); });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#veil').classList.remove('show'); const f = e.dataTransfer.files[0]; if (f) importFile(f); });

  /* الإعدادات */
  const dlgS = $('#dlgSettings');
  $('#btnSettings').addEventListener('click', () => { $('#sYear').value = S.settings.year; $('#sStart').value = S.settings.start; dlgS.showModal(); });
  $('#sYear').addEventListener('input', e => { S.settings.year = +latin(e.target.value) || S.settings.year; persist(); });
  $('#sStart').addEventListener('input', e => { S.settings.start = +latin(e.target.value) || 1; persist(); });
  $('#btnRenumber').addEventListener('click', () => { renumberAll(); persist(); refreshAll(); toast('أُعيد الترقيم'); });
  $('#btnFont').addEventListener('click', () => $('#fontFile').click());
  $('#fontFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const name = 'مخصص ' + f.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(name, await f.arrayBuffer(), { weight: '100 900' }); await face.load(); document.fonts.add(face);
      Render.FONTS.push({ name, w: 700, label: name }); S.settings.font = name; fillFontSelects(); queueDraw(); toast('تم تحميل الخط');
    } catch { toast('تعذّر قراءة الخط'); } e.target.value = '';
  });
  $('#btnTpl').addEventListener('click', () => $('#tplFile').click());
  $('#tplFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    S.tpl = await loadImg(URL.createObjectURL(f)); queueDraw(); toast('تم استبدال القالب (يجب أن يطابق تخطيط القالب الأصلي)'); e.target.value = '';
  });
  $('#btnQr').addEventListener('click', () => $('#qrFiles').click());
  $('#qrFiles').addEventListener('change', async e => {
    let n = 0;
    for (const f of e.target.files) {
      const name = f.name.replace(/\.[^.]+$/, '').normalize('NFC').trim();
      const url = URL.createObjectURL(f); const ex = S.qr.find(q => nz(q.name) === nz(name));
      if (ex) { ex.file = url; ex.img = null; } else S.qr.push({ name, file: url, aliases: [], img: null, custom: true }); n++;
    }
    QI = qrIndex(); buildMosqueSelect(); refreshAll(); toast(`أُضيف ${n} باركود (للجلسة الحالية؛ للدوام ضعها في assets/qr وحدّث data/qr.js)`); e.target.value = '';
  });
  $('#btnCsv').addEventListener('click', () => {
    const rows = [['رقم الإعلان', 'اليوم', 'التاريخ', 'الوقت', 'المسجد', 'الحي', 'الداعية', 'العنوان', 'رقم الفسح'],
      ...S.ads.map(a => [a.num, a.day, `${a.y}/${a.m}/${a.d}`, a.time, a.remote ? 'عن بعد' : (qrFor(a)?.name || a.mosque), a.dist, a.speaker, a.title, a.fasah])];
    saveBlob(new Blob([Lib.toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'بيانات_الإعلانات.csv');
  });
  $('#btnClear').addEventListener('click', () => { if (confirm('مسح البيانات المحفوظة في هذا المتصفح؟')) { store.del('ads-v1'); S.ads = []; S.sel = null; S.source = ''; refreshAll(); dlgS.close(); } });

  /* التصدير */
  $('#btnExport').addEventListener('click', () => {
    if (!S.ads.length) return toast('استورد ملفاً أولاً');
    syncSeg(); updateExportInfo(); $('#btnGo').onclick = exportMany; $('#dlgExport').showModal();
  });
  $('#btnGo').onclick = exportMany;

  /* تعديل جماعي */
  $('#btnBulk').addEventListener('click', () => { $('#bulkN').textContent = S.ads.filter(a => a.on).length; $('#dlgBulk').showModal(); });
  $('#bField').addEventListener('change', e => { $('#bValue').placeholder = e.target.value === 'time' ? 'مثال: العشاء' : ''; });
  $('#btnBulkGo').addEventListener('click', () => {
    const f = $('#bField').value, v = $('#bValue').value.trim(); const sel = S.ads.filter(a => a.on);
    if (!v || !sel.length) return toast('اكتب القيمة وحدّد إعلانات');
    if (f === 'time') sel.forEach(a => a.time = v);
    else if (f === 'y') sel.forEach(a => a.y = latin(v));
    else if (f === 'm') sel.forEach(a => a.m = latin(v));
    else if (f === 'mnum') { let n = +latin(v); sel.forEach(a => { a.num = String(n++); a.numAuto = false; }); }
    persist(); refreshAll(); $('#dlgBulk').close(); toast(`تم التعديل على ${sel.length} إعلان`);
  });

  /* اختصارات لوحة المفاتيح (ماك بوك) */
  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select') || document.querySelector('dialog[open]')) return;
    if (!$('#tune').hidden) {
      const st = e.shiftKey ? 10 : 2; const k = e.key;
      if (k === 'ArrowLeft') nudge(-st, 0); else if (k === 'ArrowRight') nudge(st, 0); else if (k === 'ArrowUp') nudge(0, -st); else if (k === 'ArrowDown') nudge(0, st);
      else if (k === '+' || k === '=') resize(0.05); else if (k === '-' || k === '_') resize(-0.05); else return;
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); go(-1); }
  });


  /* ---------- لوحة التخصيص ---------- */
  const L = () => S.settings.layout || (S.settings.layout = {});
  const elKey = () => $('#tEl').value;
  const elAdj = () => (L()[elKey()] ||= { dx: 0, dy: 0, s: 1, f: '' });
  function fillFontSelects() {
    const opts = Render.FONTS.map(f => `<option value="${esc(f.name)}">${esc(f.label || f.name)}</option>`).join('');
    $('#gFont').innerHTML = opts; $('#gFont').value = S.settings.font;
    $('#tFont').innerHTML = '<option value="">نفس الخط العام</option>' + opts;
    if (!$('#tEl').options.length) $('#tEl').innerHTML = Render.ELEMENTS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    syncTune();
  }
  function syncTune() {
    const a = L()[elKey()] || { dx: 0, dy: 0, s: 1, f: '' };
    $('#tSize').textContent = Math.round((a.s || 1) * 100) + '%';
    $('#tPos').textContent = `↔ ${Math.round(a.dx || 0)}   ·   ↕ ${Math.round(a.dy || 0)}`;
    $('#tFont').value = a.f || ''; $('#tFontRow').hidden = elKey() === 'qr';
  }
  function tuneChanged() { persist(); syncTune(); queueDraw(); }
  function nudge(dx, dy) { const a = elAdj(); a.dx = (a.dx || 0) + dx; a.dy = (a.dy || 0) + dy; tuneChanged(); }
  function resize(d) { const a = elAdj(); a.s = Math.max(0.3, Math.min(3, Math.round(((a.s || 1) + d) * 100) / 100)); tuneChanged(); }
  function holdRepeat(btn, fn) {
    let t, iv;
    const stop = () => { clearTimeout(t); clearInterval(iv); };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); fn(); t = setTimeout(() => { iv = setInterval(fn, 60); }, 350); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
  }
  $$('.dpad button').forEach(b => { const [x, y] = b.dataset.m.split(',').map(Number); holdRepeat(b, () => nudge(x * 2, y * 2)); });
  holdRepeat($('#tMinus'), () => resize(-0.02)); holdRepeat($('#tPlus'), () => resize(0.02));
  $('#tEl').addEventListener('change', syncTune);
  $('#tFont').addEventListener('change', e => { elAdj().f = e.target.value; tuneChanged(); });
  $('#gFont').addEventListener('change', e => { S.settings.font = e.target.value; persist(); queueDraw(); });
  $('#tReset').addEventListener('click', () => { delete L()[elKey()]; tuneChanged(); });
  $('#tResetAll').addEventListener('click', () => { if (confirm('إعادة كل المواضع والأحجام والخطوط الخاصة إلى الأصل؟')) { S.settings.layout = {}; tuneChanged(); } });
  const setTune = on => { $('#tune').hidden = !on; $('#app').classList.toggle('sheet-open', on && matchMedia('(max-width:1099px)').matches); if (on && matchMedia('(max-width:1099px)').matches) $('#app').dataset.view = 'stage'; queueDraw(); };
  $('#btnTune').addEventListener('click', () => setTune($('#tune').hidden));
  $('#tuneClose').addEventListener('click', () => setTune(false));
  /* حجم عنوان الإعلان الحالي فقط */
  const tsStep = d => { const a = cur(); if (!a) return; a.ts = Math.max(0.4, Math.min(2, Math.round(((+a.ts || 1) + d) * 100) / 100)); $('#tsVal').textContent = Math.round(a.ts * 100) + '%'; persist(); queueDraw(); };
  holdRepeat($('#tsMinus'), () => tsStep(-0.02)); holdRepeat($('#tsPlus'), () => tsStep(0.02));
  $('#tsReset').addEventListener('click', () => { const a = cur(); if (a) { a.ts = 1; $('#tsVal').textContent = '100%'; persist(); queueDraw(); } });

  let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3800); }
  window.__app = { S, importFile, drawPreview, status, qrFor, select, exportMany };

  /* ---------- البدء ---------- */
  (async () => {
    buildMosqueSelect();
    const sv = store.get('settings-v1'); if (sv) { S.settings = { ...S.settings, ...sv.settings }; S.exp = { ...S.exp, ...sv.exp }; }
    if (!Render.FONTS.some(f => f.name === S.settings.font)) S.settings.font = 'Cairo';
    const saved = store.get('ads-v1');
    if (saved?.ads?.length) {
      S.ads = saved.ads; S.source = saved.source || '';
      uid = Math.max(...S.ads.map(a => a.id)) + 1; S.sel = (S.ads.find(isComplete) || S.ads[0]).id;
    }
    fillFontSelects();
    refreshAll();
    await loadTemplate(S.tplUrl);
    queueDraw();
  })();
})();
