(function () {
    function applyTheme() {
        var t = localStorage.getItem('ra-theme') || 'light';
        document.documentElement.setAttribute('data-theme', t);
    }
    applyTheme();

    // Корректный базовый путь к иконкам: на главной — assets/icons/,
    // на вложенных страницах (data/...) — на три уровня выше.
    var BASE = /\/data\//.test(location.href) ? '../../../assets/icons/' : 'assets/icons/';

    function buildToggle() {
        // На внутренних страницах кнопка не нужна — тема применяется из localStorage,
        // а переключать можно на главной. Здесь ничего не создаём.
    }

    function imgSrc(name) { return BASE + name.replace(/ /g, '%20') + '.png'; }

    function buildDeco() {
        var icons = ['Icon (8)', 'Icon (11)', 'Icon (14)'];
        var cls = ['df1', 'df2', 'df3'];
        icons.forEach(function (ic, i) {
            var d = document.createElement('div');
            d.className = 'deco-float ' + (cls[i] || 'df1');
            var img = document.createElement('img');
            img.src = imgSrc(ic);
            img.alt = '';
            d.appendChild(img);
            (document.body || document.documentElement).appendChild(d);
        });

        var floats = Array.prototype.slice.call(document.querySelectorAll('.deco-float'));
        window.addEventListener('mousemove', function (e) {
            var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
            var dx = (e.clientX - cx) / cx, dy = (e.clientY - cy) / cy;
            floats.forEach(function (f, i) {
                var depth = (i + 1) * 10;
                f.style.transform = 'translate(' + (dx * depth) + 'px,' + (dy * depth) + 'px)';
            });
        });
    }

    function pickPanelIcon(h) {
        var txt = (h.textContent || '').toLowerCase();
        if (/инструкц/.test(txt)) return '3d-blue-checklist-and-pencil-on-transparent-confirmed-or-approved-document-icon-beige-clipboard-with-paper-sheets-with-check-marks-symbol-cartoon-icon-minimal-smo';
        if (/реестр/.test(txt)) return '3d-minimal-to-do-list-goal-achievement-concept-checklist-reminder-clipboard-with-a-checklist-pen-and-bell-icon-3d-illustration-png';
        if (/pdf|наклейк|файл|загруз/.test(txt)) return 'notebook_207187';
        if (/результат|расхож|сверк|итог|сравн/.test(txt)) return 'target-check-3d-icon-png-download-9748928';
        if (/подпис|этикет/.test(txt)) return 'pencil_207165';
        if (/поиск|шаг/.test(txt)) return 'magnifying-glass_207153';
        return null;
    }

    function stripLeadingEmoji(el) {
        var m = el.textContent.match(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\s]+/u);
        if (m) el.textContent = el.textContent.slice(m[0].length).trim();
    }

    function buildPanelIcons() {
        var headers = document.querySelectorAll('.panel-header');
        headers.forEach(function (h) {
            if (h.querySelector('.panel-ico')) return;
            var key = pickPanelIcon(h);
            if (!key) return;
            var img = document.createElement('img');
            img.className = 'panel-ico';
            img.src = imgSrc(key);
            img.alt = '';
            h.insertBefore(img, h.firstChild);
            var h3 = h.querySelector('h3');
            if (h3) stripLeadingEmoji(h3);
        });
    }

    function buildCollapse() {
        document.querySelectorAll('.instruction-panel').forEach(function (panel) {
            var header = panel.querySelector('.panel-header');
            if (!header || header.querySelector('.collapse-toggle')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'collapse-toggle';
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = '▾';
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var collapsed = panel.classList.toggle('collapsed');
                btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                btn.textContent = collapsed ? '▸' : '▾';
            });
            header.appendChild(btn);
        });
    }

    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }
    ready(function () { buildToggle(); buildDeco(); buildPanelIcons(); buildCollapse(); });
})();
