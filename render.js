/* رسم الإعلان فوق القالب. كل الإحداثيات مبنية على عرض 1500 وتُضرب في المقياس */
const Render = (() => {
  const BASE_W = 1500;
  const COLORS = { ink: '#14503a', white: '#ffffff' };
  const MONTHS = ['', 'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

  // الخطوط المتاحة ووزن الخط الأنسب لكل خط
  const FONTS = [
    { name: 'Cairo', w: 800, label: 'Cairo — كايرو' },
    { name: 'Tajawal', w: 800, label: 'Tajawal — تجوّل' },
    { name: 'Almarai', w: 800, label: 'Almarai — المراعي' },
    { name: 'Noto Kufi Arabic', w: 800, label: 'Noto Kufi — كوفي' },
    { name: 'Changa', w: 800, label: 'Changa — جنجا' },
    { name: 'Readex Pro', w: 700, label: 'Readex Pro' },
    { name: 'IBM Plex Sans Arabic', w: 700, label: 'IBM Plex Arabic' },
    { name: 'El Messiri', w: 700, label: 'El Messiri — المسيري' },
    { name: 'Rubik', w: 800, label: 'Rubik' },
    { name: 'Mada', w: 900, label: 'Mada — مدى' },
    { name: 'Reem Kufi', w: 700, label: 'Reem Kufi — ريم كوفي' },
    { name: 'Amiri', w: 700, label: 'Amiri — أميري (نسخ)' },
    { name: 'Harmattan', w: 700, label: 'Harmattan' },
    { name: 'Markazi Text', w: 700, label: 'Markazi — مركزي' },
    { name: 'Aref Ruqaa', w: 700, label: 'Aref Ruqaa — رقعة' },
    { name: 'Lalezar', w: 400, label: 'Lalezar — لاله‌زار' },
  ];
  const weightOf = fam => (FONTS.find(f => f.name === fam) || { w: 800 }).w;

  // عناصر التصميم القابلة للتعديل (الأسماء تظهر في لوحة التخصيص)
  const ELEMENTS = [
    ['month', 'الشهر'], ['num', 'رقم الإعلان'], ['label', 'كلمة «محاضرة»'], ['title', 'عنوان المحاضرة'], ['fasah', 'رقم الفسح'],
    ['speaker', 'اسم الداعية'], ['day', 'اليوم'], ['date', 'التاريخ'], ['time', 'الوقت'], ['qr', 'الباركود'],
  ];

  const POS = {
    monthPill: { x: 1180.5, y: 65.9, h: 63.6 },
    month:   { right: 1488, cy: 98, size: 50 },
    num:     { cx: 1308, cy: 182, maxW: 120, size: 58 },
    label:   { cx: 756, size: 44 },
    title:   { cx: 756, lastCy: 945, maxW: 1180, size: 80, min: 48, maxLines: 3 },
    fasah:   { cx: 756, cy: 1043, size: 34, maxW: 1100 },
    speaker: { cx: 757, cy: 1296, size: 70, min: 40, maxW: 640 },
    day:     { cx: 1162, cy: 1620, size: 62, maxW: 380 },
    date:    { cx: 1162, cy: 1707, size: 60, maxW: 380 },
    time:    { cx: 750, cy: 1676, size: 66, min: 40, maxW: 370 },
    qr:      { cx: 321, cy: 1672, size: 238 },
  };

  // نصف عرض القوس عند ارتفاع معيّن (تقدير من القالب) لمنع ملامسة الحواف
  const ARCH = [[540, 120], [650, 355], [800, 580], [950, 720], [1010, 750]];
  const archHalf = y => {
    if (y <= ARCH[0][0]) return ARCH[0][1];
    for (let i = 1; i < ARCH.length; i++) if (y <= ARCH[i][0]) { const [y0, w0] = ARCH[i - 1], [y1, w1] = ARCH[i]; return w0 + (w1 - w0) * (y - y0) / (y1 - y0); }
    return 750;
  };

  const font = (s, fam, w) => `${w || weightOf(fam)} ${s}px "${fam}", "Cairo", "Tajawal", "Noto Naskh Arabic", system-ui, sans-serif`;

  function splitBalanced(ctx, words, L) {
    if (L === 1 || words.length <= 1) return [words.join(' ')];
    const w = s => ctx.measureText(s).width; let best = null, bestW = Infinity;
    const join = (a, b) => words.slice(a, b).join(' ');
    const n = words.length;
    if (L === 2) { for (let k = 1; k < n; k++) { const m = Math.max(w(join(0, k)), w(join(k, n))); if (m < bestW) { bestW = m; best = [join(0, k), join(k, n)]; } } }
    else { for (let a = 1; a < n - 1; a++) for (let b = a + 1; b < n; b++) { const m = Math.max(w(join(0, a)), w(join(a, b)), w(join(b, n))); if (m < bestW) { bestW = m; best = [join(0, a), join(a, b), join(b, n)]; } } }
    return best || [words.join(' ')];
  }
  /* العنوان: سطر واحد إن اتسع، وإلا سطران متوازنان، مع احترام عرض القوس */
  function layoutTitle(ctx, text, o, u, fam, scale) {
    const words = text.split(/\s+/).filter(Boolean); if (!words.length) return { size: o.size, lines: [] };
    const size0 = o.size * scale, min = o.min * scale;
    for (let L = 1; L <= o.maxLines; L++) {
      const floor = L === 1 ? Math.max(min, size0 * 0.66) : min;
      for (let s = size0; s >= floor - 0.01; s -= 2) {
        ctx.font = font(s * u, fam);
        const lines = splitBalanced(ctx, words, L), lh = s * 1.22;
        const lastCy = o.lastCy + (L > 1 ? 14 : 0);
        const ok = lines.every((ln, i) => {
          const y = lastCy - (lines.length - 1 - i) * lh - s * 0.55;
          const allowed = Math.min(o.maxW, 2 * (archHalf(y) - 75));
          return ctx.measureText(ln).width / u <= allowed;
        });
        if (ok) return { size: s, lines, lh, lastCy };
      }
    }
    ctx.font = font(min * u, fam);
    const lines = splitBalanced(ctx, words, o.maxLines), lh = min * 1.22;
    return { size: min, lines, lh, lastCy: o.lastCy + 14 };
  }
  function fitOne(ctx, text, o, u, fam, scale) {
    let s = o.size * scale; const min = Math.min((o.min || o.size) * scale, s);
    for (; s > min; s -= 2) { ctx.font = font(s * u, fam); if (ctx.measureText(text).width <= o.maxW * u) return s; }
    ctx.font = font(min * u, fam); return min;
  }
  function drawLine(ctx, text, x, y, align, dir) {
    ctx.direction = dir || 'rtl'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  const monthName = m => MONTHS[+m] || '';
  const dateText = ad => ad.y && ad.m && ad.d ? `${ad.y}/${ad.m}/${ad.d}` : '';

  function draw(ctx, W, tpl, qr, ad, opt = {}) {
    const baseFam = opt.font || 'Cairo', layout = opt.layout || {};
    const u = W / BASE_W, H = Math.round(W * tpl.naturalHeight / tpl.naturalWidth);
    const adj = k => { const a = layout[k] || {}; return { dx: +a.dx || 0, dy: +a.dy || 0, s: +a.s || 1, f: a.f || baseFam }; };
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tpl, 0, 0, W, H);

    /* الشهر: نعيد رسم الحبة بنفس الشكل ثم نكتب الاسم */
    {
      const A = adj('month'), mp = POS.monthPill, mt = POS.month, month = 'شهر ' + monthName(ad.m || 4);
      const size = mt.size * A.s; ctx.font = font(size * u, A.f);
      const mw = ctx.measureText(month).width / u;
      const pillX = Math.min(mp.x, mt.right + A.dx - mw - 34);
      const g = ctx.createLinearGradient(0, mp.y * u, 0, (mp.y + mp.h) * u);
      g.addColorStop(0, 'rgb(248,171,9)'); g.addColorStop(1, 'rgb(235,162,8)');
      ctx.fillStyle = g; const r = mp.h / 2 * u;
      ctx.beginPath(); ctx.moveTo(BASE_W * u + 4, mp.y * u); ctx.lineTo(pillX * u + r, mp.y * u);
      ctx.arc(pillX * u + r, (mp.y + mp.h / 2) * u, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(BASE_W * u + 4, (mp.y + mp.h) * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = COLORS.white; drawLine(ctx, month, (mt.right + A.dx) * u, (mt.cy + A.dy) * u, 'right');
    }

    /* رقم الإعلان */
    if (ad.num !== '' && ad.num != null) {
      const A = adj('num'), np = POS.num; ctx.fillStyle = COLORS.white;
      fitOne(ctx, String(ad.num), { size: np.size, min: 34, maxW: np.maxW }, u, A.f, A.s);
      drawLine(ctx, String(ad.num), (np.cx + A.dx) * u, (np.cy + A.dy) * u, 'center', 'ltr');
    }

    ctx.fillStyle = COLORS.ink;

    /* العنوان */
    const AT = adj('title'), T = POS.title;
    const t = layoutTitle(ctx, (ad.title || '').trim(), T, u, AT.f, AT.s * (+ad.ts || 1));
    const firstCy = t.lastCy - (t.lines.length - 1) * t.lh;
    {
      const AL = adj('label'); ctx.font = font(POS.label.size * AL.s * u, AL.f);
      drawLine(ctx, 'محاضرة:', (POS.label.cx + AL.dx) * u, (firstCy - t.size * 0.5 - 50 + AL.dy) * u);
    }
    ctx.font = font(t.size * u, AT.f);
    t.lines.forEach((ln, i) => drawLine(ctx, ln, (T.cx + AT.dx) * u, (firstCy + i * t.lh + AT.dy) * u));

    /* رقم الفسح */
    let fasahTxt = ad.fasah === '' || ad.fasah == null ? '' : String(ad.fasah).trim();
    if (fasahTxt && /^\d+$/.test(fasahTxt)) fasahTxt = 'رقم الفسح: ' + fasahTxt;
    if (fasahTxt) { const A = adj('fasah'), P = POS.fasah; fitOne(ctx, fasahTxt, { ...P, min: 22 }, u, A.f, A.s); drawLine(ctx, fasahTxt, (P.cx + A.dx) * u, (P.cy + A.dy) * u); }

    /* الداعية */
    { const A = adj('speaker'), P = POS.speaker, sp = (ad.speaker || '').trim(); fitOne(ctx, sp, P, u, A.f, A.s); drawLine(ctx, sp, (P.cx + A.dx) * u, (P.cy + A.dy) * u); }

    /* اليوم والتاريخ */
    { const A = adj('day'), P = POS.day; fitOne(ctx, ad.day || '', P, u, A.f, A.s); drawLine(ctx, ad.day || '', (P.cx + A.dx) * u, (P.cy + A.dy) * u); }
    { const A = adj('date'), P = POS.date; fitOne(ctx, dateText(ad), P, u, A.f, A.s); drawLine(ctx, dateText(ad), (P.cx + A.dx) * u, (P.cy + A.dy) * u, 'center', 'ltr'); }

    /* الوقت */
    { const A = adj('time'), P = POS.time; fitOne(ctx, ad.time || '', P, u, A.f, A.s); drawLine(ctx, ad.time || '', (P.cx + A.dx) * u, (P.cy + A.dy) * u); }

    /* الباركود */
    { const A = adj('qr'), q = POS.qr, s = q.size * A.s * u, cx = (q.cx + A.dx) * u, cy = (q.cy + A.dy) * u;
      if (qr) ctx.drawImage(qr, cx - s / 2, cy - s / 2, s, s);
      else if (ad.remote) { ctx.font = font(64 * A.s * u, baseFam); drawLine(ctx, 'عن بُعد', cx, cy); } }
    ctx.restore();
    return H;
  }

  return { draw, MONTHS, monthName, dateText, BASE_W, FONTS, ELEMENTS };
})();
