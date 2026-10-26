/* أدوات مساعدة: قراءة xlsx/csv، إنشاء zip، إنشاء pdf — بدون أي مكتبات خارجية */
const Lib = (() => {
  const td = new TextDecoder('utf-8');
  const te = new TextEncoder();

  /* ---------- ZIP (قراءة) ---------- */
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('الملف ليس بصيغة xlsx صحيحة');
    const n = dv.getUint16(e + 10, true), cd = dv.getUint32(e + 16, true);
    const files = {};
    let p = cd;
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, lho };
      p += 46 + nl + el + cl;
    }
    return {
      async text(name) {
        const f = files[name]; if (!f) return null;
        const ln = dv.getUint16(f.lho + 26, true), le = dv.getUint16(f.lho + 28, true);
        const s = f.lho + 30 + ln + le;
        const data = u8.subarray(s, s + f.csize);
        return td.decode(f.method === 0 ? data : await inflateRaw(data));
      }
    };
  }

  /* ---------- XLSX ---------- */
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wb = xml(await z.text('xl/workbook.xml'));
    const rels = xml(await z.text('xl/_rels/workbook.xml.rels'));
    const relMap = {};
    for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    let shared = [];
    const ss = await z.text('xl/sharedStrings.xml');
    if (ss) {
      for (const si of xml(ss).getElementsByTagName('si')) {
        let t = '';
        for (const node of si.childNodes) {
          if (node.nodeName === 't') t += node.textContent;
          else if (node.nodeName === 'r') for (const x of node.childNodes) if (x.nodeName === 't') t += x.textContent;
        }
        shared.push(t);
      }
    }
    const sheets = [];
    for (const sh of wb.getElementsByTagName('sheet')) {
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      const data = await z.text(target);
      if (!data) continue;
      const rows = [];
      for (const row of xml(data).getElementsByTagName('row')) {
        const r = (+row.getAttribute('r') || rows.length + 1) - 1;
        const arr = rows[r] = [];
        for (const c of row.getElementsByTagName('c')) {
          const t = c.getAttribute('t');
          const vEl = c.getElementsByTagName('v')[0];
          let val = null;
          if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join('');
          else if (vEl) {
            const raw = vEl.textContent;
            if (t === 's') val = shared[+raw];
            else if (t === 'str' || t === 'e') val = raw;
            else if (t === 'b') val = raw === '1';
            else val = parseFloat(raw);
          }
          arr[colIdx(c.getAttribute('r'))] = val;
        }
      }
      sheets.push({ name: sh.getAttribute('name'), rows: Array.from(rows, r => r || []) });
    }
    return sheets;
  }

  /* ---------- CSV ---------- */
  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  const toCsv = rows => '﻿' + rows.map(r => r.map(v => {
    v = v == null ? '' : String(v);
    return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\r\n');

  /* ---------- ZIP (كتابة، بدون ضغط) ---------- */
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) { // [{name, data:Uint8Array}]
    const parts = [], central = []; let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = te.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(lh.buffer, name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  /* ---------- PDF (صفحة لكل صورة JPEG) ---------- */
  function makePdf(pages) { // [{jpeg:Uint8Array, w, h}]
    const chunks = []; let len = 0; const offsets = [];
    const push = d => { const u = typeof d === 'string' ? te.encode(d) : d; chunks.push(u); len += u.length; };
    const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const total = 2 + pages.length * 3;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      const PW = 595, PH = Math.round(595 * p.h / p.w);
      obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
      const c = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      obj(ct, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
      offsets[im] = len;
      push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); push('\nendstream\nendobj\n');
    });
    const xref = len;
    let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  return { readXlsx, readCsv, toCsv, makeZip, makePdf, te };
})();
