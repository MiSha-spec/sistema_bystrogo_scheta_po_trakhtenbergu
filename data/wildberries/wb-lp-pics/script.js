/* ЛП ВБ с картинками и наименованиями из 1С
   Вход:  печатный Лист подбора (PDF), этикетки ШК (PDF), прайс 1С (Excel).
   Выход: 1) ЛП без столбиков «Бренд» и «Размер», зато с «Наименование из 1С»
             (по артикулу из прайса) и с фото из исходного листа;
          2) PDF этикеток ШК, страницы которых идут в порядке строк листа. */

/* ============================ Состояние ============================ */

let listData  = null; // { rows: [{num, name, color, article, sticker, photo}], meta, name }
let shkData   = null; // { bySticker: Map(стикер -> индекс страницы), pages, name }
let priceData = null; // { map: Map(артикул -> наименование), name }

let built = null;   // { rows, lpBlob, shkBlob, noName, noLabel }
let showAllMode = false;

/* ============================ Служебные ============================ */

function setStatus(id, text, cls) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
}

function setProgress(pct, text, details) {
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPercent').textContent = pct + '%';
    if (text != null) document.getElementById('progressText').textContent = text;
    if (details != null) document.getElementById('progressDetails').textContent = details;
}

function updateStartBtn() {
    document.getElementById('startBtn').disabled = !(listData && shkData && priceData);
}

function wireUpload(areaId, inputId, handler) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);
    input.addEventListener('change', e => {
        if (e.target.files[0]) handler(e.target.files[0]);
        input.value = '';
    });
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handler(file);
    });
}

/* Ключ: строка без пробелов и неразрывных пробелов */
function normKey(s) {
    return String(s == null ? '' : s).replace(/[\s\u00A0\u2007\u202F]+/g, '');
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}

/* Перенос текста по ширине; длинные слова режем; максимум maxLines строк */
function wrapText(text, font, size, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= maxW) { cur = t; continue; }
        if (cur) { lines.push(cur); cur = ''; }
        if (font.widthOfTextAtSize(w, size) <= maxW) { cur = w; continue; }
        // слово само шире столбика — режем посимвольно
        let part = w;
        while (part && font.widthOfTextAtSize(part, size) > maxW) {
            let cut = part.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(part.slice(0, cut), size) > maxW) cut--;
            lines.push(part.slice(0, cut));
            part = part.slice(cut);
        }
        cur = part;
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return lines;
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && font.widthOfTextAtSize(last + '…', size) > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
}

/* ============================ Лист подбора (PDF) ============================ */

/* Колонки листа подбора: № задания | Фото | Бренд | Наименование | Размер |
   Цвет | Артикул продавца | Стикер. Границы колонок берём из шапки,
   текст раскладываем по колонкам и по ближайшей строке (номер задания). */
async function handleList(file) {
    document.getElementById('listFileName').textContent = file.name;
    setStatus('listStatus', '⏳ Читаем PDF и вырезаем фото...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const rows = [];              // в порядке листа
        const seen = new Set();
        const meta = { title: '', date: '', count: '' };
        let bounds = null, headerY = null;

        for (let p = 1; p <= doc.numPages; p++) {
            setProgress(Math.round(5 + p / doc.numPages * 35), 'Чтение листа подбора: стр. ' + p + '/' + doc.numPages, '');
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();

            const items = [];
            for (const it of tc.items) {
                if (!it.str || !it.str.trim()) continue;
                items.push({ x: it.transform[4], y: it.transform[5], s: it.str.trim() });
            }
            if (!items.length) continue;

            // шапка таблицы
            const HDRS = ['№ задания', 'Фото', 'Бренд', 'Наименование', 'Размер', 'Цвет', 'Артикул продавца', 'Стикер'];
            const hdr = items.filter(it => HDRS.includes(it.s));
            if (hdr.length >= 5) {
                hdr.sort((a, b) => a.x - b.x);
                bounds = hdr.map(it => ({
                    name: it.s === '№ задания' ? 'num' :
                          it.s === 'Фото' ? 'photo' :
                          it.s === 'Бренд' ? 'brand' :
                          it.s === 'Наименование' ? 'name' :
                          it.s === 'Размер' ? 'size' :
                          it.s === 'Цвет' ? 'color' :
                          it.s === 'Артикул продавца' ? 'article' : 'sticker',
                    x: it.x
                }));
                headerY = hdr.reduce((s, it) => s + it.y, 0) / hdr.length;
            }
            if (!bounds) continue;

            const colOf = (x) => {
                let c = null;
                for (const b of bounds) if (x >= b.x - 2) c = b.name;
                return c;
            };

            // служебные строки над таблицей (только на первой странице с шапкой)
            if (!meta.title || !meta.date) {
                for (const it of items) {
                    if (!meta.title && /Лист подбора/.test(it.s)) meta.title = it.s;
                    if (!meta.date && /^Дата:/.test(it.s)) meta.date = it.s;
                    if (!meta.count && /Количество товаров/.test(it.s)) meta.count = it.s;
                }
            }

            // якоря строк — 10-значные номера в первой колонке
            const anchors = [];
            for (const it of items) {
                if (colOf(it.x) === 'num' && /^\d{10}$/.test(it.s) && !seen.has(it.s)) {
                    anchors.push({ y: it.y, num: it.s });
                }
            }
            if (!anchors.length) continue;
            anchors.sort((a, b) => b.y - a.y); // сверху вниз

            //_buckets: текст по колонкам относительно ближайшего якоря
            const buckets = new Map();
            for (const a of anchors) buckets.set(a.num, { name: [], color: [], article: [], sticker: [] });
            for (const it of items) {
                if (Math.abs(it.y - headerY) < 6) continue;
                const col = colOf(it.x);
                if (col !== 'name' && col !== 'color' && col !== 'article' && col !== 'sticker') continue;
                let best = null, bd = Infinity;
                for (const a of anchors) {
                    const d = Math.abs(a.y - it.y);
                    if (d < bd) { bd = d; best = a; }
                }
                if (!best || bd > 45) continue;
                buckets.get(best.num)[col].push(it);
            }
            const joinYX = (arr) => arr.sort((a, b) => (b.y - a.y) || (a.x - b.x))
                .map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
            for (const [num, c] of buckets) {
                if (seen.has(num)) continue;
                const article = joinYX(c.article).replace(/\s+/g, '');
                const sticker = joinYX(c.sticker).replace(/\s+/g, '');
                if (!article || !sticker) continue;
                seen.add(num);
                rows.push({
                    num: num,
                    name: joinYX(c.name),
                    color: joinYX(c.color),
                    article: article,
                    sticker: sticker,
                    photo: null,
                    pageY: null, pageIdx: 0
                });
            }

            // рендер страницы для вырезки фото
            const vp = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;

            // границы колонок «Фото» и следующей за ней
            const ph = bounds.find(b => b.name === 'photo');
            const phIdx = bounds.indexOf(ph);
            const x0 = ph ? ph.x - 2 : 0;
            const x1 = (phIdx >= 0 && phIdx + 1 < bounds.length) ? bounds[phIdx + 1].x - 2 : vp.width / 2;
            const s = 2, pageH = page.getViewport({ scale: 1 }).height;

            anchors.forEach((a, i) => {
                if (seen.has(a.num) === false) return;
                // строка: от середины до соседа сверху до середины до соседа снизу
                const up = i === 0 ? (anchors[0].y - (anchors[1] ? anchors[1].y : anchors[0].y - 60)) : (anchors[i - 1].y - a.y) / 2;
                const down = (i + 1 < anchors.length) ? (a.y - anchors[i + 1].y) / 2 : up;
                let top = a.y + Math.min(up, 40) - 2;
                let bottom = a.y - Math.min(down, 40) + 2;
                const sx = Math.max(0, Math.floor(x0 * s));
                const sw = Math.max(4, Math.floor((x1 - x0) * s));
                const sy = Math.max(0, Math.floor((pageH - top) * s));
                const sh = Math.max(4, Math.floor((top - bottom) * s));
                const cw = Math.min(canvas.width - sx, sw), ch = Math.min(canvas.height - sy, sh);
                if (cw <= 4 || ch <= 4) return;
                const cc = document.createElement('canvas');
                cc.width = cw; cc.height = ch;
                const cctx = cc.getContext('2d', { alpha: false });
                cctx.fillStyle = '#ffffff';
                cctx.fillRect(0, 0, cw, ch);
                cctx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
                const dataUrl = cc.toDataURL('image/jpeg', 0.82);
                const row = rows.find(r => r.num === a.num);
                if (row && !row.photo) {
                    row.photo = {
                        bytes: Uint8Array.from(atob(dataUrl.split(',')[1]), ch2 => ch2.charCodeAt(0)),
                        w: cw, h: ch, url: dataUrl
                    };
                    row.pageY = p;
                }
            });
        }
        if (!rows.length) throw new Error('не нашли ни одного задания в PDF');
        // порядок строк = порядок листа (якоря собирались постранично сверху вниз)
        listData = { rows: rows, meta: meta, name: file.name };
        setStatus('listStatus', `✅ Строк: ${rows.length} (фото: ${rows.filter(r => r.photo).length})`, 'success');
    } catch (err) {
        listData = null;
        setStatus('listStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Этикетки ШК (PDF) ============================ */

/* Каждая страница — стикер с номером ШК («WB 5868407 0992» — части могут
   быть разбиты произвольно, склеиваем все цифры после «WB»). */
async function handleShk(file) {
    document.getElementById('shkFileName').textContent = file.name;
    setStatus('shkStatus', '⏳ Читаем этикетки...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const bytesKeep = new Uint8Array(buf); // копия до передачи pdf.js — он забирает буфер себе
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const bySticker = new Map();
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            const txt = tc.items.map(it => it.str).join(' ');
            const m = txt.match(/WB\s*(\d{4,8})\s*(\d{3,8})/);
            if (m && !bySticker.has(m[1] + m[2])) bySticker.set(m[1] + m[2], p - 1);
            setProgress(Math.round(40 + p / doc.numPages * 8), 'Чтение этикеток: ' + p + '/' + doc.numPages, '');
        }
        if (!bySticker.size) throw new Error('не нашли ни одного ШК на этикетках');
        shkData = { bySticker: bySticker, pages: doc.numPages, bytes: bytesKeep, name: file.name };
        setStatus('shkStatus', `✅ Страниц: ${doc.numPages} (ШК распознано: ${bySticker.size})`, 'success');
    } catch (err) {
        shkData = null;
        setStatus('shkStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Прайс 1С (Excel) ============================ */

/* Первый столбик — артикул (код), второй — наименование */
async function handlePrice(file) {
    document.getElementById('priceFileName').textContent = file.name;
    setStatus('priceStatus', '⏳ Чтение файла...', '');
    try {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
        const map = new Map();
        for (const r of rows) {
            const art = normKey(r[0]);
            const nm = String(r[1] == null ? '' : r[1]).trim();
            if (art && nm && !map.has(art)) map.set(art, nm);
        }
        if (!map.size) throw new Error('в прайсе не нашлось пар «артикул + название»');
        priceData = { map: map, name: file.name };
        setStatus('priceStatus', `✅ Товаров в прайсе: ${map.size}`, 'success');
    } catch (err) {
        priceData = null;
        setStatus('priceStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Генерация ЛП-1С (pdf-lib) ============================ */

/* A4 альбомная. Колонки: № | Фото | Наименование | Наименование из 1С |
   Цвет | Артикул | Стикер («Бренд» и «Размер» из исходного листа убраны). */
const COLS = [
    { key: 'num',    title: '№ задания', w: 68 },
    { key: 'photo',  title: 'Фото', w: 58 },
    { key: 'name',   title: 'Наименование', w: 237 },
    { key: 'name1c', title: 'Наименование из 1С', w: 237 },
    { key: 'color',  title: 'Цвет', w: 55 },
    { key: 'article',title: 'Артикул', w: 62 },
    { key: 'sticker',title: 'Стикер', w: 89 }
];
const PAGE_W = 841.89, PAGE_H = 595.28, MARGIN = 18;
const ROW_H = 56, HEAD_H = 30;

async function buildLpPdf(rows, meta, onProgress) {
    const out = await PDFLib.PDFDocument.create();
    out.registerFontkit(window.fontkit);
    const fReg = await out.embedFont(b64ToBytes(window.DEJAVU_FONT_B64), { subset: true });
    const fBold = await out.embedFont(b64ToBytes(window.DEJAVU_BOLD_FONT_B64), { subset: true });

    const tableW = COLS.reduce((s, c) => s + c.w, 0);
    const xs = [];
    let acc = MARGIN;
    for (const c of COLS) { xs.push(acc); acc += c.w; }

    let page = null;
    let y = 0;
    let pageNo = 0;

    const newPage = () => {
        page = out.addPage([PAGE_W, PAGE_H]);
        pageNo++;
        y = PAGE_H - MARGIN;
        // шапка листа
        const head = [meta.title, meta.date, meta.count].filter(Boolean).join('   •   ');
        if (head) {
            page.drawText(head, { x: MARGIN, y: y - 11, size: 9.5, font: fReg, color: PDFLib.rgb(0.25, 0.25, 0.25) });
        }
        page.drawText('стр. ' + pageNo, { x: PAGE_W - MARGIN - 34, y: y - 11, size: 9.5, font: fReg, color: PDFLib.rgb(0.45, 0.45, 0.45) });
        y -= 24;
        // тёмная шапка таблицы
        page.drawRectangle({ x: MARGIN, y: y - HEAD_H, width: tableW, height: HEAD_H, color: PDFLib.rgb(0.25, 0.25, 0.25) });
        COLS.forEach((c, i) => {
            const lines = wrapText(c.title, fBold, 9, c.w - 8, 2);
            const lh = 9 * 1.15;
            const topPad = (HEAD_H - lines.length * lh) / 2;
            let ty = y - topPad - 8.4;
            for (const ln of lines) {
                page.drawText(ln, { x: xs[i] + 4, y: ty, size: 9, font: fBold, color: PDFLib.rgb(1, 1, 1) });
                ty -= lh;
            }
        });
        y -= HEAD_H;
    };

    newPage();

    // чередование полос по блокам одинаковых наименований
    const bands = [];
    let band = false, prevName = null;
    for (const r of rows) {
        if (r.name !== prevName) { band = !band; prevName = r.name; }
        bands.push(band);
    }

    const drawRow = async (r, i) => {
        if (y - ROW_H < MARGIN) {
            // горизонталь до низа и новая страница
            page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: MARGIN + tableW, y: MARGIN }, thickness: 0.7, color: PDFLib.rgb(0.6, 0.6, 0.6) });
            newPage();
        }
        if (bands[i]) {
            page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: tableW, height: ROW_H, color: PDFLib.rgb(0.937, 0.937, 0.937) });
        }
        // сетка строки: вертикали поверх заливки
        xs.forEach(x => page.drawLine({ start: { x: x, y: y }, end: { x: x, y: y - ROW_H }, thickness: 0.7, color: PDFLib.rgb(0.6, 0.6, 0.6) }));
        page.drawLine({ start: { x: MARGIN + tableW, y: y }, end: { x: MARGIN + tableW, y: y - ROW_H }, thickness: 0.7, color: PDFLib.rgb(0.6, 0.6, 0.6) });
        const top = y;
        const put = (col, text, opts) => {
            const ci = COLS.findIndex(c => c.key === col);
            const size = (opts && opts.size) || 8.5;
            const font = (opts && opts.bold) ? fBold : fReg;
            const maxW = COLS[ci].w - 8;
            const lines = wrapText(text, font, size, maxW, (opts && opts.maxLines) || 3);
            const lh = size * 1.18;
            let ty = top - (ROW_H - lines.length * lh) / 2 - size;
            for (const ln of lines) {
                page.drawText(ln, { x: xs[ci] + 4, y: ty, size: size, font: font, color: PDFLib.rgb(0.1, 0.1, 0.1) });
                ty -= lh;
            }
        };
        put('num', r.num, { size: 9 });
        put('name', r.name, { maxLines: 3 });
        put('name1c', r.name1c || '', { maxLines: 3 });
        put('color', r.color, { maxLines: 2 });
        put('article', r.article, { size: 9 });
        // стикер: основная часть обычным, последние 4 цифры — жирным
        if (r.sticker) {
            const ci = COLS.findIndex(c => c.key === 'sticker');
            const st = String(r.sticker);
            const size = 9;
            const main = st.slice(0, -4), last4 = st.slice(-4);
            const totalW = fReg.widthOfTextAtSize(main, size) + fBold.widthOfTextAtSize(last4, size);
            const sx = xs[ci] + (COLS[ci].w - totalW) / 2;
            const ty = top - ROW_H / 2 - size / 2 + 2.5;
            page.drawText(main, { x: sx, y: ty, size: size, font: fReg, color: PDFLib.rgb(0.1, 0.1, 0.1) });
            page.drawText(last4, { x: sx + fReg.widthOfTextAtSize(main, size), y: ty, size: size, font: fBold, color: PDFLib.rgb(0.1, 0.1, 0.1) });
        }

        // фото
        const pi = COLS.findIndex(c => c.key === 'photo');
        if (r.photo) {
            try {
                const img = await out.embedJpg(r.photo.bytes);
                const box = 50;
                const k = Math.min(box / r.photo.w, box / r.photo.h);
                const dw = r.photo.w * k, dh = r.photo.h * k;
                page.drawImage(img, {
                    x: xs[pi] + (COLS[pi].w - dw) / 2,
                    y: top - ROW_H / 2 - dh / 2,
                    width: dw, height: dh
                });
            } catch (e) { /* не картинка — пропускаем */ }
        } else {
            page.drawRectangle({ x: xs[pi] + 5, y: top - ROW_H / 2 - 22, width: COLS[pi].w - 10, height: 44, color: PDFLib.rgb(0.92, 0.92, 0.92) });
        }
        // горизонтальная линия строки
        page.drawLine({ start: { x: MARGIN, y: top - ROW_H }, end: { x: MARGIN + tableW, y: top - ROW_H }, thickness: 0.7, color: PDFLib.rgb(0.6, 0.6, 0.6) });
        y -= ROW_H;
    };

    for (let i = 0; i < rows.length; i++) {
        await drawRow(rows[i], i);
        if (i % 20 === 0) await new Promise(r2 => setTimeout(r2, 0));
    }
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: MARGIN + tableW, y: MARGIN }, thickness: 0.7, color: PDFLib.rgb(0.6, 0.6, 0.6) });

    return await out.save();
}

/* ============================ Сортировка ШК (pdf-lib) ============================ */

async function buildShkPdf(rows, shk) {
    const src = await PDFLib.PDFDocument.load(shk.bytes);
    const order = [];
    const used = new Set();
    for (const r of rows) {
        const pi = shk.bySticker.get(normKey(r.sticker));
        if (pi != null && !used.has(pi)) { order.push(pi); used.add(pi); }
    }
    const rest = [];
    for (let i = 0; i < src.getPageCount(); i++) if (!used.has(i)) rest.push(i);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, order.concat(rest)); // одним вызовом
    pages.forEach(p => out.addPage(p));
    return await out.save();
}

/* ============================ Сборка ============================ */

async function startBuild() {
    if (!(listData && shkData && priceData)) return;
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('warningsSection').classList.add('hidden');
    document.getElementById('progressSection').classList.remove('hidden');
    setProgress(0, 'Обработка...', '');

    try {
        // склейка: строки листа + наименования из прайса
        setProgress(12, 'Собираем строки...', '');
        await new Promise(r => setTimeout(r, 30));
        const rows = listData.rows.map(r => ({
            num: r.num,
            name: r.name,
            color: r.color,
            article: r.article,
            sticker: r.sticker,
            photo: r.photo,
            name1c: priceData.map.get(normKey(r.article)) || ''
        }));
        const noName = rows.filter(r => !r.name1c).length;
        const noLabel = rows.filter(r => !shkData.bySticker.has(normKey(r.sticker))).length;

        // ЛП-1С.pdf
        setProgress(16, 'Формируем ЛП с наименованиями из 1С...', '');
        const lpBytes = await buildLpPdf(rows, listData.meta, (p) => setProgress(p, 'ЛП: ' + p + '%', ''));
        setProgress(86, 'ЛП готов', '');

        // ШК в порядке листа
        setProgress(88, 'Сортируем этикетки ШК...', '');
        const shkBytes = await buildShkPdf(rows, {
            bytes: shkData.bytes,
            bySticker: shkData.bySticker
        });
        setProgress(100, 'Готово!', `Строк: ${rows.length} | Из 1С: ${rows.length - noName} | Этикеток по порядку: ${rows.length - noLabel}`);

        built = {
            rows: rows,
            lpBlob: new Blob([lpBytes], { type: 'application/pdf' }),
            shkBlob: new Blob([shkBytes], { type: 'application/pdf' }),
            noName: noName,
            noLabel: noLabel
        };
        showResults();
    } catch (err) {
        console.error(err);
        setProgress(0, '❌ Ошибка: ' + err.message, '');
    }
    btn.disabled = false;
    updateStartBtn();
}

/* ============================ Результаты ============================ */

function showResults() {
    const { rows, noName, noLabel } = built;
    const withName = rows.length - noName;
    const withLabel = rows.length - noLabel;

    document.getElementById('summary').innerHTML = `
        <div class="summary-card ok">
            <span class="num">${rows.length}</span>
            <div class="lbl">Строк в листе</div>
        </div>
        <div class="summary-card ${noName ? 'warn' : 'ok'}">
            <span class="num">${withName}</span>
            <div class="lbl">С наименованием из 1С</div>
        </div>
        <div class="summary-card ${noLabel ? 'warn' : 'ok'}">
            <span class="num">${withLabel}</span>
            <div class="lbl">Этикеток по порядку</div>
        </div>
    `;

    let warnHtml = '';
    if (noName) {
        const arts = rows.filter(r => !r.name1c).map(r => r.article).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noName} артикул(ов) не нашлось в прайсе</strong> — столбик «Наименование из 1С» будет пустым: ${arts}${noName > 10 ? ' …' : ''}</p>`;
    }
    if (noLabel) {
        const nums = rows.filter(r => !shkData.bySticker.has(normKey(r.sticker))).map(r => r.num).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noLabel} задани(й) без этикетки</strong> — стикер из листа не совпал с PDF этикеток: ${nums}${noLabel > 10 ? ' …' : ''}</p>`;
    }
    const extra = shkData.pages - (rows.length - noLabel);
    if (extra > 0) {
        warnHtml += `<p><strong>ℹ️ ${extra} страниц(ы) этикеток не совпали со строками листа</strong> — добавлены в конец отсортированного файла.</p>`;
    }
    if (warnHtml) {
        document.getElementById('warningsBox').innerHTML = warnHtml;
        document.getElementById('warningsSection').classList.remove('hidden');
    } else {
        document.getElementById('warningsSection').classList.add('hidden');
    }

    showAllMode = false;
    renderPreview();
    const showAllBtn = document.getElementById('showAllBtn');
    if (rows.length > 100) {
        showAllBtn.classList.remove('hidden');
        showAllBtn.textContent = `Показать все строки (${rows.length})`;
    } else {
        showAllBtn.classList.add('hidden');
    }

    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function renderPreview() {
    const { rows } = built;
    const limit = showAllMode ? rows.length : Math.min(rows.length, 100);
    let band = false;
    let prevName = null;
    document.getElementById('resultsBody').innerHTML = rows.slice(0, limit).map(r => {
        if (r.name !== prevName) { band = !band; prevName = r.name; }
        return `
        <tr class="${band ? 'band' : ''}">
            <td>${r.num}</td>
            <td>${r.photo ? `<img src="${r.photo.url}" style="height:40px; border-radius:4px;">` : '—'}</td>
            <td>${r.article || '—'}</td>
            <td class="name-cell">${r.name || '—'}</td>
            <td class="name-cell">${r.name1c || '—'}</td>
            <td>${r.sticker ? r.sticker.replace(/(\d{4})$/, '<b>$1</b>') : '—'}</td>
        </tr>`;
    }).join('') +
    (limit < rows.length
        ? `<tr><td colspan="6" style="text-align:center; color:#86868b;">… и ещё ${rows.length - limit} строк</td></tr>`
        : '');
}

function showAllRows() {
    showAllMode = true;
    renderPreview();
    document.getElementById('showAllBtn').classList.add('hidden');
}

function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ============================ Инициализация ============================ */

document.getElementById('downloadLpBtn').addEventListener('click', () => {
    if (built) download(built.lpBlob, 'ЛП с наименованиями из 1С.pdf');
});
document.getElementById('downloadShkBtn').addEventListener('click', () => {
    if (built) download(built.shkBlob, 'ШК по порядку листа.pdf');
});

wireUpload('listUploadArea', 'listFileInput', handleList);
wireUpload('shkUploadArea', 'shkFileInput', handleShk);
wireUpload('priceUploadArea', 'priceFileInput', handlePrice);
