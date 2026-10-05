/* ============================================================
   Сверка реестра 1С со списком заказов из ЛК:
   из файла ЛК берём заказы со статусом «Отменён в процессе
   обработки» и ищем их среди номеров реестра 1С. Файл может
   быть любым — шапку и столбики находим сами.
   ============================================================ */

let lkCancelled = [];  // отменённые номера из ЛК (уникальные)
let lkMatches = [];    // заказы из реестра 1С, отменённые в ЛК
let lkDebounce = null;

/* Номер заказа: строка без пробелов, без «.0» от Excel */
function lkNormNum(v) {
    if (v === null || v === undefined) return '';
    let s = String(v).trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s.replace(/[\s\u00A0\u2007\u202F\u2009\u200A\u205F\u3000]+/g, '');
}

/* Заголовок: нижний регистр без пробелов и неразрывных пробелов */
function lkNormHeader(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[\s\u00A0\u2007\u202F\u2009]+/g, '').toLowerCase();
}

/* Файлы ЯМ иногда пишут неверную размерность листа — пересчитываем
   фактический диапазон по ячейкам, иначе данные обрежутся. */
function lkFixRange(wb) {
    Object.keys(wb.Sheets).forEach(function (name) {
        const ws = wb.Sheets[name];
        let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
        Object.keys(ws).forEach(function (addr) {
            const m = /^([A-Z]+)(\d+)$/.exec(addr);
            if (!m) return;
            const c = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
            const r = parseInt(m[2], 10) - 1;
            if (r < minR) minR = r;
            if (c < minC) minC = c;
            if (r > maxR) maxR = r;
            if (c > maxC) maxC = c;
        });
        if (maxR >= 0) {
            ws['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
        }
    });
}

/* Ищем строку заголовков со столбиками заказа и статуса.
   «Номер заказа» и «Ваш номер заказа» — одно и то же. */
function lkFindHeader(rows) {
    const limit = Math.min(rows.length, 100);
    for (let r = 0; r < limit; r++) {
        const cells = (rows[r] || []).map(lkNormHeader);
        const oc = cells.findIndex(c => c === 'вашномерзаказа' || c === 'номерзаказа');
        const sc = cells.findIndex(c => c.startsWith('статус'));
        if (oc >= 0 && sc >= 0) return { hdr: r, oc: oc, sc: sc };
    }
    return null;
}

async function handleLkFile(file) {
    const status = document.getElementById('lkFileStatus');
    try {
        status.textContent = '⏳ Чтение файла...';
        status.className = 'status';
        if (typeof XLSX === 'undefined') {
            throw new Error('Не загрузилась библиотека для чтения Excel. Проверьте интернет и обновите страницу.');
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'array' });
        lkFixRange(wb);

        const strict = [], anyCancel = [];
        let total = 0, foundIn = 0;
        for (const name of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null });
            const found = lkFindHeader(rows);
            if (!found) continue;
            foundIn++;
            for (let r = found.hdr + 1; r < rows.length; r++) {
                const row = rows[r] || [];
                const num = lkNormNum(row[found.oc]);
                const st = String(row[found.sc] === null || row[found.sc] === undefined ? '' : row[found.sc]).toLowerCase();
                if (!num || !/\d/.test(num)) continue;
                total++;
                if (st.includes('отмен') && st.includes('обработ')) strict.push(num);
                else if (st.includes('отмен')) anyCancel.push(num);
            }
        }

        if (!foundIn) {
            lkCancelled = [];
            status.textContent = '❌ Не нашли столбики «Номер заказа» и «Статус заказа» — проверьте, тот ли файл загружен.';
            status.className = 'status error';
        } else if (!strict.length && !anyCancel.length) {
            lkCancelled = [];
            status.textContent = `✅ Файл загружен: ${total} заказов, отменённых нет.`;
            status.className = 'status success';
        } else {
            let cancelled = strict, note = '';
            if (!cancelled.length) {
                // точный статус «Отменён в процессе обработки» не встретился —
                // берём все отменённые, чтобы сверка не потерялась
                cancelled = anyCancel;
                note = ' (точный статус «Отменён в процессе обработки» не нашли — взяты все отменённые)';
            }
            lkCancelled = [...new Set(cancelled)];
            status.textContent = `✅ Отменённых в ЛК: ${lkCancelled.length} из ${total} заказов${note}`;
            status.className = 'status success';
        }
        updateLkResults();
    } catch (err) {
        status.textContent = '❌ Ошибка: ' + err.message;
        status.className = 'status error';
        console.error(err);
    }
}

/* Сверка: номера из окошка реестра × отменённые из ЛК */
function updateLkResults() {
    const sec = document.getElementById('lkResultsSection');
    const ta = document.getElementById('reestrText');
    if (!sec || !ta) return;

    const reestr = [...new Set(ta.value.split(/[\n,;\s\t]+/).map(lkNormNum).filter(n => n && /\d/.test(n)))];
    const cancelledSet = new Set(lkCancelled);
    lkMatches = reestr.filter(n => cancelledSet.has(n));

    if (!lkCancelled.length || !reestr.length) {
        sec.classList.add('hidden');
        return;
    }
    sec.classList.remove('hidden');

    document.getElementById('lkSummary').innerHTML =
        `<div class="summary-card ok"><span class="num">${reestr.length}</span><div class="lbl">Заказов в реестре 1С</div></div>` +
        `<div class="summary-card ok"><span class="num">${lkCancelled.length}</span><div class="lbl">Отменённых в ЛК</div></div>` +
        `<div class="summary-card miss"><span class="num">${lkMatches.length}</span><div class="lbl">Отменённых из реестра</div></div>`;

    document.getElementById('lkResultsBody').innerHTML = lkMatches.length
        ? lkMatches.map((n, i) => `<tr><td class="col-num">${i + 1}</td><td>${n}</td></tr>`).join('')
        : '<tr><td colspan="2" style="text-align:center;padding:26px;color:#28a745;">✅ Совпадений нет — ни один заказ из реестра не отменён в ЛК.</td></tr>';
}

function copyLkList(btn) {
    if (!lkMatches.length) return;
    const text = lkMatches.join('\n');
    const done = () => {
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = '✅ Скопировано!';
        setTimeout(() => { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => { lkFallbackCopy(text); done(); });
    } else {
        lkFallbackCopy(text);
        done();
    }
}

function lkFallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
}

function exportLkCSV() {
    if (!lkMatches.length) return;
    const csv = ['Номер заказа', ...lkMatches].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'otmenennye_iz_reestra_lk.csv';
    a.click();
}

/* Инициализация: загрузка файла ЛК + пересчёт при правке реестра */
(function lkInit() {
    const input = document.getElementById('lkFileInput');
    if (input) {
        input.addEventListener('change', e => {
            if (e.target.files && e.target.files[0]) {
                handleLkFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }
    const ta = document.getElementById('reestrText');
    if (ta) {
        ta.addEventListener('input', () => {
            clearTimeout(lkDebounce);
            lkDebounce = setTimeout(updateLkResults, 300);
        });
    }
})();
