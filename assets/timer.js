/* ===== Pomodoro-таймер с музыкой фокуса ===== */
(function () {
  function $(id) { return document.getElementById(id); }

  var els = {
    toggle: $('pomoToggle'), panel: $('pomoPanel'), mode: $('pomoMode'),
    time: $('pomoTime'), prog: $('pomoProg'), start: $('pomoStart'),
    reset: $('pomoReset'), skip: $('pomoSkip'), close: $('pomoClose'),
    music: $('pomoMusic')
  };

  var R = 52, C = 2 * Math.PI * R;
  els.prog.style.strokeDasharray = C.toFixed(1);

  var state = {
    work: 25, break: 5,
    mode: 'work',
    total: 25 * 60,
    remaining: 25 * 60,
    running: false,
    startTs: 0,
    tick: null,
    music: false
  };

  try {
    var s = JSON.parse(localStorage.getItem('ra-pomo') || '{}');
    if (s.work) state.work = s.work;
    if (s.break) state.break = s.break;
    if (typeof s.music === 'boolean') state.music = s.music;
  } catch (e) {}

  function save() {
    try {
      localStorage.setItem('ra-pomo', JSON.stringify({ work: state.work, break: state.break, music: state.music }));
    } catch (e) {}
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function render() {
    var frac = state.total ? state.remaining / state.total : 0;
    els.prog.style.strokeDashoffset = (C * (1 - frac)).toFixed(1);
    els.time.textContent = fmt(state.remaining);
    els.mode.textContent = state.mode === 'work' ? 'Фокус' : 'Перерыв';
    els.panel.classList.toggle('break', state.mode === 'break');
    els.start.textContent = state.running ? 'Пауза' : 'Старт';
  }

  /* Независимый «дождь» для фокуса — НЕ трогает фоновую музыку сайта */
  var PomoAudio = (function () {
    var ctx = null, master = null, nodes = [], buf = null, on = false;
    function ensure() {
      if (ctx) return true;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination);
        return true;
      } catch (e) { return false; }
    }
    function noise() {
      if (buf) return buf;
      var len = ctx.sampleRate * 2, d = ctx.createBuffer(1, len, ctx.sampleRate).getChannelData(0), last = 0;
      buf = ctx.createBuffer(1, len, ctx.sampleRate); d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.0; }
      return buf;
    }
    function stopNodes() {
      nodes.forEach(function (o) { try { if (o.stop) o.stop(); } catch (e) {} try { o.disconnect(); } catch (e) {} });
      nodes = [];
    }
    function start() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      stopNodes();
      var n = ctx.createBufferSource(); n.buffer = noise(); n.loop = true;
      var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
      var g = ctx.createGain(); g.gain.value = 0.10; n.connect(f); f.connect(g); g.connect(master); n.start();
      var n2 = ctx.createBufferSource(); n2.buffer = noise(); n2.loop = true;
      var f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 4200;
      var g2 = ctx.createGain(); g2.gain.value = 0.045; n2.connect(f2); f2.connect(g2); g2.connect(master); n2.start();
      nodes.push(n, f, g, n2, f2, g2);
      on = true;
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
      master.gain.linearRampToValueAtTime(0.5, t + 1.2);
    }
    function stop() {
      if (!ctx) return;
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + 0.8);
      on = false;
      setTimeout(stopNodes, 900);
    }
    return { start: start, stop: stop };
  })();

  function applyMusic() {
    if (state.music && state.running && state.mode === 'work') PomoAudio.start();
    else PomoAudio.stop();
  }

  function tick() {
    var elapsed = (Date.now() - state.startTs) / 1000;
    state.remaining = state.total - elapsed;
    if (state.remaining <= 0) {
      state.remaining = 0;
      render();
      phaseEnd();
      return;
    }
    render();
  }

  function start() {
    if (state.running) { pause(); return; }
    if (state.remaining <= 0) state.remaining = state.total;
    state.startTs = Date.now() - (state.total - state.remaining) * 1000;
    state.running = true;
    state.tick = setInterval(tick, 250);
    applyMusic();
    render();
  }

  function pause() {
    state.running = false;
    if (state.tick) clearInterval(state.tick);
    state.remaining = Math.max(0, state.total - (Date.now() - state.startTs) / 1000);
    applyMusic();
    render();
  }

  function reset() {
    state.running = false;
    if (state.tick) clearInterval(state.tick);
    state.total = (state.mode === 'work' ? state.work : state.break) * 60;
    state.remaining = state.total;
    applyMusic();
    render();
  }

  function setPhase(mode) {
    state.mode = mode;
    state.total = (mode === 'work' ? state.work : state.break) * 60;
    state.remaining = state.total;
    render();
  }

  function phaseEnd() {
    state.running = false;
    if (state.tick) clearInterval(state.tick);
    if (window.AmbientAudio) AmbientAudio.chime(3, state.mode === 'work');
    var next = state.mode === 'work' ? 'break' : 'work';
    setPhase(next);
    // авто-старт следующей фазы
    state.startTs = Date.now();
    state.running = true;
    state.tick = setInterval(tick, 250);
    applyMusic();
    render();
  }

  function setPreset(w, b) {
    state.work = w; state.break = b; save();
    if (!state.running) setPhase(state.mode);
    else { state.total = (state.mode === 'work' ? w : b) * 60; state.remaining = state.total; render(); }
  }

  els.start.addEventListener('click', function (e) { e.stopPropagation(); start(); });
  els.reset.addEventListener('click', function (e) { e.stopPropagation(); reset(); });
  els.skip.addEventListener('click', function (e) { e.stopPropagation(); phaseEnd(); });
  els.close.addEventListener('click', function (e) { e.stopPropagation(); els.panel.classList.remove('open'); els.toggle.classList.remove('active'); });
  els.toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = els.panel.classList.toggle('open');
    els.toggle.classList.toggle('active', open);
  });
  els.music.addEventListener('change', function () {
    state.music = els.music.checked; save();
    if (state.music && !state.running) start();
    else applyMusic();
  });

  document.querySelectorAll('.pomo-presets button').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      setPreset(parseInt(b.dataset.w, 10), parseInt(b.dataset.b, 10));
    });
  });

  // перетаскивание виджета
  (function () {
    var bar = els.panel.querySelector('.pomo-head');
    var drag = false, ox = 0, oy = 0;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target === els.close) return;
      drag = true; ox = e.clientX; oy = e.clientY;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - ox, dy = e.clientY - oy;
      var r = els.toggle.parentElement.getBoundingClientRect();
      var x = Math.min(window.innerWidth - 80, Math.max(0, r.left + dx));
      var y = Math.min(window.innerHeight - 80, Math.max(0, r.top + dy));
      els.toggle.parentElement.style.left = x + 'px';
      els.toggle.parentElement.style.top = y + 'px';
      els.toggle.parentElement.style.right = 'auto';
      els.toggle.parentElement.style.bottom = 'auto';
    });
    bar.addEventListener('pointerup', function (e) { drag = false; try { bar.releasePointerCapture(e.pointerId); } catch (_) {} });
  })();

  document.addEventListener('click', function () {
    els.panel.classList.remove('open');
    els.toggle.classList.remove('active');
  });

  // инициализация
  els.music.checked = state.music;
  setPhase('work');
})();
