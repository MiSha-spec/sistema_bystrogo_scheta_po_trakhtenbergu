/* Лист подбора ВБ (LP) — версия «печатный PDF + прайс 1С + этикетки»
   Вход:  печатный Лист подбора (PDF) — номера, наименования, артикулы, стикеры;
          этикетки (PDF) — картинки в колонку «Этикетка»;
          прайс 1С (Excel) — «Наименование из 1С» по артикулу.
   Выход: LP.xlsx — как прежний Лист подбора (рамки блоков, полосы, жирный
          хвост стикера) + столбик из 1С + картинки этикеток. */

/* ============================ Состояние ============================ */

let printedData = null; // { map: Map(№ -> {num, name, article, sticker}), name }
let labelsData  = null; // { bySticker: Map(стикер -> png), ordered: [png], name }
let priceData   = null; // { map: Map(артикул -> наименование), name }

let built = null;   // { rows, blob, noName, noLabel }
let showAllMode = false;

/* ============================ Служебные ============================ */

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
    document.getElementById('startBtn').disabled = !(printedData && labelsData && priceData);
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

/* ============================ Генерация LP.xlsx ============================ */

// Оформление в стиле «умной таблицы» (дружелюбно к чёрно-белой печати):
//   шапка — тёмная с белым жирным текстом, закреплена, с автофильтром;
//   блоки одинаковых товаров чередуются белой/серой заливкой (видно и на экране,
//   и при ч/б печати) и обведены жирной рамкой (слева/справа толстые всегда,
//   сверху/снизу толстые только по краям блока);
//   стикер — по центру, последние 4 цифры жирным;
//   ширины: 15 / 15 / 65 / 45 / 20 / 24.
const LP_BAND = 'FFD9D9D9';   // серая полоса блока (печатается как светло-серый)
const LP_HEAD = 'FF404040';   // тёмная шапка

function buildLpXlsx(rows) {
    const zip = new JSZip();

    // Картинки этикеток: список { row0, bytes, w, h } — заполняется ниже
    const imgs = [];
    rows.forEach((r, i) => { if (r.label) imgs.push({ row0: i + 1, bytes: r.label.bytes, w: r.label.w, h: r.label.h }); });

    zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        (imgs.length ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
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
            zip.file('xl/media/image' + (k + 1) + '.png', im.bytes);
            rels += '<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (k + 1) + '.png"/>';
            anchors +=
                '<xdr:oneCellAnchor>' +
                '<xdr:from><xdr:col>5</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>' + im.row0 + '</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>' +
                '<xdr:ext cx="' + (im.w * 9525) + '" cy="' + (im.h * 9525) + '"/>' +
                '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Этикетка ' + (k + 1) + '"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
                '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId' + (k + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
                '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + (im.w * 9525) + '" cy="' + (im.h * 9525) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
                '<xdr:clientData/></xdr:oneCellAnchor>';
        });
        zip.file('xl/drawings/drawing1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors + '</xdr:wsDr>');
        zip.file('xl/drawings/_rels/drawing1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>');
    }

    // Рамки блока: 2 = тонкие сверху/снизу (внутри блока), 3 = толстый верх,
    // 4 = толстый низ, 5 = толстые верх и низ (одиночная строка).
    // Слева и справа всегда толстые.
    const blockBorder = (topStyle, bottomStyle) =>
        `<border><left style="thick"><color indexed="64"/></left>` +
        `<right style="thick"><color indexed="64"/></right>` +
        `<top style="${topStyle}"><color indexed="64"/></top>` +
        `<bottom style="${bottomStyle}"><color indexed="64"/></bottom><diagonal/></border>`;

    // Стили данных: s = 2 + рамка(0..3) + полоса(+4) + стикер по центру(+8)
    let xfs =
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 обычная
        // 1 шапка: белый жирный текст на тёмной заливке, по центру
        '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>';
    for (let center = 0; center <= 1; center++) {
        for (let band = 0; band <= 1; band++) {
            for (let b = 0; b <= 3; b++) {
                const fill = band ? 3 : 0;
                const align = center ? '<alignment horizontal="center"/>' : '';
                const flags = 'applyBorder="1"' +
                    (fill ? ' applyFill="1"' : '') +
                    (center ? ' applyAlignment="1"' : '');
                xfs += `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="${b + 2}" xfId="0" ${flags}>${align}</xf>`;
            }
        }
    }

    zip.file('xl/styles.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '</fonts>' +
        '<fills count="5">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>' +
        `<fill><patternFill patternType="solid"><fgColor rgb="${LP_BAND}"/><bgColor indexed="64"/></patternFill></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="${LP_HEAD}"/><bgColor indexed="64"/></patternFill></fill>` +
        '</fills>' +
        '<borders count="6">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' +
        blockBorder('thin', 'thin') +
        blockBorder('thick', 'thin') +
        blockBorder('thin', 'thick') +
        blockBorder('thick', 'thick') +
        '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + (2 + 16) + '">' + xfs + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>');

    const n = rows.length;
    let sheet =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<dimension ref="A1:F${n + 1}"/>` +
        '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        '<cols>' +
        '<col min="1" max="1" width="15" customWidth="1"/>' +
        '<col min="2" max="2" width="15" customWidth="1"/>' +
        '<col min="3" max="3" width="65" customWidth="1"/>' +
        '<col min="4" max="4" width="45" customWidth="1"/>' +
        '<col min="5" max="5" width="20" customWidth="1"/>' +
        '<col min="6" max="6" width="24" customWidth="1"/>' +
        '</cols>' +
        '<sheetData>';

    // Границы блоков одинаковых наименований + чередование полос по блокам
    const blockKind = new Array(n); // 0 = внутри, 1 = первый, 2 = последний, 3 = единственный
    const blockBand = new Array(n); // true = серая полоса
    if (n > 0) {
        let start = 0;
        let current = rows[0].name;
        let band = false;
        for (let i = 1; i <= n; i++) {
            const nm = i < n ? rows[i].name : '\u0000нет\u0000';
            if (nm !== current) {
                const end = i - 1;
                band = !band;
                for (let r = start; r <= end; r++) {
                    blockKind[r] = (r === start ? 1 : 0) | (r === end ? 2 : 0);
                    blockBand[r] = band;
                }
                start = i;
                current = nm;
            }
        }
    }

    const cellText = (col, rowIdx, value, style) =>
        `<c r="${col}${rowIdx}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    const cellEmpty = (col, rowIdx, style) =>
        `<c r="${col}${rowIdx}" s="${style}"/>`;
    const cellNumber = (col, rowIdx, value, style) =>
        `<c r="${col}${rowIdx}" s="${style}"><v>${escapeXml(value)}</v></c>`;
    // Стикер: основная часть обычным шрифтом, последние 4 цифры жирным
    const cellSticker = (col, rowIdx, value, style) => {
        const main = value.slice(0, -4);
        const last4 = value.slice(-4);
        const rpr = (bold) => `<rPr>${bold ? '<b/>' : ''}<sz val="11"/><rFont val="Calibri"/></rPr>`;
        return `<c r="${col}${rowIdx}" s="${style}" t="inlineStr"><is>` +
            `<r>${rpr(false)}<t xml:space="preserve">${escapeXml(main)}</t></r>` +
            `<r>${rpr(true)}<t xml:space="preserve">${escapeXml(last4)}</t></r>` +
            `</is></c>`;
    };

    sheet += `<row r="1">` +
        `<c r="A1" s="1" t="inlineStr"><is><t>№ задания</t></is></c>` +
        `<c r="B1" s="1" t="inlineStr"><is><t>Артикул</t></is></c>` +
        `<c r="C1" s="1" t="inlineStr"><is><t>Наименование</t></is></c>` +
        `<c r="D1" s="1" t="inlineStr"><is><t>Наименование из 1С</t></is></c>` +
        `<c r="E1" s="1" t="inlineStr"><is><t>Стикер</t></is></c>` +
        `<c r="F1" s="1" t="inlineStr"><is><t>Этикетка</t></is></c>` +
        `</row>`;

    rows.forEach((r, i) => {
        const rn = i + 2;
        const bIdx = blockKind[i];
        const sData = 2 + bIdx + (blockBand[i] ? 4 : 0);
        const sSticker = sData + 8;

        sheet += `<row r="${rn}"${r.label ? ' ht="128" customHeight="1"' : ''}>`;
        sheet += cellText('A', rn, r.num, sData);
        if (/^\d+$/.test(r.article)) sheet += cellNumber('B', rn, r.article, sData);
        else if (r.article !== '') sheet += cellText('B', rn, r.article, sData);
        else sheet += cellEmpty('B', rn, sData);
        sheet += cellText('C', rn, r.name, sData);
        sheet += cellText('D', rn, r.name1c || '', sData);
        if (/^\d{4,}$/.test(r.sticker)) sheet += cellSticker('E', rn, r.sticker, sSticker);
        else if (r.sticker !== '') sheet += cellText('E', rn, r.sticker, sSticker);
        else sheet += cellEmpty('E', rn, sData);
        sheet += cellEmpty('F', rn, sData);
        sheet += `</row>`;
    });

    sheet += `</sheetData><autoFilter ref="A1:F${n + 1}"/>`;
    if (imgs.length) sheet += '<drawing r:id="rId1"/>';
    sheet += '</worksheet>';
    zip.file('xl/worksheets/sheet1.xml', sheet);

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/* ============================ Сборка ============================ */

async function startLp() {
    if (!(printedData && labelsData && priceData)) return;
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('warningsSection').classList.add('hidden');
    document.getElementById('progressSection').classList.remove('hidden');
    setProgress(0, 'Обработка...', '');

    try {
        // Строки — в порядке печатного листа подбора
        setProgress(15, 'Собираем строки...', '');
        await new Promise(r => setTimeout(r, 30));
        const rows = [...printedData.map.values()].map(pr => ({
            num: pr.num,
            name: pr.name,
            name1c: priceData.map.get(normKey(pr.article)) || '',
            article: pr.article,
            sticker: pr.sticker,
            label: labelsData.bySticker.get(normKey(pr.sticker)) || null
        }));
        const noName = rows.filter(r => !r.name1c).length;
        const noLabel = rows.filter(r => !r.label).length;

        // Формирование Excel
        setProgress(45, 'Формирование LP.xlsx с оформлением...', '');
        const blob = await buildLpXlsx(rows);
        setProgress(100, 'Готово!', `Строк: ${rows.length} | Из 1С: ${rows.length - noName} | Этикеток: ${rows.length - noLabel}`);

        built = { rows, blob, noName, noLabel };
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
            <div class="lbl">С этикеткой</div>
        </div>
    `;

    let warnHtml = '';
    if (noName) {
        const arts = rows.filter(r => !r.name1c).map(r => r.article).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noName} артикул(ов) не нашлось в прайсе</strong> — столбик «Наименование из 1С» останется пустым: ${arts}${noName > 10 ? ' …' : ''}</p>`;
    }
    if (noLabel) {
        const nums = rows.filter(r => !r.label).map(r => r.num).slice(0, 10).join(', ');
        warnHtml += `<p><strong>⚠️ ${noLabel} заказ(ов) без этикетки</strong> — стикер из листа подбора не совпал с PDF этикеток: ${nums}${noLabel > 10 ? ' …' : ''}</p>`;
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

document.getElementById('downloadBtn').addEventListener('click', () => {
    if (built) download(built.blob, 'LP.xlsx');
});

/* ============================ Печатный лист подбора (PDF) ============================ */

/* Таблица листа подбора имеет колонки № задания | Фото | Бренд | Наименование |
   Размер | Цвет | Артикул продавца | Стикер. Границы колонок определяем по
   строке шапки (x-координаты), элементы текста раскладываем по колонкам, а
   внутри страницы — по ближайшему номеру задания (наименование центрировано
   по вертикали и «размазано» по соседним строкам текста). */
async function handlePrinted(file) {
    document.getElementById('printedFileName').textContent = file.name;
    setStatus('printedStatus', '⏳ Чтение PDF...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const map = new Map();   // № -> {num, name, article, sticker} — порядок как в PDF
        let bounds = null;       // {names, xs} — колонки по шапке
        let headerY = null;
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            const items = [];
            for (const it of tc.items) {
                if (!it.str || !it.str.trim()) continue;
                items.push({ x: it.transform[4], y: it.transform[5], s: it.str.trim() });
            }
            if (!items.length) continue;

            // шапка: «№ задания … Стикер» (на каждой странице или только на первой)
            const hdr = items.filter(it =>
                /^(№ задания|Фото|Бренд|Наименование|Размер|Цвет|Артикул продавца|Стикер)$/.test(it.s));
            if (hdr.length >= 5) {
                hdr.sort((a, b) => a.x - b.x);
                const names = [], xs = [];
                for (const it of hdr) {
                    names.push(
                        it.s === '№ задания' ? 'num' :
                        it.s === 'Бренд' ? 'brand' :
                        it.s === 'Наименование' ? 'name' :
                        it.s === 'Размер' ? 'size' :
                        it.s === 'Цвет' ? 'color' :
                        it.s === 'Артикул продавца' ? 'article' : 'sticker');
                    xs.push(it.x);
                }
                bounds = { names: names, xs: xs };
                headerY = hdr.reduce((s, it) => s + it.y, 0) / hdr.length;
            }
            if (!bounds) continue;

            const colOf = (x) => {
                let c = -1;
                for (let i = 0; i < bounds.xs.length; i++) {
                    if (x >= bounds.xs[i] - 2) c = i;
                }
                return c >= 0 ? bounds.names[c] : '';
            };

            // якоря строк — 10-значные номера в первой колонке
            const anchors = [];
            for (const it of items) {
                if (colOf(it.x) === 'num' && /^\d{10}$/.test(it.s)) anchors.push({ y: it.y, num: it.s });
            }
            if (!anchors.length) continue;
            anchors.sort((a, b) => b.y - a.y); // сверху вниз

            const buckets = new Map();
            for (const a of anchors) {
                buckets.set(a.num, { brand: [], name: [], article: [], sticker: [] });
            }
            for (const it of items) {
                if (Math.abs(it.y - headerY) < 6) continue;   // слова шапки
                const col = colOf(it.x);
                if (col !== 'brand' && col !== 'name' && col !== 'article' && col !== 'sticker') continue;
                let best = null, bd = Infinity;
                for (const a of anchors) {
                    const d = Math.abs(a.y - it.y);
                    if (d < bd) { bd = d; best = a; }
                }
                if (!best || bd > 45) continue;               // заголовки/подвалы вне строк
                buckets.get(best.num)[col].push(it);
            }
            const joinYX = (arr) => arr.sort((a, b) => (b.y - a.y) || (a.x - b.x))
                .map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
            for (const [num, c] of buckets) {
                if (map.has(num)) continue;
                const article = joinYX(c.article).replace(/\s+/g, '');
                const sticker = joinYX(c.sticker).replace(/\s+/g, '');
                if (!article || !sticker) continue;
                const name = (joinYX(c.brand) + ' ' + joinYX(c.name)).replace(/\s+/g, ' ').trim();
                map.set(num, { num: num, name: name, article: article, sticker: sticker });
            }
        }
        if (!map.size) throw new Error('не нашли ни одного задания в PDF');
        printedData = { map: map, name: file.name };
        setStatus('printedStatus', `✅ Распознано строк: ${map.size}`, 'success');
    } catch (err) {
        printedData = null;
        setStatus('printedStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Этикетки (PDF) ============================ */

/* Каждая страница — стикер заказа. Рендерим в PNG, ключ — номер стикера
   с самой страницы (печатают как «WB 5868407 0992» — части могут быть
   разбиты произвольно, склеиваем все цифры после «WB»). */
async function handleLabels(file) {
    document.getElementById('labelsFileName').textContent = file.name;
    setStatus('labelsStatus', '⏳ Рендерим этикетки...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const bySticker = new Map();
        const ordered = [];
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
            const png = {
                bytes: Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0)),
                w: canvas.width, h: canvas.height
            };
            ordered.push(png);
            const tc = await page.getTextContent();
            const txt = tc.items.map(it => it.str).join(' ');
            const m = txt.match(/WB\s*(\d{4,8})\s*(\d{3,8})/);
            if (m) bySticker.set(m[1] + m[2], png);
            setProgress(Math.round(p / doc.numPages * 90), 'Рендер этикеток: ' + p + '/' + doc.numPages, '');
            if (p % 10 === 0) await new Promise(r => setTimeout(r, 0));
        }
        labelsData = { bySticker: bySticker, ordered: ordered, name: file.name };
        setStatus('labelsStatus', `✅ Этикеток: ${ordered.length}`, 'success');
    } catch (err) {
        labelsData = null;
        setStatus('labelsStatus', '❌ Ошибка: ' + err.message, 'error');
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

wireUpload('printedUploadArea', 'printedFileInput', handlePrinted);
wireUpload('labelsUploadArea', 'labelsFileInput', handleLabels);
wireUpload('priceUploadArea', 'priceFileInput', handlePrice);
