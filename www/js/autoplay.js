/* ===== AUTO-PLAY ENGINE ===== */
'use strict';

const AutoPlay = (() => {
  let _active = false;
  let _paused = false;
  let _stopped = true;
  let _lesson = null;
  let _btnViClass = '';
  let _currentCard = null;
  let _pauseTimer = null;
  let _bgActive = false;
  let _resolveWait = null;
  let _customLabel = null;
  let _loopMode = false;

  function setLesson(lesson, btnViClass, customLabel) {
    _lesson = lesson;
    _btnViClass = btnViClass;
    _customLabel = customLabel || null;
    _loopMode = false;
  }

  function setLoop(enabled) { _loopMode = !!enabled; }
  function getLoop() { return _loopMode; }

  function toggleLoop() {
    _loopMode = !_loopMode;
    const btn = document.getElementById('ap-loop-btn');
    if (btn) {
      btn.textContent = _loopMode ? '🔁 Повтор: ВКЛ' : '🔁 Повтор';
      btn.classList.toggle('active', _loopMode);
    }
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(_loopMode ? 'Зацикленный плей включён' : 'Зацикленный плей выключен');
    }
  }

  function toggle() {
    if (_active) stop();
    else start();
  }

  function togglePause() {
    if (!_active) return;
    if (_paused) {
      _paused = false;
      document.getElementById('ap-pause-btn').textContent = '⏸';
      document.getElementById('ap-bar-status').textContent = 'Воспроизводится...';
      if (_resolveWait) { _resolveWait(); _resolveWait = null; }
    } else {
      _paused = true;
      document.getElementById('ap-pause-btn').textContent = '▶';
      document.getElementById('ap-bar-status').textContent = 'Пауза';
      TTS.stopAll();
    }
  }

  function _enableBackgroundMode() {
    if (_bgActive) return;
    _bgActive = true;
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      try { window.Capacitor.Plugins.BackgroundTts.enableBackground(); } catch(e) {}
    }
    // Always run the silent keep-alive: Chromium WebView throttles setTimeout
    // to once-per-minute when the page is "silent", so we keep an AudioContext
    // streaming silence to mark the page as actively playing audio.
    _keepAlive();
  }

  function _disableBackgroundMode() {
    if (!_bgActive) return;
    _bgActive = false;
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      try { window.Capacitor.Plugins.BackgroundTts.disableBackground(); } catch(e) {}
    }
    if (AutoPlay._keepAliveCtx) {
      try { AutoPlay._keepAliveCtx.close(); } catch(e) {}
      AutoPlay._keepAliveCtx = null;
    }
  }

  function _keepAlive() {
    if (AutoPlay._keepAliveCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      // Silent looping buffer so the page stays "audible" even between TTS chunks
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      silentSrc.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      silentSrc.connect(gain).connect(ctx.destination);
      silentSrc.start();
      // Some WebViews start the context in 'suspended' until a user gesture; resume defensively
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
      AutoPlay._keepAliveCtx = ctx;
    } catch(e) {}
  }

  async function start() {
    if (!_lesson) return;
    _active = true;
    _stopped = false;
    _paused = false;

    // Always run in background-friendly mode: keeps audio alive with screen off
    _enableBackgroundMode();

    _updateBtn();
    _showBar();

    const cards = _getAllPlayableCards();
    if (!cards.length) {
      App.showToast('Нет фраз для воспроизведения');
      stop();
      return;
    }

    let cycle = 1;
    do {
      await _playCards(cards, 1, cycle);
      if (_stopped) return;
      await _playCards(cards, 2, cycle);
      if (_stopped) return;
      if (_loopMode && !_stopped) {
        cycle += 1;
        // Brief pause before next cycle
        await _delay(1200);
        if (_stopped) return;
      }
    } while (_loopMode && !_stopped);

    stop();
    App.showToast('Авто-плей завершён ✓');
  }

  function _getAllPlayableCards() {
    // Use the currently active screen as the source of cards.
    // This makes AutoPlay work for both lessons and folder-play screens.
    const active = document.querySelector('.screen.active');
    if (!active) return [];
    const vocabSection = active.querySelector('#ls-vocabulary');
    const allCards = Array.from(active.querySelectorAll('.example-card'));
    return allCards.filter(card => !vocabSection || !vocabSection.contains(card));
  }

  async function _playCards(cards, pass, cycle) {
    for (const card of cards) {
      if (_stopped) return;
      await _waitIfPaused();
      if (_stopped) return;

      _highlightCard(card);

      const viText = card.dataset.vi || card.querySelector('.example-vi')?.textContent?.trim() || '';
      const ruText = card.dataset.ru || card.querySelector('.example-ru')?.textContent?.trim() || '';

      const btnVI = card.querySelector('.btn-tts-vi');
      const btnRU = card.querySelector('.btn-tts-ru');

      // Sequence: RU → pause → VI → pause → VI
      if (pass === 1) {
        await TTS.speakPromise(ruText, 'ru', btnRU);
        if (_stopped) return;
        await _delay(1800);
        if (_stopped) return;
        await TTS.speakPromise(viText, 'vi', btnVI);
        if (_stopped) return;
        await _delay(1500);
        if (_stopped) return;
        await TTS.speakPromise(viText, 'vi', btnVI);
        if (_stopped) return;
        await _delay(2000);
      } else {
        // Second pass: VI only
        await TTS.speakPromise(viText, 'vi', btnVI);
        if (_stopped) return;
        await _delay(2000);
      }

      // Update status bar
      const allCards = _getAllPlayableCards();
      const idx = allCards.indexOf(card);
      const cyclePart = (_loopMode && cycle && cycle > 0) ? `🔁 Цикл ${cycle} · ` : '';
      document.getElementById('ap-bar-status').textContent =
        `${cyclePart}Проход ${pass}/2 · Фраза ${idx + 1}/${allCards.length}`;
    }
  }

  async function _waitIfPaused() {
    while (_paused && !_stopped) {
      await new Promise(resolve => {
        _resolveWait = resolve;
        setTimeout(resolve, 100); // safety timeout
      });
    }
  }

  function _delay(ms) {
    // Use plugin-side Handler.postDelayed when available — bypasses Chromium
    // WebView's background timer throttling (which clamps setTimeout to ~1/min
    // when the page is hidden, making JS-driven pauses stretch from 1.5s to 60s).
    const plugin = window.Capacitor?.Plugins?.BackgroundTts;
    if (plugin && typeof plugin.delay === 'function') {
      return plugin.delay({ ms }).catch(() => new Promise(resolve => {
        _pauseTimer = setTimeout(resolve, ms);
      }));
    }
    return new Promise(resolve => {
      _pauseTimer = setTimeout(resolve, ms);
    });
  }

  function _highlightCard(card) {
    if (_currentCard) _currentCard.classList.remove('ap-active');
    _currentCard = card;
    if (card) {
      card.classList.add('ap-active');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function _updateBtn() {
    const btn = document.getElementById('ap-toggle-btn');
    if (!btn) return;
    if (_active) {
      btn.textContent = '⏹ Стоп';
      btn.classList.add('active');
    } else {
      btn.textContent = '▶ Авто-плей';
      btn.classList.remove('active');
    }
  }

  function _showBar() {
    const bar = document.getElementById('autoplay-bar');
    if (!bar) return;
    bar.style.display = 'flex';
    document.getElementById('ap-bar-lesson').textContent =
      _customLabel || (_lesson ? `Урок ${_lesson.level}-${_lesson.num}: ${_lesson.title}` : '');
    document.getElementById('ap-bar-status').textContent = 'Воспроизводится...';
    document.getElementById('ap-pause-btn').textContent = '⏸';
  }

  function _hideBar() {
    const bar = document.getElementById('autoplay-bar');
    if (bar) bar.style.display = 'none';
  }

  function stop() {
    _stopped = true;
    _active = false;
    _paused = false;
    if (_pauseTimer) { clearTimeout(_pauseTimer); _pauseTimer = null; }
    if (_resolveWait) { _resolveWait(); _resolveWait = null; }
    TTS.stopAll();
    if (_currentCard) { _currentCard.classList.remove('ap-active'); _currentCard = null; }
    _updateBtn();
    _hideBar();
    _disableBackgroundMode();
  }

  return { setLesson, toggle, togglePause, toggleLoop, setLoop, getLoop, stop };
})();
