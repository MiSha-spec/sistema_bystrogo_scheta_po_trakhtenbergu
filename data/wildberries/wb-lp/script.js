/* Лист подбора ВБ (LP) — перенос fill_stickers.py в браузер
   Вход:  WB-GI.xlsx (№ задания + Наименование) и wb.xlsx (сборочные задания)
   Выход: LP.xlsx — склейка с оформлением: отказы жёлтым, жирные последние
          4 цифры стикера, жирные рамки вокруг блоков одинаковых товаров */

/* ============================ Состояние ============================ */

const state = {
    gi: null,   // { rows: [{num, name}], name }
    wb: null    // { map: Map(№ -> {sticker, article, status}), dups, name } — необязателен
};

/* Новые входы: печатный лист подбора (PDF), этикетки (PDF), прайс 1С (Excel) */
let printedData = null;  // { map: Map(№ -> {name, article, sticker}), name }
let labelsData = null;   // { bySticker: Map(шк -> png), ordered: [png], name }
let priceData = null;    // { map: Map(артикул -> наименование), name }

let built = null;   // { rows, blob, refusals, missing }
let showAllMode = false;

/* Отказом считаем любой статус, начинающийся со слова «Отказ»
   («Отказ покупателем», «Отказ покупателя» и т.п.) */
const isRefusal = (status) => String(status || '').trim().toLowerCase().startsWith('отказ');

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
    document.getElementById('startBtn').disabled = !(state.gi && printedData && labelsData);
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

/* Читает таблицу как массив строк (текстом), находит строку шапки
   с нужными колонками и возвращает данные ниже неё */
function readSheet(file, requiredCols) {
    const wb = XLSX.read(file, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('в файле нет таблиц');
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    const norm = (v) => String(v == null ? '' : v).trim();
    let headerIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const cells = grid[i].map(norm);
        if (requiredCols.every(c => cells.includes(c))) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
        throw new Error('не найдены колонки: ' + requiredCols.join(', '));
    }
    const headers = grid[headerIdx].map(norm);
    const idx = {};
    requiredCols.forEach(c => { idx[c] = headers.indexOf(c); });
    const rows = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const r = grid[i];
        const item = {};
        requiredCols.forEach(c => { item[c] = norm(r[idx[c]]); });
        rows.push(item);
    }
    return rows;
}

/* ============================ Файл WB-GI ============================ */

async function handleGi(file) {
    document.getElementById('giFileName').textContent = file.name;
    document.getElementById('giUploadArea').classList.remove('loaded');
    setStatus('giStatus', '⏳ Чтение файла...', '');
    try {
        const buf = await file.arrayBuffer();
        const rows = readSheet(buf, ['№ задания'])
            .filter(r => r['№ задания'] !== '')
            .map(r => ({ num: r['№ задания'], name: r['Наименование'] || '' }));
        if (rows.length === 0) throw new Error('в таблице нет заданий');
        state.gi = { rows, name: file.name };
        document.getElementById('giUploadArea').classList.add('loaded');
        setStatus('giStatus', `✅ Загружено ${rows.length} заданий`, 'success');
    } catch (err) {
        state.gi = null;
        setStatus('giStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Файл wb ============================ */

async function handleWb(file) {
    document.getElementById('wbFileName').textContent = file.name;
    document.getElementById('wbUploadArea').classList.remove('loaded');
    setStatus('wbStatus', '⏳ Чтение файла...', '');
    try {
        const buf = await file.arrayBuffer();
        const required = ['№ задания', 'Стикер', 'Артикул продавца', 'Статус задания'];
        const all = readSheet(buf, required).filter(r => r['№ задания'] !== '');
        if (all.length === 0) throw new Error('в таблице нет заданий');
        // Наименование берём опционально (колонка есть в файле заданий) —
        // нужно для строк, которых не окажется в WB-GI
        const nameMap = new Map();
        try {
            readSheet(buf, ['№ задания', 'Наименование']).forEach(r => {
                if (r['№ задания'] !== '') nameMap.set(r['№ задания'], r['Наименование']);
            });
        } catch (e) { /* нет колонки — обойдёмся без неё */ }
        // как в скрипте: drop_duplicates по «№ задания», остаётся первая строка
        const map = new Map();
        let dups = 0;
        for (const r of all) {
            if (map.has(r['№ задания'])) { dups++; continue; }
            map.set(r['№ задания'], {
                sticker: r['Стикер'],
                article: r['Артикул продавца'],
                status: r['Статус задания'],
                name: nameMap.get(r['№ задания']) || ''
            });
        }
        state.wb = { map, dups, name: file.name };
        document.getElementById('wbUploadArea').classList.add('loaded');
        setStatus('wbStatus',
            `✅ Загружено ${map.size} заданий` + (dups ? ` (пропущено повторов: ${dups})` : ''),
            'success');
    } catch (err) {
        state.wb = null;
        setStatus('wbStatus', '❌ Ошибка: ' + err.message, 'error');
        console.error(err);
    }
    updateStartBtn();
}

/* ============================ Генерация LP.xlsx ============================ */

// Оформление в стиле «умной таблицы» (дружелюбно к чёрно-белой печати):
//   шапка — тёмная с белым жирным текстом, закреплена, с автофильтром;
//   блоки одинаковых товаров чередуются белой/серой заливкой (видно и на экране,
//   и при ч/б печати) и обведены жирной рамкой (слева/справа толстые всегда,
//   сверху/снизу толстые только по краям блока);
//   «Отказ покупателем» — жёлтая заливка первых 4 колонок;
//   стикер — по центру, последние 4 цифры жирным;
//   ширины: 15 / 15 / 65 / 20.
const LP_BAND = 'FFD9D9D9';   // серая полоса блока (печатается как светло-серый)
const LP_HEAD = 'FF404040';   // тёмная шапка
const LP_YELLOW = 'FFFFFF00'; // отказ покупателем

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

    // Стили данных: s = 2 + рамка(0..3) + полоса(+4) + отказ(+8) + стикер по центру(+16)
    let xfs =
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 обычная
        // 1 шапка: белый жирный текст на тёмной заливке, по центру
        '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>';
    for (let center = 0; center <= 1; center++) {
        for (let yellow = 0; yellow <= 1; yellow++) {
            for (let band = 0; band <= 1; band++) {
                for (let b = 0; b <= 3; b++) {
                    const fill = yellow ? 2 : (band ? 3 : 0);
                    const align = center ? '<alignment horizontal="center"/>' : '';
                    const flags = 'applyBorder="1"' +
                        (fill ? ' applyFill="1"' : '') +
                        (center ? ' applyAlignment="1"' : '');
                    xfs += `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="${b + 2}" xfId="0" ${flags}>${align}</xf>`;
                }
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
        `<fill><patternFill patternType="solid"><fgColor rgb="${LP_YELLOW}"/><bgColor indexed="64"/></patternFill></fill>` +
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
        '<cellXfs count="' + (2 + 32) + '">' + xfs + '</cellXfs>' +
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
        const refusal = isRefusal(r.status);
        const sData = 2 + bIdx + (blockBand[i] ? 4 : 0) + (refusal ? 8 : 0);
        const sSticker = 2 + bIdx + (blockBand[i] ? 4 : 0) + (refusal ? 8 : 0) + 16;

        sheet += `<row r="${rn}"${r.label ? ' ht="128" customHeight="1"' : ''}>`;
        sheet += cellText('A', rn, r.num, sData);
        if (/^\d+$/.test(r.article)) sheet += cellNumber('B', rn, r.article, sData);
        else if (r.article !== '') sheet += cellText('B', rn, r.article, sData);
        else sheet += cellEmpty('B', rn, sData);
        sheet += cellText('C', rn, r.name, sData);
        sheet += cellText('D', rn, r.name1c || '', sData);
        if (/^\d{4,}$/.test(r.sticker)) sheet += cellSticker('E', rn, r.sticker, sSticker);
        else if (r.sticker !== '') sheet += cellText('E', rn, r.sticker, sSticker);
        else sheet += cellEmpty('E', rn, sSticker);
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
    if (!(state.gi && printedData && labelsData)) return;
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('warningsSection').classList.add('hidden');
    document.getElementById('progressSection').classList.remove('hidden');
    setProgress(0, 'Обработка...', '');

    try {
        // Склейка: порядок из WB-GI, данные из wb (как merge left в скрипте)
        setProgress(15, 'Склейка таблиц...', '');
        await new Promise(r => setTimeout(r, 30));
        const rows = state.gi.rows.map((r, idx) => {
            const wbRow = state.wb ? state.wb.map.get(r.num) : null;
            const pr = printedData.map.get(r.num) || {};
            const article = (wbRow && wbRow.article) || pr.article || '';
            const sticker = (wbRow && wbRow.sticker) || pr.sticker || '';
            const name = r.name || pr.name || '';
            const artKey = normKey(article);
            const name1c = (artKey && priceData && priceData.map.get(artKey)) || '';
            const label = labelsData.bySticker.get(normKey(sticker)) || labelsData.ordered[idx] || null;
            return {
                num: r.num,
                name: name,
                name1c: name1c,
                article: article,
                sticker: sticker,
                status: wbRow ? wbRow.status : '',
                label: label
            };
        });
        // Задания из файла wb, которых нет в WB-GI (например, отказы покупателем —
        // их ЛК уже убрал из сборочных заданий): добавляем в конец списка,
        // иначе они терялись и отказы нельзя было увидеть
        const giNums = new Set(state.gi.rows.map(r => r.num));
        for (const [num, wbRow] of state.wb ? state.wb.map : []) {
            if (giNums.has(num)) continue;
            rows.push({
                num: num,
                name: wbRow.name,
                article: wbRow.article,
                sticker: wbRow.sticker,
                status: wbRow.status,
                wbOnly: true
            });
        }
        const missing = rows.filter(r => !r.wbOnly && !r.sticker && !r.article && !r.status).length;
        const refusals = rows.filter(r => isRefusal(r.status)).length;

        // Формирование Excel
        setProgress(45, 'Формирование LP.xlsx с оформлением...', '');
        const blob = await buildLpXlsx(rows);
        setProgress(100, 'Готово!', `Строк: ${rows.length} | Отказов: ${refusals}`);

        built = { rows, blob, refusals, missing };
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
    const { rows, refusals, missing } = built;

    document.getElementById('summary').innerHTML = `
        <div class="summary-card ok">
            <span class="num">${rows.length}</span>
            <div class="lbl">Строк в листе</div>
        </div>
        <div class="summary-card ${refusals ? 'warn' : 'ok'}">
            <span class="num">${refusals}</span>
            <div class="lbl">Отказов покупателем</div>
        </div>
        <div class="summary-card ${missing ? 'miss' : 'ok'}">
            <span class="num">${missing}</span>
            <div class="lbl">Не найдено в wb</div>
        </div>
        <div class="summary-card ok">
            <span class="num">${rows.length - refusals}</span>
            <div class="lbl">Активных заказов</div>
        </div>
    `;

    let warnHtml = '';
    if (refusals) {
        const refNums = rows.filter(r => isRefusal(r.status)).map(r => r.num).join(', ');
        warnHtml += `<p><strong>⚠️ ${refusals} заказ(ов) со статусом «Отказ покупателем»</strong> — выделены жёлтым в файле и таблице: ${refNums}</p>`;
    }
    const wbOnly = rows.filter(r => r.wbOnly);
    if (wbOnly.length) {
        warnHtml += `<p><strong>ℹ️ ${wbOnly.length} задани(й) из файла wb не было в WB-GI</strong> (например, отказы — их ЛК уже убрал из сборочных заданий) — добавлены в конец списка: ${wbOnly.map(r => r.num).join(', ')}</p>`;
    }
    if (missing) {
        warnHtml += `<p><strong>❌ ${missing} задани(й) не найдено в файле wb</strong> — стикер и артикул будут пустыми. Проверьте, что файл wb скачан полностью и за тот же день.</p>`;
    }
    if (state.wb.dups) {
        warnHtml += `<p><strong>ℹ️ В файле wb было ${state.wb.dups} повторных заданий</strong> — взяты первые вхождения (как в оригинальном скрипте).</p>`;
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
        const refusal = isRefusal(r.status);
        const cls = refusal ? 'from-lp' : (band ? 'band' : '');
        const badge = r.status
            ? `<span class="badge ${refusal ? 'warn' : 'ok'}">${r.status}</span>`
            : (r.wbOnly ? '<span class="badge warn">Нет в WB-GI</span>' : '');
        return `
        <tr class="${cls}">
            <td>${r.num}</td>
            <td>${r.article || '—'}</td>
            <td class="name-cell">${r.name || '—'}</td>
            <td>${r.sticker ? r.sticker.replace(/(\d{4})$/, '<b>$1</b>') : '—'}</td>
            <td>${badge}</td>
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

wireUpload('giUploadArea', 'giFileInput', handleGi);
wireUpload('wbUploadArea', 'wbFileInput', handleWb);

/* ============================ Новые входы ============================ */

/* Ключ: строка без пробелов и неразрывных пробелов */
function normKey(s) {
    return String(s == null ? '' : s).replace(/[\s\u00A0\u2007\u202F]+/g, '');
}

/* Печатный лист подбора (PDF): по каждому заданию — наименование,
   артикул и стикер. Строка из 10 цифр начинает блок задания. */
async function handlePrinted(file) {
    document.getElementById('printedFileName').textContent = file.name;
    setStatus('printedStatus', '⏳ Чтение PDF...', '');
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const map = new Map();
        let lines = [];
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            const rowsY = [];
            for (const it of tc.items) {
                if (!it.str || !it.str.trim()) continue;
                const y = Math.round(it.transform[5] / 2) * 2;
                let L = rowsY.find(x => Math.abs(x.y - y) <= 2);
                if (!L) { L = { y: y, parts: [] }; rowsY.push(L); }
                L.parts.push({ x: it.transform[4], s: it.str });
            }
            rowsY.sort((a, b) => b.y - a.y);
            for (const L of rowsY) {
                L.parts.sort((a, b) => a.x - b.x);
                lines.push(L.parts.map(x => x.s).join(' ').replace(/\s+/g, ' ').trim());
            }
        }
        let cur = null;
        for (const ln of lines) {
            if (/^\d{10}$/.test(ln)) {
                if (cur && cur.num && !map.has(cur.num)) map.set(cur.num, cur);
                cur = { num: ln, name: '', nameLines: [], article: '', sticker: '' };
                continue;
            }
            if (!cur) continue;
            const tail = ln.match(/(\d{4,7})\s+(\d{3,5})\s+(\d{3,5})\s*$/);
            if (tail && !cur.article) {
                cur.article = tail[1];
                cur.sticker = tail[2] + tail[3];
                const pre = ln.slice(0, ln.length - tail[0].length).trim();
                cur.name = (cur.nameLines.join(' ') + ' ' + pre).replace(/\s+/g, ' ').trim();
            } else {
                cur.nameLines.push(ln);
            }
        }
        if (cur && cur.num && !map.has(cur.num)) map.set(cur.num, cur);
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

/* Этикетки (PDF): каждая страница — стикер заказа. Рендерим в PNG,
   ключ — номер стикера с самой страницы. */
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
            const m = txt.match(/WB\s*(\d{3,5})\s*(\d{3,5})/);
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

/* Прайс 1С (Excel): первый столбик — артикул, второй — наименование */
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
