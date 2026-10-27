/* ===== Реестр 1С в сверках: загрузка Excel + предупреждение о дублях =====
   Подключается на страницах сверок, где номера из 1С вставляются в окошко.
   Даёт возможность вместо ручной вставки загрузить Excel-файл реестра 1С
   (.xlsx / .xls): модуль сам найдёт столбик «Идентификатор МП» или
   «Телефон1» (шапка в первых 100 строках, просматриваются все листы) и
   заполнит окошко номерами — каждый с новой строки.
   Дополнительно считает задублированные номера и показывает их списком
   прямо под окошком (и для вставленного текста, и для файла).
   Файл можно не только выбрать кнопкой, но и перетащить в любое место
   окошка (плашки) — подсветится всё окошко целиком. */

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

    /* Поиск столбика «Идентификатор МП» / «Телефон1» на листе.
       allowed — список допустимых заголовков в нормализованном виде;
       если не задан, ищутся оба стандартных столбика. */
    function findReestrCol(rows, allowed) {
        const limit = Math.min(rows.length, 100);
        for (let r = 0; r < limit; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < row.length; c++) {
                const h = normHeader(row[c]);
                const ok = allowed
                    ? allowed.indexOf(h) !== -1
                    : (h === 'идентификатормп' || h === 'телефон1');
                if (ok) {
                    return { col: c, headerRow: r, header: h === 'идентификатормп' ? 'Идентификатор МП' : 'Телефон1' };
                }
            }
        }
        return null;
    }

    /* Читает все листы книги и собирает номера из найденных столбиков.
       Возвращает { header, numbers } — с повторами, или null, если столбика нет. */
    function numbersFromWorkbook(wb, allowed) {
        const out = [];
        let header = null;
        for (const name of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null });
            const found = findReestrCol(rows, allowed);
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

    /* ===================== Перетаскивание файлов ===================== */

    /* В перетаскивании участвует файл (а не выделенный текст) */
    function hasFiles(e) {
        const types = e.dataTransfer && e.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
        return false;
    }

    /* id / массив id / CSS-селектор / сам элемент → список элементов */
    function toEls(v) {
        const out = [];
        const add = x => {
            if (!x) return;
            if (Array.isArray(x)) { x.forEach(add); return; }
            if (typeof x === 'string') {
                const s = x.trim();
                if (!s) return;
                if (/^[.#\[]/.test(s)) {
                    Array.prototype.forEach.call(document.querySelectorAll(s), el => out.push(el));
                } else {
                    const el = document.getElementById(s);
                    if (el) out.push(el);
                }
                return;
            }
            if (x.nodeType === 1) out.push(x);
        };
        add(v);
        return out;
    }

    /* Подходит ли файл под accept (RegExp по имени или функция) */
    function accepted(file, accept) {
        if (!accept) return true;
        if (typeof accept === 'function') return !!accept(file);
        return accept.test(file.name || '');
    }

    /* Если файл уронили мимо окошка — не даём браузеру открыть его вместо
       страницы (иначе вся работа на странице пропадает). Текстовое
       перетаскивание внутри полей не трогаем. */
    function guardPageDrops() {
        if (window.__reestrDropGuard) return;
        window.__reestrDropGuard = true;
        ['dragover', 'drop'].forEach(ev => {
            window.addEventListener(ev, e => { if (hasFiles(e)) e.preventDefault(); });
        });
    }

    /* Вешает приём файла перетаскиванием на элемент(ы).
       targets — id / массив id / селектор / элементы;
       onFile(file) — что делать с файлом;
       opts.accept — RegExp по имени файла (необяз.);
       opts.onReject(file) — что делать, если файл не подошёл (необяз.). */
    function bindDrop(targets, onFile, opts) {
        opts = opts || {};
        if (typeof onFile !== 'function') return false;
        let bound = 0;

        toEls(targets).forEach(el => {
            if (el.__reestrDropBound) return;
            el.__reestrDropBound = true;
            bound++;

            let depth = 0;
            const mark = on => el.classList.toggle('reestr-drop-hover', on);

            el.addEventListener('dragenter', e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth++;
                mark(true);
            });

            el.addEventListener('dragover', e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
                mark(true);
            });

            el.addEventListener('dragleave', e => {
                if (!hasFiles(e)) return;
                depth = Math.max(0, depth - 1);
                if (!depth) mark(false);
            });

            el.addEventListener('drop', e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                depth = 0;
                mark(false);
                const f = e.dataTransfer.files && e.dataTransfer.files[0];
                if (!f) return;
                if (!accepted(f, opts.accept)) {
                    if (opts.onReject) opts.onReject(f);
                    return;
                }
                onFile(f);
            });
        });

        return bound > 0;
    }

    /* ================== Окошко «Реестр 1С» ==================
       opts: textareaId (обяз.), inputId (файл, необяз.), statusId (необяз.),
             dropId / dropIds / dropSelector (куда ещё можно бросать; необяз.),
             dupId (необяз.), splitRe (как резать текст на номера; по умолчанию любые разделители),
             tokenSplit (необяз. — если задан, каждая строка сначала режется на части
             и номером считается первая часть; нужно для формата «номер + табуляция + значение») */
    function setup(opts) {
        opts = opts || {};
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

        async function handleFile(file) {
            const name = file.name;
            try {
                if (/\.(xlsx|xls|csv)$/i.test(name) && typeof XLSX !== 'undefined') {
                    let wb;
                    if (/\.csv$/i.test(name)) wb = XLSX.read(await file.text(), { type: 'string' });
                    else wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
                    const res = numbersFromWorkbook(wb, opts.allowedHeaders);
                    if (!res) {
                        setStatus('❌ Не нашли столбик «Идентификатор МП» или «Телефон1» — проверьте, тот ли файл загружен.', 'error');
                        return;
                    }
                    textarea.value = res.numbers.join('\n');
                    textarea.dispatchEvent(new Event('input'));
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

        if (input) {
            input.addEventListener('change', e => {
                if (e.target.files && e.target.files[0]) {
                    handleFile(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }

        // Перетаскивание файла: всё окошко (плашка) целиком, а не только поле ввода.
        // Только там, где файл вообще можно загрузить кнопкой (иначе нечего принимать).
        if (input) {
            const targets = [];
            toEls(opts.dropId).forEach(el => targets.push(el));
            toEls(opts.dropIds).forEach(el => targets.push(el));
            if (opts.dropSelector) toEls(opts.dropSelector).forEach(el => targets.push(el));
            if (opts.dropPanel !== false) {
                const panel = input.closest('.panel');
                if (panel) targets.push(panel);
            }
            targets.push(textarea);

            bindDrop(targets, handleFile);
            guardPageDrops();
        }

        textarea.addEventListener('input', refreshDupWarning);
        refreshDupWarning();
    }

    /* ============ Окошко, в которое файл просто бросают ============
       Для окон, у которых своя обработка файла (ЛК, PDF и т. п.).
       opts: dropId / dropIds / dropSelector — куда можно бросать (необяз.:
             по умолчанию — плашка, в которой лежит inputId),
             inputId — скрытый input кнопки «Загрузить» (необяз.),
             onFile(file) — что делать с файлом (обяз.),
             accept — RegExp по имени файла или функция (необяз.),
             onReject(file) — что делать с неподходящим файлом (необяз.). */
    function setupFileDrop(opts) {
        opts = opts || {};
        const input = opts.inputId ? document.getElementById(opts.inputId) : null;
        const targets = [];
        toEls(opts.dropIds).forEach(el => targets.push(el));
        toEls(opts.dropId).forEach(el => targets.push(el));
        if (opts.dropSelector) toEls(opts.dropSelector).forEach(el => targets.push(el));
        if (!targets.length && input) {
            const panel = input.closest('.panel');
            if (panel) targets.push(panel);
        }
        if (!targets.length) return false;

        bindDrop(targets, opts.onFile, { accept: opts.accept, onReject: opts.onReject });
        guardPageDrops();
        return true;
    }

    window.ReestrFileSupport = { setup, setupFileDrop, bindDrop, accepted, findDuplicates, dupWarningHtml };
})();
