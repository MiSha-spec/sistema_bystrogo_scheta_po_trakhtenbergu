const stores = [
    { id: 'general', title: 'Инструкции', class: 'instructions', icon: 'assets/icons/instructions.svg', items: allInstructions },
    { id: 'yandex', title: 'ЯндексМаркет', class: 'yandex', icon: 'assets/icons/yandex-badge.svg', items: ymChecks },
    { id: 'wildberries', title: 'ВБ', class: 'wildberries', icon: 'assets/icons/wildberries.svg', items: wbChecks },
    { id: 'ozon', title: 'ОЗОН', class: 'ozon', icon: 'assets/icons/ozon-badge.svg', items: ozonChecks }
];

/* Летающие GIF-ки в зоне мозга (вместо статичных иконок) */
const PARTICLE_GIFS = [
    'gif-meditation', 'gif-timeline', 'gif-trumpet', 'PC_man',
    'QQ5H', 'Tea_bag', 'Urgent', 'Paper_in_folder_2'
];

/* Осмысленные иконки для каждого инструмента (без повторов) */
const ITEM_ICONS = {
    'shk-reestr': 'magnifying-glass_207153.png',
    'ym-canceled': 'cancel_8528849.png',
    'akt-reestr': 'papyrus_207163.png',
    'gruzomesta': 'target-check-3d-icon-png-download-9748928.png',
    'podpis-etiketok': 'pencil_207165.png',
    'ozon-sverka-1': 'notebook_207187.png',
    'ozon-sverka-2': '3d-minimal-to-do-list-goal-achievement-concept-checklist-reminder-clipboard-with-a-checklist-pen-and-bell-icon-3d-illustration-png.png',
    'ozon-pack': 'filter_7420944.png',
    'ozon-sverka-3': 'cancel_8528849.png',
    'wb-lp': 'reading_207172.png',
    'wb-lp-pics': 'paint-palette_207159.png',
    'wb-couriers-1': '3d-blue-checklist-and-pencil-on-transparent-confirmed-or-approved-document-icon-beige-clipboard-with-paper-sheets-with-check-marks-symbol-cartoon-icon-minimal-smo.png',
    'wb-canceled': 'delete_15601482.png'
};
const SUB_ICONS = [
    'reading_207172.png', 'filter_7420944.png', 'scissors_207182.png',
    'paint-palette_207159.png', 'delete_15601482.png', 'cancel_8528849.png'
];
function iconPath(name) { return 'assets/icons/' + name.replace(/ /g, '%20') + '.png'; }

const MM = {
    center: { x: 500, y: 400 },
    positions: {
        yandex: { x: 500, y: 180 },
        ozon: { x: 310, y: 510 },
        wildberries: { x: 690, y: 510 }
    },
    brand: {
        yandex: '#FFCC00',
        ozon: '#3B82F6',
        wildberries: '#e313bf'
    }
};

let activeStore = null;
let subPos = {};
let justDragged = false;
try { subPos = JSON.parse(localStorage.getItem('ra-subpos') || '{}'); } catch (e) { subPos = {}; }

document.addEventListener('DOMContentLoaded', () => {
    splitTitle();
    buildMindMap();
    setupParticles();
    setupSearch();

    const grid = document.getElementById('storesGrid');
    const panel = document.getElementById('mindmapPanel');
    grid.classList.add('hidden');
    panel.classList.remove('hidden');

    const svg = document.getElementById('mindmap');
    svg.addEventListener('click', onMindMapClick);

    document.getElementById('brainImg').addEventListener('click', resetStores);
    document.getElementById('mmInstructions').addEventListener('click', openMainInstruction);
});

/* ---------- Animated title ---------- */

function splitTitle() {
    const el = document.getElementById('btWords');
    if (!el) return;
    const text = el.textContent.trim();
    el.textContent = '';
    [...text].forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'ltr';
        span.textContent = ch === ' ' ? ' ' : ch;
        span.style.animationDelay = (i * 0.06).toFixed(2) + 's';
        el.appendChild(span);
    });
}

/* ---------- Mind map ---------- */

function neuronPath(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const off = 38;
    const cx = mx + px * off, cy = my + py * off;
    return `M ${a.x} ${a.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x} ${b.y}`;
}

function pulse(id, color) {
    const begin = (Math.random() * 2.5).toFixed(2);
    return `<circle class="pulse" r="4.5" fill="${color}">` +
        `<animateMotion dur="2.8s" begin="${begin}s" repeatCount="indefinite" rotate="auto">` +
        `<mpath href="#${id}"/></animateMotion></animateMotion></circle>`;
}

function storeNode(store, P, color, count) {
    const labelY = (P.y < MM.center.y) ? -86 : 86;
    return `<g class="store-node" data-store="${store.id}" transform="translate(${P.x},${P.y})">
        <circle class="node-halo" r="62" fill="${color}" filter="url(#mmGlow)"/>
        <circle class="node-core" r="46" fill="#ffffff" stroke="${color}" stroke-width="3"/>
        <text class="node-label" y="${labelY}" style="fill:${color}">${store.title}</text>
        <g class="node-count" transform="translate(44,-46)">
            <circle r="14" fill="${color}"/>
            <text y="4" text-anchor="middle">${count}</text>
        </g>
    </g>`;
}

function renderStoreIcons() {
    var panel = document.getElementById('mindmapPanel');
    var svg = document.getElementById('mindmap');
    if (!panel || !svg) return;
    var old = document.getElementById('storeIcons');
    if (old) old.remove();
    var ctm = svg.getScreenCTM();
    if (!ctm) return;
    var prect = panel.getBoundingClientRect();
    var layer = document.createElement('div');
    layer.id = 'storeIcons';
    layer.className = 'store-icons-layer';
    stores.filter(function (s) { return s.id !== 'general'; }).forEach(function (store) {
        var P = MM.positions[store.id];
        if (!P) return;
        var pt = svg.createSVGPoint();
        pt.x = P.x; pt.y = P.y;
        var sp = pt.matrixTransform(ctm);
        var relX = sp.x - prect.left;
        var relY = sp.y - prect.top;
        var scale = ctm.a || 1;
        var size = 92 * scale;
        var img = document.createElement('img');
        img.className = 'store-badge';
        img.src = store.icon;
        img.alt = store.title;
        img.style.left = (relX - size / 2) + 'px';
        img.style.top = (relY - size / 2) + 'px';
        img.style.width = size + 'px';
        img.style.height = size + 'px';
        layer.appendChild(img);
    });
    panel.appendChild(layer);
}

function buildMindMap() {
    const svg = document.getElementById('mindmap');
    let defs = `<defs>
        <filter id="mmGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="9" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
    </defs>`;

    const mapStores = stores.filter(s => s.id !== 'general');
    let neurons = '';
    let nodes = '';
    mapStores.forEach(store => {
        const P = MM.positions[store.id];
        const id = 'neuron-' + store.id;
        neurons += `<path id="${id}" class="neuron" d="${neuronPath(MM.center, P)}" stroke="${MM.brand[store.id]}"/>`;
        neurons += pulse(id, MM.brand[store.id]);
        nodes += storeNode(store, P, MM.brand[store.id], store.items.length);
    });

    svg.innerHTML = defs +
        `<g class="neurons">${neurons}</g>` +
        `<g class="nodes">${nodes}</g>` +
        `<g id="subnodes"></g>`;
    requestAnimationFrame(layoutOverlays);
    if (!layoutOverlays._bound) {
        layoutOverlays._bound = true;
        window.addEventListener('resize', layoutOverlays);
    }
}

/* HTML-слои, привязанные к геометрии SVG: бейджи магазинов + подпись */
function layoutOverlays() {
    renderStoreIcons();
    positionBrainCaption();
}

/* Подпись «Рабочий ассистент» — по центру, ниже кнопок ОЗОН/ВБ и их
   подписей (в SVG это y=596), чтобы не наезжала на круглые кнопки. */
function positionBrainCaption() {
    const panel = document.getElementById('mindmapPanel');
    const svg = document.getElementById('mindmap');
    const cap = document.querySelector('.brain-caption');
    if (!panel || !svg || !cap) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const prect = panel.getBoundingClientRect();
    const pt = svg.createSVGPoint();
    pt.x = 500; pt.y = 645;
    const sp = pt.matrixTransform(ctm);
    cap.style.left = (sp.x - prect.left) + 'px';
    cap.style.top = (sp.y - prect.top) + 'px';
}

function buildSubnodes(id) {
    const store = stores.find(s => s.id === id);
    const P = MM.positions[id];
    const color = MM.brand[id];
    const items = store.items;
    const n = items.length;
    const dx = P.x - MM.center.x, dy = P.y - MM.center.y;
    const base = Math.atan2(dy, dx);
    const spread = Math.min(54, 260 / Math.max(n, 1)) * Math.PI / 180;
    const dist = 168;

    let out = '';
    items.forEach((item, i) => {
        const ang = base + (i - (n - 1) / 2) * spread;
        let sx = P.x + Math.cos(ang) * dist;
        let sy = P.y + Math.sin(ang) * dist;
        const saved = subPos[`${id}:${item.id}`];
        if (saved) { sx = saved.x; sy = saved.y; }
        const ico = ITEM_ICONS[item.id] || SUB_ICONS[i % SUB_ICONS.length];
        const w = Math.max(158, Math.min(330, item.title.length * 7.4 + 92));
        const nid = `sub-${id}-${i}`;
        out += `<path id="${nid}" class="neuron sub-neuron" d="${neuronPath(P, { x: sx, y: sy })}" stroke="${color}"/>`;
        out += pulse(nid, color);
        out += `<g class="subnode" data-store="${id}" data-item="${item.id}" data-index="${i}" transform="translate(${sx.toFixed(1)},${sy.toFixed(1)})">
            <rect class="sub-pill" x="${(-w / 2).toFixed(1)}" y="-19" width="${w.toFixed(1)}" height="38" rx="19" stroke="${color}"/>
            <circle class="sub-dot" cx="${(-w / 2 + 18).toFixed(1)}" cy="0" r="4.5" fill="${color}"/>
            <text class="sub-text" x="${(-w / 2 + 32).toFixed(1)}" y="7">${item.title}</text>
        </g>`;
    });
    return out;
}

function onMindMapClick(e) {
    if (justDragged) return;
    const sub = e.target.closest('.subnode');
    if (sub) { handleItemClick(sub.dataset.store, sub.dataset.item); return; }
    const node = e.target.closest('.store-node');
    if (node) { toggleStore(node.dataset.store); return; }
}

function toggleStore(id) {
    if (activeStore === id) { resetStores(); return; }
    activeStore = id;
    const svg = document.getElementById('mindmap');
    svg.classList.add('has-active');
    svg.querySelectorAll('.store-node').forEach(n =>
        n.classList.toggle('active', n.dataset.store === id));
    document.getElementById('subnodes').innerHTML = buildSubnodes(id);
    attachSubDrag(id);
}

function saveSubPos(storeId, itemId, x, y) {
    subPos[`${storeId}:${itemId}`] = { x, y };
    try { localStorage.setItem('ra-subpos', JSON.stringify(subPos)); } catch (e) {}
}

function attachSubDrag(storeId) {
    const svg = document.getElementById('mindmap');
    const P = MM.positions[storeId];
    const subs = svg.querySelectorAll('#subnodes .subnode');
    subs.forEach(g => {
        g.style.cursor = 'grab';
        g.style.touchAction = 'none';
        let dragging = false, moved = false, start = null, origin = null;

        const toSvg = (ev) => {
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX; pt.y = ev.clientY;
            return pt.matrixTransform(svg.getScreenCTM().inverse());
        };

        g.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            dragging = true; moved = false;
            start = toSvg(ev);
            const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute('transform'));
            origin = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
            g.setPointerCapture(ev.pointerId);
            g.style.cursor = 'grabbing';
        });

        g.addEventListener('pointermove', (ev) => {
            if (!dragging) return;
            const p = toSvg(ev);
            const dx = p.x - start.x, dy = p.y - start.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            let nx = Math.max(40, Math.min(960, origin.x + dx));
            let ny = Math.max(40, Math.min(760, origin.y + dy));
            g.setAttribute('transform', `translate(${nx.toFixed(1)},${ny.toFixed(1)})`);
            const nid = 'sub-' + storeId + '-' + g.dataset.index;
            const path = document.getElementById(nid);
            if (path) path.setAttribute('d', neuronPath(P, { x: nx, y: ny }));
        });

        g.addEventListener('pointerup', (ev) => {
            if (!dragging) return;
            dragging = false;
            g.style.cursor = 'grab';
            try { g.releasePointerCapture(ev.pointerId); } catch (e) {}
            const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute('transform'));
            const nx = parseFloat(m[1]), ny = parseFloat(m[2]);
            saveSubPos(storeId, g.dataset.item, nx, ny);
            if (moved) { justDragged = true; setTimeout(() => { justDragged = false; }, 400); }
        });
    });
}

function resetStores() {
    activeStore = null;
    const svg = document.getElementById('mindmap');
    svg.classList.remove('has-active');
    svg.querySelectorAll('.store-node').forEach(n => n.classList.remove('active'));
    document.getElementById('subnodes').innerHTML = '';
}

/* ---------- Particles ---------- */

/* Полосы по периметру панели: GIF-ки живут вдоль краёв центральной
   картинки и не залетают на мозг, круглые кнопки магазинов и подписи. */
const PARTICLE_BANDS = [
    { edge: 'top',    top: [1, 9],   left: [2, 98] },
    { edge: 'right',  top: [6, 74],  left: [87, 94] },
    { edge: 'bottom', top: [79, 88], left: [2, 98] },
    { edge: 'left',   top: [6, 74],  left: [2, 9] }
];

function setupParticles() {
    const box = document.getElementById('particles');
    const rand = (min, max) => min + Math.random() * (max - min);
    let html = '';
    PARTICLE_GIFS.forEach((ic, i) => {
        const band = PARTICLE_BANDS[i % PARTICLE_BANDS.length];
        let top = Math.round(rand(band.top[0], band.top[1]));
        let left = Math.round(rand(band.left[0], band.left[1]));
        // На верхней полосе не даём картинке зависать над кнопкой ЯМ
        if (band.edge === 'top' && left > 32 && left < 68) {
            left = left < 50 ? Math.round(rand(2, 32)) : Math.round(rand(68, 98));
        }
        const size = 44 + (i % 4) * 12;
        const dur = (16 + Math.random() * 16).toFixed(1);
        const delay = (-Math.random() * 26).toFixed(1);
        html += `<img class="particle gif" src="assets/icons/${ic}.gif" alt=""
            style="top:${top}%;left:${left}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s"/>`;
    });
    box.innerHTML = html;
}

/* ---------- Navigation ---------- */

function handleItemClick(storeId, itemId) {
    const store = stores.find(s => s.id === storeId);
    const item = store.items.find(i => i.id === itemId);
    if (!store || !item) return;

    if (item.path) {
        window.location.href = item.path;
        return;
    }
    openInstruction(store, item);
}

function openMainInstruction() {
    const store = stores.find(s => s.id === 'general');
    if (!store) return;
    const item = store.items.find(i => i.isMainInstruction) || store.items[0];
    openInstruction(store, item);
}

function openInstruction(store, item) {
    const content = document.getElementById('instructionContent');

    if (item.isMainInstruction) {
        content.innerHTML = `
            <div class="site-instruction">
                <div class="si-hero">
                    <span class="si-hero-ico">🛠️</span>
                    <h2>Рабочий Ассистент</h2>
                    <p>Единая платформа для сбора всех сверок и инструкций по работе с маркетплейсами — ЯндексМаркет, ОЗОН и Wildberries. Все инструменты в одном месте для удобной и быстрой работы.</p>
                </div>

                <div class="si-masonry">
                    <div class="instruction-section acc-purple">
                        <div class="si-head"><span class="si-emoji">🏠</span><h3>Что это за сайт?</h3></div>
                        <p><strong>Рабочий Ассистент</strong> — единая платформа, где собраны все сверки и инструкции по работе с маркетплейсами: ЯндексМаркет, ОЗОН и Wildberries.</p>
                        <p><strong>Цель</strong> — собрать все необходимые инструменты в одном месте, чтобы работать удобно и быстро.</p>
                    </div>

                    <div class="instruction-section warning acc-fire">
                        <div class="si-head"><span class="si-emoji">🔥</span><h3>Важно!</h3></div>
                        <p><strong>Если в инструкции к сверке НЕ написано, что нужно переводить PDF-файл в Excel или какой-то другой формат, — мы этого НЕ ДЕЛАЕМ!</strong></p>
                        <p>Загружайте файлы в том формате, который указан в инструкции: PDF остаётся PDF, Excel остаётся Excel.</p>
                    </div>

                    <div class="instruction-section acc-blue si-wide">
                        <div class="si-head"><span class="si-emoji">📚</span><h3>Разделы сайта</h3></div>
                        <div class="si-stores">
                            <div class="si-store st-gen">
                                <div class="si-store-head"><span class="si-store-ico">📖</span>Инструкция</div>
                                <p class="si-store-note">Здесь хранятся все инструкции по работе с каждым магазином.</p>
                            </div>
                            <div class="si-store st-ya">
                                <div class="si-store-head"><span class="si-store-ico">🚚</span>ЯндексМаркет</div>
                                <ul>
                                    <li><a href="data/yandex-market/otmenennye-zakazy/index.html" class="sverka-link">Отменённые заказы</a><span class="si-li-desc">показывает заказы из реестра 1С, которые отменены в ЛК (файл order_service со статусом «Отменён в процессе обработки»)</span></li>
                                    <li><a href="data/yandex-market/shk-reestr/index.html" class="sverka-link">Сверка ШК и реестра 1С</a><span class="si-li-desc">сравнивает штрихкоды из PDF с наклейками и реестром номеров из 1С</span></li>
                                    <li><a href="data/yandex-market/akt-reestr/index.html" class="sverka-link">Сверка АКТ и реестр</a><span class="si-li-desc">сравнивает номера из акта (PDF) с реестром номеров из 1С</span></li>
                                    <li><a href="data/yandex-market/gruzomesta/index.html" class="sverka-link">Сверка по грузоместам</a><span class="si-li-desc">сравнивает количество грузомест из Excel-файла ЛК с реестром из 1С</span></li>
                                    <li><a href="data/yandex-market/podpis-etiketok/index.html" class="sverka-link">Подпись этикеток</a><span class="si-li-desc">подписывает названия товаров на этикетках из PDF — остаются только заказы с количеством 1 из реестра 1С, внизу список удалённых с причинами</span></li>
                                </ul>
                            </div>
                            <div class="si-store st-ozon">
                                <div class="si-store-head"><span class="si-store-ico">🏪</span>ОЗОН</div>
                                <ul>
                                    <li><a href="data/ozon/list-reestr/index.html" class="sverka-link">Сверка Лист отгрузки и реестр</a><span class="si-li-desc">сравнивает номера отгрузок из листа отгрузки (PDF) с номерами из 1С</span></li>
                                    <li><a href="data/ozon/podbor-reestr/index.html" class="sverka-link">Сверка Лист подбора и реестр</a><span class="si-li-desc">сравнивает номера из листа подбора (PDF) с реестром</span></li>
                                    <li><a href="data/ozon/podbor-stickers/index.html" class="sverka-link">Лист подбора и наклейки</a><span class="si-li-desc">формирует Лист подбора в Excel (по алфавиту, названия из прайса) и PDF с наклейками в том же порядке</span></li>
                                    <li><a href="data/ozon/otmenennye-zakazy/index.html" class="sverka-link">Отменённые заказы и реестр</a><span class="si-li-desc">показывает номера из реестра 1С (столбик Телефон1), которые есть среди отменённых отправлений из ЛК Ozon</span></li>
                                </ul>
                            </div>
                            <div class="si-store st-wb">
                                <div class="si-store-head"><span class="si-store-ico">🏪</span>Wildberries</div>
                                <ul>
                                    <li><a href="data/wildberries/couriers/index.html" class="sverka-link">Курьеры экспресс</a><span class="si-li-desc">формирует файлы для назначения курьеров на основе Excel-файла</span></li>
                                    <li><a href="data/wildberries/wb-lp/index.html" class="sverka-link">Лист подбора ВБ (LP)</a><span class="si-li-desc">склеивает файлы WB-GI и wb в готовый Лист подбора со стикерами, артикулами и подсветкой отказов</span></li>
                                    <li><a href="data/wildberries/wb-lp-pics/index.html" class="sverka-link">ЛП ВБ с картинками и 1С</a><span class="si-li-desc">собирает Лист подбора в Excel: фото из конверта PDF→Word, «Наименование 1С» по артикулу из прайса, «Номер документа» из заказов МБТ, этикетки ШК колонкой</span></li>
                                    <li><a href="data/wildberries/otmenennye-zakazy/index.html" class="sverka-link">Отменённые заказы и реестр</a><span class="si-li-desc">показывает номера из реестра 1С (Идентификатор МП или Телефон1), которые есть среди отменённых заданий из ЛК WB (столбик № задания)</span></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        content.innerHTML = `
            <h2>${item.title}</h2>
            <p>${store.title}</p>
            <div class="instruction-steps">
                <ol>${item.steps.map(s => `<li>${s}</li>`).join('')}</ol>
            </div>
            ${item.messageTemplate ? `
                <div class="message-template">
                    <h4>📝 Шаблон сообщения</h4>
                    <p id="templateText">${item.messageTemplate}</p>
                    <button class="copy-btn" onclick="copyTemplate()"><img class="btn-icon" src="assets/icons/copy.svg" alt=""> <span id="copyLabel">Копировать</span></button>
                </div>
            ` : ''}
        `;
    }

    document.getElementById('instructionScreen').classList.remove('hidden');
    document.getElementById('mindmapPanel').classList.add('hidden');
    document.getElementById('storesGrid').classList.add('hidden');
    document.querySelector('.search-box').classList.add('hidden');
}

function closeInstruction() {
    document.getElementById('instructionScreen').classList.add('hidden');
    document.querySelector('.search-box').classList.remove('hidden');
    showHome();
}

function showHome() {
    const q = document.getElementById('searchInput').value.trim();
    const grid = document.getElementById('storesGrid');
    const panel = document.getElementById('mindmapPanel');
    if (q.length >= 2) {
        grid.classList.remove('hidden');
        panel.classList.add('hidden');
    } else {
        panel.classList.remove('hidden');
        grid.classList.add('hidden');
    }
}

function copyTemplate() {
    const text = document.getElementById('templateText');
    if (!text) return;
    navigator.clipboard.writeText(text.textContent).then(() => {
        const label = document.getElementById('copyLabel');
        if (label) {
            label.textContent = '✅ Скопировано!';
            setTimeout(() => label.textContent = 'Копировать', 1500);
        }
    });
}

/* ---------- Search ---------- */

function setupSearch() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const grid = document.getElementById('storesGrid');
        const panel = document.getElementById('mindmapPanel');

        if (query.length < 2) {
            showHome();
            return;
        }

        const results = [];
        stores.forEach(store => {
            store.items.forEach(item => {
                const inTitle = item.title.toLowerCase().includes(query);
                const inSteps = item.steps && item.steps.some(s => s.toLowerCase().includes(query));
                if (inTitle || inSteps) {
                    results.push({ ...item, storeTitle: store.title, storeId: store.id });
                }
            });
        });

        panel.classList.add('hidden');
        grid.classList.remove('hidden');

        if (results.length === 0) {
            grid.innerHTML = '<p style="text-align:center; color:#86868b; padding:40px; grid-column:1/-1;">Ничего не найдено</p>';
        } else {
            grid.innerHTML = results.map(item => {
                const store = stores.find(s => s.id === item.storeId);
                return `
                <div class="store-card ${store.class}" onclick="handleItemClick('${item.storeId}', '${item.id}')">
                    <img class="store-icon" src="${store.icon}" alt="${item.storeTitle}">
                    <h3>${item.title}</h3>
                    <p>${item.storeTitle}</p>
                </div>
                `;
            }).join('');
        }
    });
}
