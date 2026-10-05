/* ЛП Озон с картинками и 1С
   Вход:  Лист сборки Ozon (assembly_list.pdf), этикетки Ozon (ticket.pdf),
          прайс 1С (Excel), заказы из 1С (Excel).
   Выход: Excel «Лист подбора»: № документа | № отправления | ФОТО |
          Наименование ЛК | Наименование 1С | Артикул | [Кол-во] | Стикер |
          Этикетка. Строки — по алфавиту по «Наименованию 1С»; если артикула
          нет в прайсе — название из листа сборки и жёлтая подсветка.
          «шк по порядку.pdf» — этикетки в порядке строк листа.
   Номера заказов ищутся только по «Телефон 1» (в 1С там записан номер
   отправления Ozon); если столбика нет — «ID отправления» из «Комментария». */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    '../../../assets/vendor/pdf.worker.min.js';

/* ============================ Состояние ============================ */

let listData  = null; // { rows: [{posting, name, qty, article, sticker, photo:{bytes,ext,w,h}}], name }
let shkData   = null; // { ordered: [{bytes,w,h}], pageOf: Map(номер -> [страницы]), pageToNum, pages, buffer, name }
let priceData = null; // { map: Map(артикул -> наименование), name }
let ordersData = null; // { map: Map(номер отправления -> Номер документа), keyName, name }

let built = null;   // { rows, blob, shkBlob, noDoc, noName }
let showAllMode = false;

/* ============================ Служебные ============================ */

const NUM_RE = /^\d{5,10}-\d{3,5}-\d{1,3}$/;                  // номер отправления
const LP_GLUE_RE = /^(\d{1,4})(\d{8,10}-\d{3,5}-\d{1,3})$/;   // № строки + номер (после 999-й строки)
const TICKET_GLUE_RE = /^(\d{5,10}-\d{3,5}-\d{1,3})\d{4}$/;   // номер + 4-значный код этикетки

function normKey(s) {
    return String(s == null ? '' : s).replace(/[\s\u00A0\u2007\u202F]+/g, '');
}

function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[c]));
}

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
    document.getElementById('startBtn').disabled = !(listData && shkData && priceData && ordersData);
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

/* Элемент текста pdf.js может содержать сразу несколько слов — делим на слова,
   распределяя координату x пропорционально длине подстроки. */
function itemsToWords(items) {
    const words = [];
    for (const it of items) {
        const str = it.str;
        if (!str || !str.trim()) continue;
        const x0 = it.transform[4], y = it.transform[5];
        const w = it.width || 0;
        const len = str.length;
        let i = 0;
        while (i < len) {
            while (i < len && /\s/.test(str[i])) i++;
            if (i >= len) break;
            let j = i;
            while (j < len && !/\s/.test(str[j])) j++;
            const piece = str.slice(i, j);
            words.push({
                text: piece,
                x: x0 + w * (i / len),
                w: w * ((j - i) / len),
                y: y,
                h: it.height || 0
            });
            i = j;
        }
    }
    return words;
}

/* ============================ Лист сборки (PDF) ============================ */

/* Таблица: №Номер отправления | Фото | Товар | Артикул | Кол-во | Этикетка.
   Якоря строк — номера отправлений; полосы строк — середины между якорями
   (названия по 5 строк текста центрированы в своей строке, поэтому полосы
   надёжнее «ближайшего якоря»). Фото — исходные JPEG из PDF (pdf-lib),
   привязка по координатам колонки «Фото». */
async function handleListPdf(file) {
    document.getElementById('docxFileName').textContent = file.name;
    setStatus('docxStatus', '⏳ Читаем PDF...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const bytesKeep = new Uint8Array(buf); // копия для pdf-lib — pdf.js забирает буфер себе
        const doc = await pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise;
        const rowsMap = new Map(); // номер -> строка
        const pageAnchors = [];    // pageAnchors[p-1] = [{y, row}] для привязки фото
        let dupCount = 0;

        for (let p = 1; p <= doc.numPages; p++) {
            setProgress(Math.round(2 + p / doc.numPages * 18), 'Чтение листа сборки: стр. ' + p + '/' + doc.numPages, '');
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            const words = itemsToWords(tc.items).filter(w => w.text.trim());

            // якоря — номера отправлений (левая колонка, x ≈ 45);
            // после 999-й строки № строки может склеиться с номером
            const anchors = [];
            for (const wd of words) {
                if (wd.x < 25 || wd.x >= 190) continue;
                if (NUM_RE.test(wd.text)) {
                    anchors.push({ ...wd, num: wd.text });
                } else {
                    const m = LP_GLUE_RE.exec(wd.text);
                    if (m) {
                        const frac = m[1].length / wd.text.length;
                        anchors.push({ ...wd, x: wd.x + wd.w * frac, num: m[2] });
                    }
                }
            }
            if (!anchors.length) continue;
            anchors.sort((a, b) => b.y - a.y); // сверху вниз

            // полосы строк — середины между соседними якорями
            const bands = anchors.map((a, i) => [
                i === 0 ? a.y + 30 : (anchors[i - 1].y + a.y) / 2,
                i === anchors.length - 1 ? -Infinity : (a.y + anchors[i + 1].y) / 2
            ]);

            // шапка таблицы — исключаем её слова
            const isHeader = (wd) => {
                if (!/^(Товар|Фото|Артикул|Кол-во|Этикетка|№Номер|отправления|№)$/.test(wd.text)) return false;
                return words.some(v =>
                    Math.abs(v.y - wd.y) < 3 &&
                    ((v.x >= 395 && v.x < 480) || v.x >= 480));
            };

            const cols = { name: [], article: [], qty: [], sticker: [] };
            for (const wd of words) {
                if (isHeader(wd)) continue;
                if (wd.x >= 186 && wd.x < 395) cols.name.push(wd);
                else if (wd.x >= 395 && wd.x < 480) cols.article.push(wd);
                else if (wd.x >= 480 && wd.x < 525) cols.qty.push(wd);
                else if (wd.x >= 525) cols.sticker.push(wd);
            }

            for (let i = 0; i < anchors.length; i++) {
                const a = anchors[i];
                const top = bands[i][0], bottom = bands[i][1];
                const inBand = (wd) => wd.y <= top && wd.y >= bottom;

                // название: строки колонки «Товар», сверху вниз
                const lines = new Map();
                for (const wd of cols.name) {
                    if (!inBand(wd)) continue;
                    const key = Math.round(wd.y * 2) / 2;
                    if (!lines.has(key)) lines.set(key, []);
                    lines.get(key).push(wd);
                }
                const name = [...lines.keys()].sort((x, y) => y - x)
                    .map(k => lines.get(k).sort((u, v) => u.x - v.x).map(w => w.text).join(' '))
                    .join(' ').replace(/\s+/g, ' ').trim();

                // артикул / кол-во / этикетка — ближайшее слово своей колонки
                const nearest = (arr) => {
                    let best = null, bd = Infinity;
                    for (const wd of arr) {
                        if (!inBand(wd)) continue;
                        const d = Math.abs(wd.y - a.y);
                        if (d < bd) { bd = d; best = wd; }
                    }
                    return best ? best.text.replace(/\s+/g, '') : '';
                };
                const article = nearest(cols.article);
                const sticker = nearest(cols.sticker);

                if (rowsMap.has(a.num)) {
                    dupCount++;
                    const ex = rowsMap.get(a.num);
                    if (!ex.name && name) ex.name = name;
                    if (!ex.article && article) ex.article = article;
                    if (!ex.sticker && sticker) ex.sticker = sticker;
                } else if (article && sticker) {
                    rowsMap.set(a.num, {
                        posting: a.num, name: name, qty: nearest(cols.qty),
                        article: article, sticker: sticker, photo: null
                    });
                }
            }
            // якоря этой страницы с их строками — для привязки фото
            pageAnchors[p - 1] = anchors
                .map(a => ({ y: a.y, row: rowsMap.get(a.num) }))
                .filter(x => x.row);
        }

        const rows = [...rowsMap.values()];
        if (!rows.length) throw new Error('не нашли ни одного отправления в PDF');
        setProgress(22, 'Достаём фото из PDF...', '');

        // фото: исходные JPEG из PDF, колонка «Фото» (x ≈ 145..190)
        const pdfDoc = await PDFLib.PDFDocument.load(bytesKeep, { ignoreEncryption: true });
        const imgCache = new Map();
        const imageOf = (obj) => {
            if (imgCache.has(obj)) return imgCache.get(obj);
            let res = null;
            try {
                const filter = obj.dict.lookup(PDFLib.PDFName.of('Filter'));
                // DCTDecode: сырые байты потока — это готовый JPEG
                if (filter && filter.toString().indexOf('DCTDecode') !== -1 && obj.contents) {
                    res = {
                        bytes: obj.contents,
                        ext: 'jpg',
                        w: obj.dict.lookup(PDFLib.PDFName.of('Width')).asNumber(),
                        h: obj.dict.lookup(PDFLib.PDFName.of('Height')).asNumber()
                    };
                }
            } catch (e) { res = null; }
            imgCache.set(obj, res);
            return res;
        };
        for (let p = 0; p < pdfDoc.getPageCount(); p++) {
            const geo = pageAnchors[p];
            if (!geo || !geo.length) continue;
            const page = pdfDoc.getPage(p);
            const nameToObj = new Map();
            const res = page.node.Resources();
            const xo = res ? res.lookup(PDFLib.PDFName.of('XObject')) : null;
            if (xo && xo.entries) {
                for (const entry of xo.entries()) {
                    const obj = pdfDoc.context.lookup(entry[1]);
                    if (obj && obj.dict) nameToObj.set(entry[0].toString(), obj);
                }
            }
            if (!nameToObj.size) continue;
            const content = pageContent(pdfDoc, page);
            const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm\s*\/(\w+)\s+Do/g;
            let m;
            while ((m = re.exec(content)) !== null) {
                const obj = nameToObj.get('/' + m[7]);
                if (!obj) continue;
                const iw = +m[1], ih = +m[4], ix = +m[5], iy = +m[6];
                const cx = ix + iw / 2, cy = iy + ih / 2;
                if (cx < 120 || cx > 230) continue; // не колонка «Фото»
                let best = null, bd = Infinity;
                for (const a of geo) {
                    const d2 = Math.abs(a.y - cy);
                    if (d2 < bd) { bd = d2; best = a; }
                }
                if (!best || bd > 26 || best.row.photo) continue;
                best.row.photo = imageOf(obj);
            }
        }
        listData = { rows: rows, name: file.name };
        setStatus('docxStatus', `✅ Строк: ${rows.length} (фото: ${rows.filter(r => r.photo).length})` + (dupCount ? `, повторов: ${dupCount}` : ''), 'success');
    } catch (err) {
        listData = null;
        setStatus('docxStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* Декодирует поток содержимого страницы в строку (latin1) */
function pageContent(doc, page) {
    const dec = (s) => {
        try { return PDFLib.decodePDFRawStream(s).decode(); }
        catch (e) { return new Uint8Array(0); }
    };
    const parts = [];
    const c = page.node.Contents();
    if (c instanceof PDFLib.PDFArray) {
        for (let i = 0; i < c.size(); i++) parts.push(dec(doc.context.lookup(c.get(i))));
    } else if (c) {
        const s = doc.context.lookup(c);
        if (s) parts.push(dec(s));
    }
    let len = 0;
    parts.forEach(p2 => len += p2.length);
    let str = '';
    parts.forEach(p2 => {
        for (let i = 0; i < p2.length; i++) str += String.fromCharCode(p2[i]);
    });
    return str;
}

/* ============================ Этикетки (PDF) ============================ */

/* Номер отправления со страницы этикетки: точное совпадение элемента текста,
   затем склейка «номер + 4-значный код», затем склейка в общем тексте. */
function postingFromPage(tc) {
    for (const it of tc.items) {
        const t = (it.str || '').trim();
        if (NUM_RE.test(t)) return t;
    }
    for (const it of tc.items) {
        const t = (it.str || '').trim();
        const m = TICKET_GLUE_RE.exec(t);
        if (m) return m[1];
    }
    const joined = tc.items.map(i => (i.str || '')).join('').replace(/\s+/g, '');
    const m = /(\d{5,10}-\d{3,5}-\d{1,3})\d{0,4}/.exec(joined);
    return m ? m[1] : null;
}

/* Картинки этикеток: рендерим страницы в PNG и запоминаем, какое отправление
   напечатано на каждой странице — по нему этикетки расставляются по строкам
   листа и собирается «шк по порядку». */
async function handleShk(file) {
    document.getElementById('shkFileName').textContent = file.name;
    setStatus('shkStatus', '⏳ Рендерим этикетки...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const bytesKeep = new Uint8Array(buf); // копия для pdf-lib
        // disableFontFace: встроенные шрифты этикеток вешают рендер pdf.js —
        // рисуем системными шрифтами (ШК/QR от этого не зависят)
        const doc = await pdfjsLib.getDocument({ data: buf, disableFontFace: true }).promise;
        const ordered = [];
        const pageOf = new Map();     // номер отправления -> [страницы, с 1]
        const pageToNum = new Map();  // страница -> номер
        let noNum = 0;
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const vp = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            const ctx2 = canvas.getContext('2d', { alpha: false });
            ctx2.fillStyle = '#ffffff';
            ctx2.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx2, viewport: vp }).promise;
            const dataUrl = canvas.toDataURL('image/png');
            ordered.push({
                bytes: Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)),
                w: canvas.width, h: canvas.height
            });
            const tc = await page.getTextContent();
            const num = postingFromPage(tc);
            if (num) {
                if (!pageOf.has(num)) pageOf.set(num, []);
                pageOf.get(num).push(p);
                pageToNum.set(p, num);
            } else {
                noNum++;
            }
            setProgress(Math.round(p / doc.numPages * 60) + 30, 'Рендер этикеток: ' + p + '/' + doc.numPages, '');
            if (p % 10 === 0) await new Promise(r => setTimeout(r, 0));
        }
        shkData = { ordered, pageOf, pageToNum, pages: doc.numPages, buffer: bytesKeep, name: file.name };
        setStatus('shkStatus', `✅ Этикеток: ${ordered.length} (с номером: ${pageOf.size}` + (noNum ? `, без номера: ${noNum}` : '') + ')', 'success');
    } catch (err) {
        shkData = null;
        setStatus('shkStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* «шк по порядку»: страницы этикеток в порядке строк листа,
   остальные — в конец */
async function buildShkPdf(rows, shk) {
    const src = await PDFLib.PDFDocument.load(shk.buffer, { ignoreEncryption: true });
    const pageOf = new Map();
    shk.pageOf.forEach((list, num) => pageOf.set(num, list.slice())); // копия — shift()
    const order = [];
    const used = new Set();
    for (const r of rows) {
        const q = pageOf.get(r.posting);
        if (q && q.length) {
            const pg = q.shift();
            order.push(pg - 1);
            used.add(pg - 1);
        }
    }
    const rest = [];
    for (let i = 0; i < src.getPageCount(); i++) if (!used.has(i)) rest.push(i);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, order.concat(rest));
    pages.forEach(p => out.addPage(p));
    return await out.save();
}

/* Прайс: сами находим колонки «артикул» и «наименование» — формат файла
   плавает: колонки переезжают, сверху появляются шапки и логотипы.
   1) шапка: в строке есть «артикул/арт/код» и «наименование/товар/название»;
   2) без шапки: колонка артикулов — самая «числовая», в которой числа НЕ идут
      подряд (иначе это колонка «№»); названия — колонка с длинным текстом. */
function buildPriceMap(grid) {
    const norm = (v) => typeof v === 'number' ? String(Math.round(v)) : normKey(v);
    const artLike = (s) => /^\d{4,10}$/.test(s);
    const nameLike = (s) => s.length >= 5 && /[А-Яа-яЁёA-Za-z]/.test(s);
    const headArt = (s) => /^(артикул|арт|код)/.test(s);
    const headName = (s) => /^(наименован|товар|название|номенклатур)/.test(s);

    let artCol = -1, nameCol = -1, start = 0;
    for (let i = 0; i < Math.min(grid.length, 15) && artCol === -1; i++) {
        const heads = grid[i].map(c => normKey(c).toLowerCase());
        const a = heads.findIndex(h => h && headArt(h));
        if (a === -1) continue;
        const n = heads.findIndex(h => h && headName(h));
        if (n !== -1 && n !== a) { artCol = a; nameCol = n; start = i + 1; }
    }

    if (artCol === -1) {
        const scan = Math.min(grid.length, 80);
        let maxC = 0;
        for (let i = 0; i < scan; i++) maxC = Math.max(maxC, grid[i].length);
        maxC = Math.min(maxC, 12);
        const artCnt = new Array(maxC).fill(0);
        const seqCnt = new Array(maxC).fill(0);
        const nameCnt = new Array(maxC).fill(0);
        for (let c = 0; c < maxC; c++) {
            let prev = null;
            for (let i = 0; i < scan; i++) {
                const s = norm(grid[i][c]);
                if (artLike(s)) {
                    artCnt[c]++;
                    const n = parseInt(s, 10);
                    if (prev != null && n === prev + 1) seqCnt[c]++;
                    prev = n;
                } else prev = null;
                if (nameLike(String(grid[i][c] == null ? '' : grid[i][c]).trim())) nameCnt[c]++;
            }
        }
        for (let c = 0; c < maxC; c++)
            if (artCnt[c] >= 5 && seqCnt[c] <= artCnt[c] * 0.6 &&
                (artCol === -1 || artCnt[c] > artCnt[artCol]))
                artCol = c;
        for (let c = 0; c < maxC; c++)
            if (c !== artCol && nameCnt[c] >= 5 &&
                (nameCol === -1 || nameCnt[c] > nameCnt[nameCol]))
                nameCol = c;
        if (artCol !== -1 && nameCol !== -1) {
            start = grid.findIndex(r => artCol < r.length && artLike(norm(r[artCol])) &&
                                       nameCol < r.length &&
                                       nameLike(String(r[nameCol] == null ? '' : r[nameCol]).trim()));
            if (start === -1) start = 0;
        }
    }

    if (artCol === -1 || nameCol === -1 || nameCol === artCol) {
        artCol = 0; nameCol = 1; start = 0;   // запасной путь — как раньше
    }

    const map = new Map();
    let dup = 0;
    for (let i = start; i < grid.length; i++) {
        const r = grid[i];
        const art = norm(r[artCol]);
        const nm = String(r[nameCol] == null ? '' : r[nameCol]).trim();
        if (art && nm) {
            if (!map.has(art)) map.set(art, nm); else dup++;
        }
    }
    return { map: map, dup: dup };
}

/* ============================ Прайс 1С (Excel) ============================ */

/* Первый столбик — артикул (код), второй — наименование */
async function handlePrice(file) {
    document.getElementById('priceFileName').textContent = file.name;
    setStatus('priceStatus', '⏳ Чтение файла...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('в файле нет таблиц');
        // raw: true — артикул-число берём как число: в форматированном тексте
        // бывают разделители разрядов («442,885»), из-за них ключ не совпадает
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        const { map, dup } = buildPriceMap(grid);
        if (!map.size) throw new Error('в прайсе не нашлось пар «артикул + название»');
        priceData = { map: map, name: file.name };
        setStatus('priceStatus', `✅ Товаров в прайсе: ${map.size}` + (dup ? ` (пропущено повторов: ${dup})` : ''), 'success');
    } catch (err) {
        priceData = null;
        setStatus('priceStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Заказы из 1С (Excel) ============================ */

/* Номер отправления -> «Номер документа». Сначала столбик «Телефон 1» /
   «Телефон1» (в 1С там записан номер отправления Ozon) — ТОЛЬКО он.
   Если столбика нет (или он пуст) — «ID отправления: …» из «Комментария». */
async function handleOrders(file) {
    document.getElementById('ordersFileName').textContent = file.name;
    setStatus('ordersStatus', '⏳ Чтение файла...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'array' });
        const cellStr = (v) => (typeof v === 'number' ? String(Math.round(v)) : String(v == null ? '' : v).trim());
        let found = null;
        for (const sn of wb.SheetNames) {
            const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
            for (let i = 0; i < Math.min(grid.length, 15) && !found; i++) {
                const cells = grid[i].map(h => cellStr(h));
                const low = cells.map(h => h.replace(/[\s\u00A0]+/g, '').toLowerCase());
                const docIdx = low.findIndex(h => h.indexOf('номердокумента') !== -1 || h === '№документа');
                if (docIdx === -1) continue;
                const phoneIdx = low.findIndex(h => h.indexOf('телефон') === 0);
                const commentIdx = low.findIndex(h => h === 'комментарий');
                if (phoneIdx === -1 && commentIdx === -1) continue;
                found = { grid, headerIdx: i, docIdx, phoneIdx, commentIdx };
            }
            if (found) break;
        }
        if (!found) throw new Error('в файле нет «Номера документа» и столбика «Телефон 1» (или «Комментария»)');

        const map = new Map();
        let keyName = 'Телефон 1';
        if (found.phoneIdx !== -1) {
            for (let i = found.headerIdx + 1; i < found.grid.length; i++) {
                const r = found.grid[i];
                const mp = normKey(cellStr(r[found.phoneIdx])).replace(/\.0$/, '');
                const dn = cellStr(r[found.docIdx]);
                if (mp && dn && !map.has(mp)) map.set(mp, dn);
            }
        }
        if (!map.size && found.commentIdx !== -1) {
            keyName = 'Комментарий (ID отправления)';
            for (let i = found.headerIdx + 1; i < found.grid.length; i++) {
                const r = found.grid[i];
                const m = /ID\s*отправления:\s*([0-9][0-9-]*)/i.exec(cellStr(r[found.commentIdx]));
                const dn = cellStr(r[found.docIdx]);
                if (m && dn && !map.has(normKey(m[1]))) map.set(normKey(m[1]), dn);
            }
        }
        if (!map.size) {
            throw new Error('не нашли пар «номер отправления + номер документа»: проверьте столбики «Телефон 1» и «Номер документа»');
        }
        ordersData = { map: map, keyName: keyName, name: file.name };
        setStatus('ordersStatus', `✅ Заказов: ${map.size} (по «${keyName}»)`, 'success');
    } catch (err) {
        ordersData = null;
        setStatus('ordersStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* Размеры картинки из байтов (если PDF не подсказал) */
function imageSize(bytes, ext) {
    try {
        if (ext === 'png') {
            return { w: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0,
                     h: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0 };
        }
        if (ext === 'jpg' || ext === 'jpeg') {
            for (let i = 2; i < bytes.length - 9;) {
                if (bytes[i] !== 0xFF) { i++; continue; }
                const marker = bytes[i + 1];
                if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
                    return { h: bytes[i + 5] << 8 | bytes[i + 6], w: bytes[i + 7] << 8 | bytes[i + 8] };
                }
                i += 2 + (bytes[i + 2] << 8 | bytes[i + 3]);
            }
        }
    } catch (e) { /* не разобрались — возьмём стандартный размер */ }
    return { w: 90, h: 110 };
}

/* ============================ Генерация Excel ============================ */

/* Колонки: A № документа (14) | B № отправления (17.5) | C ФОТО (11) |
   D Наименование ЛК (30) | E Наименование 1С (30) | F Артикул (9.75) |
   [G Кол-во (7.5) — только если где-то не 1] | Стикер (10) | Этикетка (21.2) */
const LP_HEAD = 'FF404040';

function colLetter(i) { return String.fromCharCode(65 + i); }

function buildLpXlsx(rows) {
    const zip = new JSZip();

    // Кол-во вставляем перед «Стикером» только если есть не-1
    const withQty = rows.some(r => r.qty && r.qty !== '1');
    const HEADERS = ['№  документа', '№ отправления', 'ФОТО', 'Наименование ЛК',
                     'Наименование 1С', 'Артикул'];
    if (withQty) HEADERS.push('Кол-во');
    HEADERS.push('Стикер', 'Этикетка');
    const widths = [14, 17.5, 11, 30, 30, 9.75];
    if (withQty) widths.push(7.5);
    widths.push(10, 21.2);
    const artCol = HEADERS.indexOf('Артикул');
    const qtyCol = withQty ? HEADERS.indexOf('Кол-во') : -1;
    const stkCol = HEADERS.indexOf('Стикер');
    const lblCol = HEADERS.indexOf('Этикетка');
    const lastCol = HEADERS.length;

    // Картинки: фото (col C) — высота 100 px; этикетка — высота 100 px
    const imgs = [];
    rows.forEach((r, i) => {
        if (r.photo) {
            const dim = (r.photo.w && r.photo.h) ? { w: r.photo.w, h: r.photo.h } : imageSize(r.photo.bytes, r.photo.ext);
            const k = 100 / dim.h;
            imgs.push({ row0: i + 1, col: 2, bytes: r.photo.bytes, ext: r.photo.ext,
                        w: Math.round(dim.w * k), h: 100, rowOff: 4 });
        }
        if (r.label) {
            const k = 100 / r.label.h;
            imgs.push({ row0: i + 1, col: lblCol, bytes: r.label.bytes, ext: 'png',
                        w: Math.round(r.label.w * k), h: 100, rowOff: 4 });
        }
    });
    const hasJpg = imgs.some(im => im.ext === 'jpg' || im.ext === 'jpeg');
    const hasPng = imgs.some(im => im.ext === 'png');

    zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        (hasJpg ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '') +
        (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : '') +
        (imgs.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
        '</Types>');

    zip.file('_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>');

    zip.file('xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Лист подбора" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>');

    zip.file('xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>');

    if (imgs.length) {
        zip.file('xl/worksheets/_rels/sheet1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
            '</Relationships>');
        let rels = '', anchors = '';
        imgs.forEach((im, k) => {
            const name = 'image' + (k + 1) + '.' + (im.ext === 'jpeg' ? 'jpg' : im.ext);
            zip.file('xl/media/' + name, im.bytes);
            rels += '<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + name + '"/>';
            anchors +=
                '<xdr:oneCellAnchor>' +
                '<xdr:from><xdr:col>' + im.col + '</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>' + im.row0 + '</xdr:row><xdr:rowOff>' + Math.round((im.rowOff || 2) * 9525) + '</xdr:rowOff></xdr:from>' +
                '<xdr:ext cx="' + Math.round(im.w * 9525) + '" cy="' + Math.round(im.h * 9525) + '"/>' +
                '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Картинка ' + (k + 1) + '"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
                '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId' + (k + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
                '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + Math.round(im.w * 9525) + '" cy="' + Math.round(im.h * 9525) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
                '<xdr:clientData/></xdr:oneCellAnchor>';
        });
        zip.file('xl/drawings/drawing1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors + '</xdr:wsDr>');
        zip.file('xl/drawings/_rels/drawing1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>');
    }

    zip.file('xl/styles.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="3">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FF1D1D1F"/><name val="Calibri"/></font>' +
        '</fonts>' +
        '<fills count="5">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        `<fill><patternFill patternType="solid"><fgColor rgb="${LP_HEAD}"/><bgColor indexed="64"/></patternFill></fill>` +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>' +
        '</fills>' +
        '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' +
        '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="9">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>');

    const n = rows.length;
    const lastRef = colLetter(lastCol - 1) + (n + 1);
    let sheet =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        `<dimension ref="A1:${lastRef}"/>` +
        '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        '<cols>' +
        widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') +
        '</cols>' +
        '<sheetData>';

    const cellText = (col, rowIdx, value, s) =>
        `<c r="${col}${rowIdx}" s="${s == null ? 2 : s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    const cellEmpty = (col, rowIdx, s) => `<c r="${col}${rowIdx}" s="${s == null ? 2 : s}"/>`;
    const cellNumber = (col, rowIdx, value, s) =>
        `<c r="${col}${rowIdx}" s="${s == null ? 3 : s}"><v>${escapeXml(value)}</v></c>`;
    // Стикер озона — 4 цифры, пишем их жирными
    const cellSticker = (col, rowIdx, value, s) => {
        const rpr = `<rPr><b/><sz val="14"/><rFont val="Calibri"/></rPr>`;
        return `<c r="${col}${rowIdx}" s="${s == null ? 3 : s}" t="inlineStr"><is>` +
            `<r>${rpr}<t xml:space="preserve">${escapeXml(value)}</t></r>` +
            `</is></c>`;
    };

    sheet += `<row r="1" ht="24" customHeight="1">` +
        HEADERS.map((h, i) => `<c r="${colLetter(i)}1" s="1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`).join('') +
        `</row>`;

    // серые полосы по блокам одинаковых наименований (чередование при смене)
    let band = false, prevKey = null;
    rows.forEach((r, i) => {
        const key = r.name1c || r.name || '';
        if (key !== prevKey) { band = !band; prevKey = key; }
        const sBody = band ? 6 : 2, sCenter = band ? 7 : 3, sName = band ? 8 : 4;
        const rn = i + 2;
        sheet += `<row r="${rn}"${(r.photo || r.label) ? ' ht="82" customHeight="1"' : ''}>`;
        sheet += cellText('A', rn, r.docNum || '', sBody);
        sheet += cellText('B', rn, r.posting, sBody);
        sheet += cellEmpty('C', rn, sBody); // фото — картинкой
        sheet += cellText('D', rn, r.name || '', sBody);
        sheet += `<c r="E${rn}" s="${r.miss ? 5 : sName}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(r.name1c || '')}</t></is></c>`;
        if (/^\d+$/.test(r.article)) sheet += cellNumber(colLetter(artCol), rn, r.article, sCenter);
        else sheet += cellText(colLetter(artCol), rn, r.article || '', sBody);
        if (withQty) {
            if (/^\d+$/.test(r.qty || '')) sheet += cellNumber(colLetter(qtyCol), rn, r.qty, sCenter);
            else if (r.qty) sheet += cellText(colLetter(qtyCol), rn, r.qty, sBody);
            else sheet += cellEmpty(colLetter(qtyCol), rn, sBody);
        }
        if (r.sticker) sheet += cellSticker(colLetter(stkCol), rn, r.sticker, sCenter);
        else sheet += cellEmpty(colLetter(stkCol), rn, sBody);
        sheet += cellEmpty(colLetter(lblCol), rn, sBody); // этикетка — картинкой
        sheet += `</row>`;
    });

    sheet += `</sheetData><autoFilter ref="A1:${lastRef}"/>`;
    sheet += '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
    sheet += '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
    sheet += '<headerFooter><oddFooter>&amp;R&amp;8стр. &amp;P из &amp;N</oddFooter></headerFooter>';
    if (imgs.length) sheet += '<drawing r:id="rId1"/>';
    sheet += '</worksheet>';
    zip.file('xl/worksheets/sheet1.xml', sheet);

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/* ============================ Сборка ============================ */

async function startBuild() {
    if (!(listData && shkData && priceData && ordersData)) return;
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('warningsSection').classList.add('hidden');
    document.getElementById('progressSection').classList.remove('hidden');
    setProgress(0, 'Обработка...', '');

    try {
        setProgress(10, 'Собираем строки...', '');
        await new Promise(r => setTimeout(r, 30));
        const rows = listData.rows.map((r, idx) => {
            const oneC = priceData.map.get(normKey(r.article)) || '';
            return {
                posting: r.posting,
                name: r.name,
                qty: r.qty,
                article: r.article,
                sticker: r.sticker,
                photo: r.photo,
                origIdx: idx,
                name1c: oneC || r.name,   // нет в прайсе — название из листа сборки
                miss: !oneC,              // и жёлтая подсветка
                docNum: ordersData.map.get(normKey(r.posting)) || '',
                label: null
            };
        });
        // сортировка по алфавиту по «Наименованию 1С» (при равных — порядок листа)
        rows.sort((a, b) =>
            a.name1c.toLowerCase().localeCompare(b.name1c.toLowerCase(), 'ru') ||
            a.origIdx - b.origIdx);

        // этикетки: страницы в порядке строк листа (после сортировки)
        const pageOf = new Map();
        shkData.pageOf.forEach((list, num) => pageOf.set(num, list.slice()));
        const usedPages = new Set();
        const missingLabels = [];
        for (const r of rows) {
            const q = pageOf.get(r.posting);
            if (q && q.length) {
                const pg = q.shift();
                usedPages.add(pg);
                r.label = shkData.ordered[pg - 1] || null;
            }
            if (!r.label) missingLabels.push(r.posting);
        }
        const extraPages = [];
        const extraNums = [];
        for (let p = 1; p <= shkData.pages; p++) {
            if (!usedPages.has(p)) { extraPages.push(p); extraNums.push(shkData.pageToNum.get(p) || ('стр. ' + p)); }
        }

        const noDoc = rows.filter(r => !r.docNum).length;
        const noName = rows.filter(r => r.miss).length;
        const noPhoto = rows.filter(r => !r.photo).length;
        const noLabel = missingLabels.length;

        setProgress(15, 'Формируем Excel...', '');
        const blob = await buildLpXlsx(rows);
        setProgress(85, 'Excel готов', '');

        // «шк по порядку» — страницы этикеток в порядке строк листа
        setProgress(88, 'Собираем «шк по порядку»...', '');
        const shkBytes = await buildShkPdf(rows, shkData);
        const shkBlob = new Blob([shkBytes], { type: 'application/octet-stream' }); // octet-stream — принудительное скачивание
        setProgress(100, 'Готово!', `Строк: ${rows.length} | С номером документа: ${rows.length - noDoc} | Из прайса: ${rows.length - noName} | С фото: ${rows.length - noPhoto} | С этикеткой: ${rows.length - noLabel}`);

        built = { rows, blob, shkBlob, noDoc, noName, noPhoto, noLabel, extraNums };
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
    const { rows, noDoc, noName, noPhoto, noLabel, extraNums } = built;

    document.getElementById('summary').innerHTML = `
        <div class="summary-card ok">
            <span class="num">${rows.length}</span>
            <div class="lbl">Строк в листе</div>
        </div>
        <div class="summary-card ${noDoc ? 'warn' : 'ok'}">
            <span class="num">${rows.length - noDoc}</span>
            <div class="lbl">С номером документа</div>
        </div>
        <div class="summary-card ${noName ? 'warn' : 'ok'}">
            <span class="num">${rows.length - noName}</span>
            <div class="lbl">Наименований из 1С</div>
        </div>
        <div class="summary-card ok">
            <span class="num">${rows.filter(r => r.photo).length}</span>
            <div class="lbl">С фото товара</div>
        </div>
    `;

    let warnHtml = '';
    if (noDoc) {
        const nums = rows.filter(r => !r.docNum).map(r => r.posting).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noDoc} отправлени(й) без «Номера документа»</strong> — не нашлись в заказах 1С по «${ordersData.keyName}»: ${nums}${noDoc > 10 ? ' …' : ''}</p>`;
    }
    if (noName) {
        const arts = rows.filter(r => r.miss).map(r => r.article).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noName} артикул(ов) не нашлось в прайсе</strong> — в «Наименовании 1С» оставлено наименование из листа сборки, строки подсвечены жёлтым: ${arts}${noName > 10 ? ' …' : ''}</p>`;
    }
    if (noPhoto) {
        warnHtml += `<p><strong>ℹ️ ${noPhoto} строк(ы) без фото товара</strong> — в PDF не нашлась картинка для этих строк.</p>`;
    }
    if (noLabel) {
        const nums = rows.filter(r => !r.label).map(r => r.posting).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noLabel} строк(и) без этикетки</strong> — отправление не нашлось в файле этикеток: ${nums}${noLabel > 10 ? ' …' : ''}</p>`;
    }
    if (extraNums.length) {
        warnHtml += `<p><strong>ℹ️ Этикеток (${shkData.pages}) больше, чем строк (${rows.length})</strong> — лишние (${extraNums.slice(0, 10).join(', ')}${extraNums.length > 10 ? ' …' : ''}) добавлены в конец файла «шк по порядку».</p>`;
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

    document.getElementById('downloadBtn').disabled = false;
    document.getElementById('downloadShkBtn').disabled = false;

    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function renderPreview() {
    const { rows } = built;
    const limit = showAllMode ? rows.length : Math.min(rows.length, 100);
    document.getElementById('resultsBody').innerHTML = rows.slice(0, limit).map(r => `
        <tr class="${r.miss ? 'from-lp' : ''}">
            <td>${r.docNum || '—'}</td>
            <td>${r.posting}</td>
            <td class="name-cell">${r.name || '—'}</td>
            <td class="name-cell">${r.name1c || '—'}</td>
            <td>${r.article || '—'}</td>
            <td><b>${r.sticker || '—'}</b></td>
            <td>${r.photo ? '✓' : '—'}</td>
        </tr>`).join('') +
    (limit < rows.length
        ? `<tr><td colspan="7" style="text-align:center; color:#86868b;">… и ещё ${rows.length - limit} строк</td></tr>`
        : '');
}

function showAllRows() {
    showAllMode = true;
    renderPreview();
    document.getElementById('showAllBtn').classList.add('hidden');
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);   // часть движков игнорирует клик по «висячей» ссылке
    a.click();
    setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
    }, 2000);
}

/* ============================ Инициализация ============================ */

document.getElementById('downloadBtn').addEventListener('click', () => {
    if (!built || !built.blob) { alert('Сначала нажмите «СОБРАТЬ ЛИСТ ПОДОБРА»'); return; }
    download(built.blob, 'Лист подбора.xlsx');
});
document.getElementById('downloadShkBtn').addEventListener('click', () => {
    if (!built || !built.shkBlob) { alert('Сначала нажмите «СОБРАТЬ ЛИСТ ПОДОБРА»'); return; }
    download(built.shkBlob, 'шк по порядку.pdf');
});

wireUpload('docxUploadArea', 'docxFileInput', handleListPdf);
wireUpload('shkUploadArea', 'shkFileInput', handleShk);
wireUpload('priceUploadArea', 'priceFileInput', handlePrice);
wireUpload('ordersUploadArea', 'ordersFileInput', handleOrders);
