/* ===== Фоновые звуки =====
   Дождь, птицы, костёр, ветер, море — синтез через Web Audio API.
   Поезд, мотор и лес — настоящие записи (зацикленные):
     • assets/sounds/train-loop.mp3 — «Train passing by and horning in
       Romania (Bacau)» felix.blume, Freesound, CC0 1.0
     • assets/sounds/car-passing.mp3 — «Old cars passing by.wav» Ryding,
       Freesound, CC BY 4.0
     • assets/sounds/forest-loop.mp3 — «sfx_amb_forest_spring_afternoon-01.wav»
       bajko, Freesound, CC0 1.0 */
(function () {
  /* Корректный базовый путь: на главной — assets/, на вложенных
     страницах (data/...) — на три уровня выше. */
  var ASSETS = /\/data\//.test(location.href) ? '../../../assets/' : 'assets/';

  var SOUNDS = [
    { key: 'off', name: 'Выкл', icon: '🔇' },
    { key: 'ocean', name: 'Море', icon: '🌊' },
    { key: 'rain', name: 'Дождь', icon: '🌧️' },
    { key: 'forest', name: 'Лес', icon: '🌲' },
    { key: 'birds', name: 'Птицы', icon: '🐦' },
    { key: 'train', name: 'Поезд', icon: '🚆' },
    { key: 'car', name: 'Мотор', icon: '🚗' },
    { key: 'fire', name: 'Костёр', icon: '🔥' },
    { key: 'wind', name: 'Ветер', icon: '🍃' }
  ];

  var AmbientAudio = {
    ctx: null,
    master: null,
    nodes: [],
    timers: [],
    media: [],   // зацикленные Audio-элементы (настоящие записи)
    type: 'off',

    ensure: function () {
      if (this.ctx) return true;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    },

    _noiseBuffer: function () {
      if (this._nb) return this._nb;
      var len = this.ctx.sampleRate * 2;
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.0;
      }
      this._nb = buf;
      return buf;
    },

    _brown: function (gain) {
      var src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      src.loop = true;
      var g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      src.start();
      this.nodes.push(src, g);
      return { src: src, g: g };
    },

    _white: function (gain) {
      var src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      src.loop = true;
      var g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      src.start();
      this.nodes.push(src, g);
      return { src: src, g: g };
    },

    _lpf: function (freq, q) {
      var f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      f.Q.value = q || 0.7;
      this.nodes.push(f);
      return f;
    },

    _bpf: function (freq, q) {
      var f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q || 0.7;
      this.nodes.push(f);
      return f;
    },

    _hpf: function (freq, q) {
      var f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = freq;
      f.Q.value = q || 0.7;
      this.nodes.push(f);
      return f;
    },

    _osc: function (freq, type, gain) {
      var o = this.ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = freq;
      var g = this.ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      o.start();
      this.nodes.push(o, g);
      return { o: o, g: g };
    },

    _lfo: function (freq, depth, target, base) {
      var lfo = this._osc(freq, 'sine', depth);
      lfo.g.connect(target);
      if (base !== undefined) target.value = base;
      return lfo;
    },

    _chirp: function () {
      var o = this.ctx.createOscillator();
      o.type = 'sine';
      var f0 = 1800 + Math.random() * 1600;
      o.frequency.setValueAtTime(f0, this.ctx.currentTime);
      o.frequency.linearRampToValueAtTime(f0 + (Math.random() < 0.5 ? -500 : 600), this.ctx.currentTime + 0.09);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.10, this.ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.18);
      o.connect(g); g.connect(this.master);
      o.start(); o.stop(this.ctx.currentTime + 0.2);
      this.nodes.push(o, g);
    },

    _burst: function (center, q, gain, dur) {
      var src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      src.loop = true;
      var f = this._bpf(center, q);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + (dur || 0.08));
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); src.stop(this.ctx.currentTime + (dur || 0.08) + 0.02);
      this.nodes.push(src, f, g);
    },

    _sched: function (minMs, maxMs, fn) {
      var self = this;
      var tick = function () {
        fn();
        var id = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
        self.timers.push(id);
      };
      var id = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
      this.timers.push(id);
    },

    _ocean: function () {
      var n = this._brown(0.16);
      var f = this._lpf(480, 0.6); n.g.disconnect(); n.g.connect(f); f.connect(this.master);
      this._lfo(0.12, 0.10, n.g.gain, 0.16);
    },

    _rain: function () {
      var n = this._white(0.10);
      var f = this._hpf(1500, 0.5); n.g.disconnect(); n.g.connect(f); f.connect(this.master);
      var n2 = this._white(0.04);
      var f2 = this._bpf(4200, 0.6); n2.g.disconnect(); n2.g.connect(f2); f2.connect(this.master);
    },

    _wind: function () {
      var n = this._brown(0.16);
      var f = this._bpf(500, 0.8); n.g.disconnect(); n.g.connect(f); f.connect(this.master);
      this._lfo(0.08, 220, f.frequency, 500);
      var g = this.ctx.createGain(); g.gain.value = 0.26; f.disconnect(); f.connect(g); g.connect(this.master);
      this.nodes.push(g);
    },

    _forest: function () {
      // настоящая запись: весенний лес, птицы, шелест листвы
      this._media('forest-loop.mp3', 0.5);
    },

    _birds: function () {
      var n = this._brown(0.05);
      var f = this._bpf(600, 0.7); n.g.disconnect(); n.g.connect(f);
      var g = this.ctx.createGain(); g.gain.value = 0.05; f.connect(g); g.connect(this.master);
      this.nodes.push(g);
      this._sched(350, 1100, function () {
        var k = 1 + Math.floor(Math.random() * 3);
        for (var i = 0; i < k; i++) { var t = setTimeout(function () { this._chirp(); }.bind(this), i * 90); this.timers.push(t); }
      }.bind(this));
    },

    _ring: function (freq, vol, dur) {
      // «звон» металла после удара: синус с резкой атакой и затуханием
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.02);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
      this.nodes.push(o, g);
    },

    /* Настоящая запись, зацикленная (для звуков, где синтез не звучит) */
    _media: function (file, volume) {
      var a = new Audio(ASSETS + 'sounds/' + file);
      a.loop = true;
      a.volume = volume;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
      this.media.push(a);
      return a;
    },

    _train: function () {
      // настоящая запись: стук колёс, гул состава и редкий гудок
      this._media('train-loop.mp3', 0.55);
    },

    _car: function () {
      // настоящая запись: старые машины проезжают мимо
      this._media('car-passing.mp3', 0.5);
    },

    _fire: function () {
      var n = this._brown(0.12);
      var f = this._lpf(420, 0.6); n.g.disconnect(); n.g.connect(f); f.connect(this.master);
      this._sched(110, 520, function () { this._burst(3000 + Math.random() * 2500, 1.4, 0.10, 0.05); }.bind(this));
    },

    stop: function () {
      this.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      this.timers = [];
      this.media.forEach(function (a) {
        try { a.pause(); } catch (e) {}
        try { a.src = ''; } catch (e) {}
      });
      this.media = [];
      this.nodes.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) {}
        try { n.disconnect(); } catch (e) {}
      });
      this.nodes = [];
    },

    _bell: function (freq, vol, dur) {
      if (!this.ensure()) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      var o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 1.2));
      o.connect(g); o2.connect(g); g.connect(this.master);
      o.start(t); o2.start(t); o.stop(t + (dur || 1.2) + 0.05); o2.stop(t + (dur || 1.2) + 0.05);
      this.nodes.push(o, o2, g);
    },

    /* Колокольчик для таймера (times — число ударов, up — направление глиссандо) */
    chime: function (times, up) {
      if (!this.ensure()) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      times = times || 3;
      var notes = up ? [659.25, 783.99, 1046.5] : [1046.5, 783.99, 659.25];
      for (var k = 0; k < times; k++) {
        (function (self, f, d) { setTimeout(function () { self._bell(f, 0.32, 1.3); }, d); })(this, notes[k % notes.length], k * 380);
      }
    },

    /* Реальный сэмпл гудка (mp3 из папки иконок) */
    horn: function () {
      try {
        var a = new Audio('assets/icons/freesound_community-voice-horn-91157.mp3');
        a.volume = 0.5;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    },

    play: function (type) {
      if (!this.ensure()) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.stop();
      this.type = type || 'off';
      try { localStorage.setItem('ra-sound', this.type); } catch (e) {}
      if (this.type === 'off') return;
      switch (this.type) {
        case 'ocean': this._ocean(); break;
        case 'rain': this._rain(); break;
        case 'wind': this._wind(); break;
        case 'forest': this._forest(); break;
        case 'birds': this._birds(); break;
        case 'train': this._train(); break;
        case 'car': this._car(); break;
        case 'fire': this._fire(); break;
      }
    },

    restore: function () {
      var t = 'off';
      try { t = localStorage.getItem('ra-sound') || 'off'; } catch (e) {}
      this.type = t;
      if (t === 'off') return;
      var self = this;
      var start = function () {
        self.play(t);
        document.removeEventListener('pointerdown', start);
        document.removeEventListener('keydown', start);
      };
      document.addEventListener('pointerdown', start);
      document.addEventListener('keydown', start);
    }
  };

  function buildMenu() {
    var menu = document.getElementById('soundMenu');
    var btn = document.getElementById('soundBtn');
    if (!menu || menu.dataset.built) return;
    menu.dataset.built = '1';
    menu.innerHTML = '';
    SOUNDS.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'sound-opt' + (AmbientAudio.type === s.key ? ' active' : '');
      b.dataset.sound = s.key;
      b.innerHTML = '<span class="sound-ico">' + s.icon + '</span>' + s.name;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        AmbientAudio.play(s.key);
        menu.querySelectorAll('.sound-opt').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        if (btn) btn.textContent = s.icon;
        menu.classList.remove('open');
      });
      menu.appendChild(b);
    });
  }

  function wire() {
    var btn = document.getElementById('soundBtn');
    var menu = document.getElementById('soundMenu');
    if (!btn || !menu) return;
    var saved = 'off';
    try { saved = localStorage.getItem('ra-sound') || 'off'; } catch (e) {}
    if (saved !== 'off') {
      var s = SOUNDS.filter(function (x) { return x.key === saved; })[0];
      if (s) btn.textContent = s.icon;
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      buildMenu();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
  }

  window.AmbientAudio = AmbientAudio;
  function init() { AmbientAudio.restore(); wire(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
