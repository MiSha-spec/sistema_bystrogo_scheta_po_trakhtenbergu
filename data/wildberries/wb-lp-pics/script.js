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
   текст раскладываем по колонкам и по ближайшей строке (номер задания).
   Здесь же собираем геометрию страниц — она нужна, чтобы дорисовать
   «Наименование из 1С» прямо в исходном PDF. */
async function handleList(file) {
    document.getElementById('listFileName').textContent = file.name;
    setStatus('listStatus', '⏳ Читаем PDF...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const bytesKeep = new Uint8Array(buf); // копия до передачи pdf.js — для pdf-lib
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const rows = [];              // в порядке листа
        const seen = new Set();
        const pageGeoms = [];         // {anchorYs, bounds, headerY} на страницу
        const meta = { title: '', date: '', count: '' };
        let bounds = null, headerY = null;

        for (let p = 1; p <= doc.numPages; p++) {
            setProgress(Math.round(5 + p / doc.numPages * 30), 'Чтение листа подбора: стр. ' + p + '/' + doc.numPages, '');
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
                    sticker: sticker
                });
            }
            pageGeoms.push({
                anchorYs: anchors.map(a => ({ y: a.y, num: a.num, bgName: null, bgSize: null })),
                bounds: bounds.map(b => ({ name: b.name, x: b.x })),
                headerY: headerY
            });

            // цвета фона строк (в исходнике строки чередуются серым/белым —
            // заплатки должны совпадать по цвету). Рендерим страницу в мелком
            // масштабе и снимаем цвет правее текста, у края колонки.
            try {
                const sLow = 0.4;
                const vpLow = page.getViewport({ scale: sLow });
                const cv = document.createElement('canvas');
                cv.width = Math.max(2, Math.floor(vpLow.width));
                cv.height = Math.max(2, Math.floor(vpLow.height));
                const cctx = cv.getContext('2d', { alpha: false });
                cctx.fillStyle = '#ffffff';
                cctx.fillRect(0, 0, cv.width, cv.height);
                await page.render({ canvasContext: cctx, viewport: vpLow }).promise;
                const pageH = page.getViewport({ scale: 1 }).height;
                const xB = bounds.find(b => b.name === 'size');
                const xA = bounds.find(b => b.name === 'article');
                const geo = pageGeoms[pageGeoms.length - 1];
                for (const a of geo.anchorYs) {
                    const sample = (xPt) => {
                        const px = Math.min(cv.width - 1, Math.max(0, Math.round(xPt * sLow)));
                        const py = Math.min(cv.height - 1, Math.max(0, Math.round((pageH - a.y - 17) * sLow)));
                        const d = cctx.getImageData(px, py, 1, 1).data;
                        return [d[0], d[1], d[2]];
                    };
                    if (xB) a.bgName = sample(xB.x - 8);   // край колонки «Размер» — зона имени
                    if (xA) a.bgSize = sample(xA.x - 8);   // край колонки «Артикул» — зона 1С
                }
            } catch (e) { /* нет канваса — заплатки будут белыми */ }
        }
        if (!rows.length) throw new Error('не нашли ни одного задания в PDF');
        listData = { rows: rows, meta: meta, pages: pageGeoms, bytes: bytesKeep, name: file.name };
        setStatus('listStatus', `✅ Строк: ${rows.length}`, 'success');
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

/* ============================ Модификация исходного ЛП (pdf-lib) ============================ */

/* Не перерисовываем таблицу, а правим исходный PDF:
   — столбик «Бренд» убираем (закрашиваем), «Наименование» переезжает на его
     место и становится шире (минимум 2 строки);
   — столбик «Размер» превращаем в «Наименование из 1С» (по артикулу из прайса);
   — фото, сетка, номера, артикулы, стикеры и заголовок листа остаются родными. */

const MOD_NAME_SIZE = 8;    // шрифт наименований
const MOD_1C_SIZE = 7.5;    // шрифт наименований из 1С
const BLACK = PDFLib.rgb(0.13, 0.13, 0.13);

/* Перенос текста; если влезло в одну строку — делим на две сбалансированные */
function wrapMin2(text, font, size, maxW, maxLines) {
    const lines = wrapText(text, font, size, maxW, maxLines);
    if (lines.length > 1 || lines.length === 0) return lines;
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length < 2) return lines;
    let best = 1, bestDiff = Infinity;
    for (let k = 1; k < words.length; k++) {
        const w1 = font.widthOfTextAtSize(words.slice(0, k).join(' '), size);
        const w2 = font.widthOfTextAtSize(words.slice(k).join(' '), size);
        const diff = Math.abs(w1 - w2);
        if (w1 <= maxW && w2 <= maxW && diff < bestDiff) { bestDiff = diff; best = k; }
    }
    if (best === words.length) return lines;
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

async function buildLpModified(srcBytes, rows, pages, rowByNum) {
    const doc = await PDFLib.PDFDocument.load(srcBytes);
    doc.registerFontkit(window.fontkit);
    const fReg = await doc.embedFont(b64ToBytes(window.DEJAVU_FONT_B64), { subset: true });
    const fBold = await doc.embedFont(b64ToBytes(window.DEJAVU_BOLD_FONT_B64), { subset: true });

    const xOf = (bounds, name) => {
        const b = bounds.find(x => x.name === name);
        return b ? b.x : null;
    };
    const rgbOf = (bg) => bg ? PDFLib.rgb(bg[0] / 255, bg[1] / 255, bg[2] / 255) : PDFLib.rgb(1, 1, 1);

    for (let p = 0; p < pages.length; p++) {
        const g = pages[p];
        if (!g.bounds || !g.anchorYs.length) continue;
        const page = doc.getPage(p);
        const brandX = xOf(g.bounds, 'brand');
        const nameX = xOf(g.bounds, 'name');
        const sizeX = xOf(g.bounds, 'size');
        const colorX = xOf(g.bounds, 'color');
        const articleX = xOf(g.bounds, 'article');
        if (brandX == null || nameX == null || sizeX == null || colorX == null || articleX == null) continue;

        const ys = g.anchorYs; // сверху вниз
        const halfGap = (i) => {
            const up = i === 0 ? (ys[0].y - (ys[1] ? ys[1].y : ys[0].y - 56)) : (ys[i - 1].y - ys[i].y) / 2;
            const down = ys[i + 1] ? (ys[i].y - ys[i + 1].y) / 2 : up;
            return { up: Math.min(up, 40), down: Math.min(down, 40) };
        };
        const tableBottom = ys[ys.length - 1].y - halfGap(ys.length - 1).down - 20;
        const white = PDFLib.rgb(1, 1, 1);

        // 1) шапка: убираем «Бренд», «Наименование» центрируем шире,
        //    «Размер»+«Цвет» превращаем в «Наименование из 1С»
        if (g.headerY != null) {
            page.drawRectangle({ x: brandX - 1, y: g.headerY - 9, width: (sizeX - brandX) + 2, height: 18, color: white });
            page.drawRectangle({ x: sizeX - 1, y: g.headerY - 9, width: (articleX - sizeX) + 2, height: 18, color: white });
            const putHead = (lines, x0, x1, baseY, size) => {
                const lh = size * 1.15;
                let ty = baseY + ((lines.length - 1) * lh) / 2;
                for (const ln of lines) {
                    const w = fBold.widthOfTextAtSize(ln, size);
                    page.drawText(ln, { x: x0 + ((x1 - x0) - w) / 2, y: ty, size: size, font: fBold, color: BLACK });
                    ty -= lh;
                }
            };
            putHead(['Наименование'], brandX, sizeX, g.headerY - 1, MOD_NAME_SIZE);
            putHead(['Наименование', 'из 1С'], sizeX, articleX, g.headerY - 1, 7.5);
        }
        // вертикальные линии, которые мешают объединённым колонкам:
        // Бренд|Наименование и Размер|Цвет — на всей высоте таблицы
        page.drawRectangle({ x: nameX - 5.5, y: tableBottom, width: 6.5, height: (g.headerY != null ? g.headerY - 12 : ys[0].y + 20) - tableBottom, color: white });
        page.drawRectangle({ x: colorX - 5.5, y: tableBottom, width: 6.5, height: (g.headerY != null ? g.headerY - 12 : ys[0].y + 20) - tableBottom, color: white });

        // 2) строки: закрашиваем старый текст цветом фона строки (строки в
        //    исходнике чередуются серым/белым), рисуем новые тексты
        for (let i = 0; i < ys.length; i++) {
            const row = rowByNum.get(ys[i].num);
            if (!row) continue;
            const { up, down } = halfGap(i);
            const aY = ys[i].y;
            // заплатка до самой линейки строки (не доходим 0.5pt), чтобы
            // вертикальные белые полосы не торчали по краям
            const bandTop = Math.min(up - 0.5, 24.5);
            const bandBot = Math.min(down - 0.5, 24.5);
            const bandH = bandTop + bandBot;
            const bandY = aY - bandBot;
            // объединённая колонка «Наименование» (бывш. Бренд + Наименование)
            page.drawRectangle({ x: brandX - 1.5, y: bandY, width: (sizeX - brandX) + 0.5, height: bandH, color: rgbOf(ys[i].bgName) });
            const nmW = (sizeX - brandX) - 10;
            const nmLines = wrapMin2(row.name, fReg, MOD_NAME_SIZE, nmW, 3);
            const nmLh = MOD_NAME_SIZE * 1.18;
            let ty = aY + ((nmLines.length - 1) * nmLh) / 2;
            for (const ln of nmLines) {
                page.drawText(ln, { x: brandX + 5, y: ty, size: MOD_NAME_SIZE, font: fReg, color: BLACK });
                ty -= nmLh;
            }
            // колонка «Наименование из 1С» (бывш. Размер + Цвет)
            page.drawRectangle({ x: sizeX + 0.5, y: bandY, width: (articleX - sizeX) - 1.5, height: bandH, color: rgbOf(ys[i].bgSize) });
            if (row.name1c) {
                const cW = (articleX - sizeX) - 10;
                const cLines = wrapMin2(row.name1c, fReg, MOD_1C_SIZE, cW, 4);
                const cLh = MOD_1C_SIZE * 1.18;
                let cy = aY + ((cLines.length - 1) * cLh) / 2;
                for (const ln of cLines) {
                    const w = fReg.widthOfTextAtSize(ln, MOD_1C_SIZE);
                    page.drawText(ln, { x: sizeX + 5 + (cW - w) / 2, y: cy, size: MOD_1C_SIZE, font: fReg, color: BLACK });
                    cy -= cLh;
                }
            }
        }
    }
    return await doc.save();
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
            name1c: priceData.map.get(normKey(r.article)) || ''
        }));
        const rowByNum = new Map(rows.map(r => [r.num, r]));
        const noName = rows.filter(r => !r.name1c).length;
        const noLabel = rows.filter(r => !shkData.bySticker.has(normKey(r.sticker))).length;

        // ЛП-1С.pdf — правим исходный лист подбора
        setProgress(16, 'Формируем ЛП с наименованиями из 1С...', '');
        const lpBytes = await buildLpModified(listData.bytes, rows, listData.pages, rowByNum);
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
            <td>${r.article || '—'}</td>
            <td class="name-cell">${r.name || '—'}</td>
            <td class="name-cell">${r.name1c || '—'}</td>
            <td>${r.sticker ? r.sticker.replace(/(\d{4})$/, '<b>$1</b>') : '—'}</td>
        </tr>`;
    }).join('') +
    (limit < rows.length
        ? `<tr><td colspan="5" style="text-align:center; color:#86868b;">… и ещё ${rows.length - limit} строк</td></tr>`
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
