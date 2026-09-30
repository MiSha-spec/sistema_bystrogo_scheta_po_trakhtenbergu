let shkNumbers = [];
let reestrNumbers = [];
let results = [];

// Drag & drop
const uploadArea = document.getElementById('pdfUploadArea');
const pdfInput = document.getElementById('pdfFileInput');
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePdf(file);
});
pdfInput.addEventListener('change', e => { if (e.target.files[0]) handlePdf(e.target.files[0]); });

async function handlePdf(file) {
    document.getElementById('pdfFileName').textContent = file.name;
    const status = document.getElementById('pdfStatus');
    status.textContent = '⏳ Чтение PDF...';
    status.className = 'status';
    try {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(it => it.str).join(' ') + '\n';
            status.textContent = `⏳ Страница ${i} из ${pdf.numPages}`;
        }
        const matches = text.match(/\b\d{10,13}\b/g) || [];
        shkNumbers = [...new Set(matches)];
        status.textContent = `✅ Найдено ${shkNumbers.length} номеров на ${pdf.numPages} стр.`;
        status.className = 'status success';
    } catch (err) {
        status.textContent = '❌ Ошибка: ' + err.message;
        status.className = 'status error';
    }
}

async function startSverka() {
    const text = document.getElementById('reestrText').value.trim();
    if (!text) { alert('Введите реестр'); return; }
    if (shkNumbers.length === 0) { alert('Загрузите PDF'); return; }
    reestrNumbers = [...new Set(text.split(/[\n,;\s\t]+/).filter(n => n.trim()))];
    
    document.getElementById('progressSection').classList.remove('hidden');
    document.getElementById('progressSection').classList.add('processing'); // ← анимация
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('startBtn').disabled = true;
    
    const all = new Set([...shkNumbers, ...reestrNumbers]);
    const total = all.size;
    let done = 0;
    results = [];
    
    for (const num of all) {
        const inShk = shkNumbers.includes(num);
        const inReestr = reestrNumbers.includes(num);
        results.push({ number: num, inShk, inReestr });
        done++;
        const pct = Math.round((done / total) * 100);
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressPercent').textContent = pct + '%';
        document.getElementById('progressDetails').textContent = 
            `Обработано ${done}/${total} | Наклейки: ${shkNumbers.length} | Реестр: ${reestrNumbers.length}`;
        if (done % 10 === 0) await new Promise(r => setTimeout(r, 10));
    }
    
    document.getElementById('progressSection').classList.remove('processing'); // ← убираем анимацию
    showResults();
    document.getElementById('startBtn').disabled = false;
}

function showResults() {
    // Считаем статистику
    const match = results.filter(r => r.inShk && r.inReestr).length;
    const onlyShk = results.filter(r => r.inShk && !r.inReestr).length;
    const onlyReestr = results.filter(r => !r.inShk && r.inReestr).length;
    const totalDiff = onlyShk + onlyReestr;
    
    // Сводка — только расхождения
    document.getElementById('summary').innerHTML = `
        <div class="summary-card miss">
            <span class="num">${totalDiff}</span>
            <div class="lbl">Всего расхождений</div>
        </div>
        <div class="summary-card" style="border-color: #9B59B6; background: #FAF0FF;">
            <span class="num" style="color: #9B59B6;">${onlyShk}</span>
            <div class="lbl">Только в наклейках</div>
        </div>
        <div class="summary-card" style="border-color: #dc3545; background: #fff5f5;">
            <span class="num" style="color: #dc3545;">${onlyReestr}</span>
            <div class="lbl">Только в реестре</div>
        </div>
    `;
    
    // Показываем ТОЛЬКО расхождения (не совпадающие)
    const diff = results.filter(r => !(r.inShk && r.inReestr));
    if (diff.length === 0) {
        document.getElementById('resultsBody').innerHTML = `
            <tr><td colspan="4" style="text-align:center; padding:30px; color:#28a745; font-family:-apple-system, sans-serif;">
                ✅ Все номера совпадают! Расхождений нет.
            </td></tr>
        `;
    } else {
        // Сортируем: сначала только в наклейках, потом только в реестре
        const sorted = [...diff].sort((a, b) => {
            if (a.inShk && !b.inShk) return -1;
            if (!a.inShk && b.inShk) return 1;
            return 0;
        });
        
        document.getElementById('resultsBody').innerHTML = sorted.map((r, idx) => {
            let badgeClass, badgeText, rowClass;
            
            if (r.inShk && !r.inReestr) {
                badgeClass = 'only_shk';
                badgeText = ' Только в наклейках';
                rowClass = 'row-only_shk';
            } else {
                badgeClass = 'only_reestr';
                badgeText = '🔴 Только в реестре';
                rowClass = 'row-only_reestr';
            }
            
            return `<tr class="${rowClass}" style="animation-delay: ${idx * 0.03}s">
                <td>${r.number}</td>
                <td style="text-align:center; font-size:1.2em;">${r.inShk ? '✅' : '❌'}</td>
                <td style="text-align:center; font-size:1.2em;">${r.inReestr ? '✅' : '❌'}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            </tr>`;
        }).join('');
    }
    document.getElementById('resultsSection').classList.remove('hidden');
}

function exportCSV() {
    // Экспортируем только расхождения
    const diff = results.filter(r => !(r.inShk && r.inReestr));
    const csv = [
        'Номер;В наклейках;В реестре;Статус',
        ...diff.map(r => `${r.number};${r.inShk?'Да':'Нет'};${r.inReestr?'Да':'Нет'};${r.inShk?'Только наклейки':'Только реестр'}`)
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'raschozhdeniya_yandex.csv';
    a.click();
}

function copyDiffNumbers() {
    const diff = results.filter(r => !(r.inShk && r.inReestr)); // ← исправлено: было inAkt
    if (diff.length === 0) {
        alert('Нет расхождений для копирования');
        return;
    }
    const numbers = diff.map(r => r.number).join('\n');
    
    navigator.clipboard.writeText(numbers).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✅ Скопировано!';
        btn.style.background = '#28a745';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }).catch(err => {
        // Фоллбэк для старых браузеров
        const textarea = document.createElement('textarea');
        textarea.value = numbers;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            alert('✅ Скопировано ' + diff.length + ' номеров!');
        } catch (e) {
            alert('Не удалось скопировать');
        }
        document.body.removeChild(textarea);
    });
}
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
