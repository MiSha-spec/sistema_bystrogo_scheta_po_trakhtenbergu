/* ===== Реестр 1С в свержах: загрузка Excel + предупреждение о дублях =====
   Подключается на страницах сверок, где номера из 1С вставляются в окошко.
   Даёт возможность вместо ручной вставки загрузить Excel-файл реестра 1С
   (.xlsx / .xls): модуль сам найдёт столбик «Идентификатор МП» или
   «Телефон1» (шапка в первых 100 строках, просматриваются все листы) и
   заполнит окошко номерами — каждый с новой строки.
   Дополнительно считает задублированные номера и показывает их списком
   прямо под окошком (и для вставленного текста, и для файла). */

(function () {
    'use strict';

    /* Ячейка → нормализованный заголовок: строка в нижнем регистре без пробелов */
    function normHeader(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/[\s\u00A0\u2028\u2029\u2007\u202F\u2009]+/g, '').toLowerCase();
    }

    /* Ячейка → нормализованный номер: без пробелов и кавычек */
    function normNumber(v) {
        if (v === null || v === undefined) return '';
        let s = String(v).trim();
        if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, ''); // Excel «123.0» → «123»
        return s
            .replace(/[\s\u00A0\u2007\u202F\u2009\u200A\u205F\u3000]+/g, '')
            .replace(/^['"`«»]+|['"`«»]+$/g, '');
    }

    /* Поиск столбика «Идентификатор МП» / «Телефон1» на листе */
    function findReestrCol(rows) {
        const limit = Math.min(rows.length, 100);
        for (let r = 0; r < limit; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < row.length; c++) {
                const h = normHeader(row[c]);
                if (h === 'идентификатормп' || h === 'телефон1') {
                    return { col: c, headerRow: r, header: h === 'идентификатормп' ? 'Идентификатор МП' : 'Телефон1' };
                }
            }
        }
        return null;
    }

    /* Читает все листы книги и собирает номера из найденных столбиков.
       Возвращает { header, numbers } — с повторами, или null, если столбика нет. */
    function numbersFromWorkbook(wb) {
        const out = [];
        let header = null;
        for (const name of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null });
            const found = findReestrCol(rows);
            if (!found) continue;
            if (!header) header = found.header;
            for (let r = found.headerRow + 1; r < rows.length; r++) {
                const key = normNumber((rows[r] || [])[found.col]);
                if (key && /\d/.test(key)) out.push(key);
            }
        }
        return header ? { header, numbers: out } : null;
    }

    /* Список дублей: [{ num, count }] в порядке первого появления */
    function findDuplicates(list) {
        const counts = new Map();
        for (const n of list) counts.set(n, (counts.get(n) || 0) + 1);
        const dups = [];
        counts.forEach((c, n) => { if (c > 1) dups.push({ num: n, count: c }); });
        return dups;
    }

    /* HTML предупреждения о дублях (или '' если дублей нет) */
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function dupWarningHtml(dups) {
        if (!dups.length) return '';
        const MAX = 10;
        const shown = dups.slice(0, MAX)
            .map(d => `<b>${esc(d.num)}</b> — ${d.count} раза`)
            .join(', ');
        const rest = dups.length > MAX ? ` и ещё ${dups.length - MAX}` : '';
        return `⚠️ Внимание, есть дубли: ${shown}${rest}`;
    }

    /* Подключение окошка реестра 1С.
       opts: textareaId (обяз.), inputId (файл, необяз.), statusId (необяз.),
             dupId (необяз.), splitRe (как резать текст на номера; по умолчанию любые разделители),
             tokenSplit (необяз. — если задан, каждая строка сначала режется на части
             и номером считается первая часть; нужно для формата «номер + табуляция + значение») */
    function setup(opts) {
        const textarea = document.getElementById(opts.textareaId);
        const input = opts.inputId ? document.getElementById(opts.inputId) : null;
        const statusEl = opts.statusId ? document.getElementById(opts.statusId) : null;
        const dupEl = opts.dupId ? document.getElementById(opts.dupId) : null;
        const splitRe = opts.splitRe || /[\n,;\s\t]+/;

        if (!textarea) return;

        function extractList(text) {
            let list = text.split(splitRe).map(s => s.trim()).filter(Boolean);
            if (opts.tokenSplit) {
                list = list.map(line => line.split(opts.tokenSplit)[0].trim()).filter(Boolean);
            }
            return list;
        }

        function refreshDupWarning() {
            if (!dupEl) return;
            const html = dupWarningHtml(findDuplicates(extractList(textarea.value)));
            dupEl.innerHTML = html;
            dupEl.classList.toggle('hidden', !html);
        }

        function setStatus(text, cls) {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.className = 'status' + (cls ? ' ' + cls : '');
        }

        if (input) {
            async function handleFile(file) {
                const name = file.name;
                try {
                    if (/\.(xlsx|xls|csv)$/i.test(name) && typeof XLSX !== 'undefined') {
                        let wb;
                        if (/\.csv$/i.test(name)) wb = XLSX.read(await file.text(), { type: 'string' });
                        else wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
                        const res = numbersFromWorkbook(wb);
                        if (!res) {
                            setStatus('❌ Не нашли столбик «Идентификатор МП» или «Телефон1» — проверьте, тот ли файл загружен.', 'error');
                            return;
                        }
                        textarea.value = res.numbers.join('\n');
                        setStatus(`✅ Из файла «${name}» взято ${res.numbers.length} номеров (столбик «${res.header}»)`, 'success');
                    } else {
                        // .txt и прочее — как текст (прежнее поведение)
                        textarea.value = await file.text();
                        setStatus(`✅ Файл «${name}» загружен как текст`, 'success');
                    }
                    refreshDupWarning();
                } catch (err) {
                    setStatus('❌ Ошибка: ' + err.message, 'error');
                    console.error(err);
                }
            }

            input.addEventListener('change', e => {
                if (e.target.files && e.target.files[0]) {
                    handleFile(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }

        textarea.addEventListener('input', refreshDupWarning);
        refreshDupWarning();
    }

    window.ReestrFileSupport = { setup, findDuplicates, dupWarningHtml };
})();
