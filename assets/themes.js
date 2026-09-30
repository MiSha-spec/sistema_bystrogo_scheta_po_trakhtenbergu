/* ===== Переключатель тем оформления ===== */
(function () {
  var THEMES = [
    { key: 'light', name: 'Светлая', c: 'linear-gradient(135deg,#f3eeff,#d8d0f5)' },
    { key: 'dark', name: 'Тёмная', c: 'linear-gradient(135deg,#2b2152,#08061c)' },
    { key: 'white', name: 'Белая', c: '#ffffff' },
    { key: 'forest', name: 'Лес', c: 'linear-gradient(135deg,#1f9d5a,#3fb56e)' },
    { key: 'leaves', name: 'Листья', c: 'linear-gradient(135deg,#2f7d4f,#1f5c39)' },
    { key: 'pattern2', name: 'Золото', c: 'linear-gradient(135deg,#6c63ff,#3b82f6)' },
    { key: 'pattern3', name: 'Хром', c: 'linear-gradient(135deg,#b9772e,#d4a017)' },
    { key: 'urban', name: 'Урбан', c: 'linear-gradient(135deg,#3a4250,#10141a)' },
    { key: 'abstract', name: 'Абстракт', c: 'linear-gradient(135deg,#5a3fae,#1a1438)' }
  ];

  function current() {
    return localStorage.getItem('ra-theme') || 'light';
  }

  function apply() {
    document.documentElement.setAttribute('data-theme', current());
  }

  function build() {
    var btn = document.getElementById('themeToggle');
    if (!btn || btn.dataset.built) return;
    btn.dataset.built = '1';
    btn.textContent = '🎨';
    btn.title = 'Оформление';
    btn.setAttribute('aria-label', 'Оформление');

    var menu = document.createElement('div');
    menu.className = 'theme-menu';

    THEMES.forEach(function (th) {
      var b = document.createElement('button');
      b.className = 'theme-swatch';
      b.title = th.name;
      b.style.background = th.c;
      b.dataset.theme = th.key;
      if (current() === th.key) b.classList.add('active');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        document.documentElement.setAttribute('data-theme', th.key);
        localStorage.setItem('ra-theme', th.key);
        menu.querySelectorAll('.theme-swatch').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        menu.classList.remove('open');
      });
      menu.appendChild(b);
    });

    btn.parentNode.insertBefore(menu, btn.nextSibling);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
  }

  window.ThemePicker = { THEMES: THEMES, apply: apply, build: build };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(); build(); });
  } else { apply(); build(); }
})();
