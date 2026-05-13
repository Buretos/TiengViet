/* ===== AUTO-PLAY ENGINE ===== */
'use strict';

const AutoPlay = (() => {
  const GAP_MS = 2000;

  let _active = false;
  let _paused = false;
  let _stopped = true;
  let _lesson = null;
  let _currentCard = null;
  let _pauseTimer = null;
  let _bgActive = false;
  let _resolveWait = null;
  let _customLabel = null;
  let _loopMode = false;
  let _viOnlyMode = false;
  let _nativeProgressListener = null;
  let _nativeCompleteListener = null;

  function setLesson(lesson, btnViClass, customLabel) {
    _lesson = lesson;
    _customLabel = customLabel || null;
    _loopMode = false;
  }

  function setLoop(enabled) { _loopMode = !!enabled; }
  function getLoop() { return _loopMode; }

  function setViOnly(enabled) { _viOnlyMode = !!enabled; }
  function getViOnly() { return _viOnlyMode; }

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

  function toggleViOnly() {
    if (!_active) {
      startViOnly();
    } else {
      _viOnlyMode = !_viOnlyMode;
      const plugin = window.Capacitor?.Plugins?.BackgroundTts;
      if (plugin && typeof plugin.playSequence === 'function') {
        stop();
        start();
        return;
      }
      _updateViOnlyBtn();
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast(_viOnlyMode ? 'Режим "Только вьетнамский" включён' : 'Режим "Только вьетнамский" выключен');
      }
    }
  }

  function startViOnly() {
    if (_active) stop();
    _viOnlyMode = true;
    start();
  }

  function toggle() {
    if (_active) stop();
    else {
      _viOnlyMode = false;
      start();
    }
  }

  function togglePause() {
    if (!_active) return;
    const plugin = window.Capacitor?.Plugins?.BackgroundTts;
    if (_paused) {
      _paused = false;
      document.getElementById('ap-pause-btn').textContent = '⏸';
      document.getElementById('ap-bar-status').textContent = 'Воспроизводится...';
      try { plugin?.resumeSequence?.(); } catch(e) {}
      if (_resolveWait) { _resolveWait(); _resolveWait = null; }
    } else {
      _paused = true;
      document.getElementById('ap-pause-btn').textContent = '▶';
      document.getElementById('ap-bar-status').textContent = 'Пауза';
      try { plugin?.pauseSequence?.(); } catch(e) {}
      if (!plugin?.pauseSequence) TTS.stopAll();
    }
  }

  function _enableBackgroundMode() {
    if (_bgActive) return;
    _bgActive = true;
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      try { window.Capacitor.Plugins.BackgroundTts.enableBackground(); } catch(e) {}
    }
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
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      silentSrc.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      silentSrc.connect(gain).connect(ctx.destination);
      silentSrc.start();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
      AutoPlay._keepAliveCtx = ctx;
    } catch(e) {}
  }

  async function start() {
    if (!_lesson) return;
    TTS.unlockAudio?.();
    _active = true;
    _stopped = false;
    _paused = false;

    _enableBackgroundMode();
    _updateBtn();
    _showBar();

    const cards = _getAllPlayableCards();
    if (!cards.length) {
      App.showToast('Нет фраз для воспроизведения');
      stop();
      return;
    }

    if (_canUseNativeSequence()) {
      _startNativeSequence(cards);
      return;
    }

    let cycle = 1;
    do {
      if (_viOnlyMode) {
        // В режиме "только вьетнамский" проигрываем только один проход
        await _playCards(cards, 1, cycle);
        if (_stopped) return;
      } else {
        // Обычный режим: два прохода
        await _playCards(cards, 1, cycle);
        if (_stopped) return;
        await _playCards(cards, 2, cycle);
        if (_stopped) return;
      }
      if (_loopMode && !_stopped) {
        cycle += 1;
        await _delay(GAP_MS);
        if (_stopped) return;
      }
    } while (_loopMode && !_stopped);

    stop();
    App.showToast('Авто-плей завершён ✓');
  }

  function _canUseNativeSequence() {
    const plugin = window.Capacitor?.Plugins?.BackgroundTts;
    return !!(plugin && typeof plugin.playSequence === 'function');
  }

  async function _startNativeSequence(cards) {
    const plugin = window.Capacitor.Plugins.BackgroundTts;
    _removeNativeListeners();
    _nativeProgressListener = await plugin.addListener?.('sequenceProgress', ev => {
      if (!_active || !ev) return;
      const card = cards[ev.index];
      if (card) _highlightCard(card);
      _updateStatus(cards.length, ev.index, ev.pass, ev.cycle);
    });
    _nativeCompleteListener = await plugin.addListener?.('sequenceComplete', () => {
      if (!_active || _stopped) return;
      stop();
      App.showToast('Авто-плей завершён ✓');
    });

    const items = cards.map(card => ({
      vi: card.dataset.vi || card.querySelector('.example-vi')?.textContent?.trim() || '',
      ru: card.dataset.ru || card.querySelector('.example-ru')?.textContent?.trim() || ''
    }));

    try {
      await plugin.playSequence({ items, loop: _loopMode, viOnly: _viOnlyMode, rate: TTS.getRate(), gapMs: GAP_MS });
    } catch(e) {
      _removeNativeListeners();
      await _startJsSequence(cards);
    }
  }

  async function _startJsSequence(cards) {
    let cycle = 1;
    do {
      if (_viOnlyMode) {
        // В режиме "только вьетнамский" проигрываем только один проход
        await _playCards(cards, 1, cycle);
        if (_stopped) return;
      } else {
        // Обычный режим: два прохода
        await _playCards(cards, 1, cycle);
        if (_stopped) return;
        await _playCards(cards, 2, cycle);
        if (_stopped) return;
      }
      if (_loopMode && !_stopped) {
        cycle += 1;
        await _delay(GAP_MS);
        if (_stopped) return;
      }
    } while (_loopMode && !_stopped);
    stop();
    App.showToast('Авто-плей завершён ✓');
  }

  function _getAllPlayableCards() {
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

      if (_viOnlyMode) {
        // Режим "только вьетнамский": вьетнамская фраза - пауза - повтор вьетнамской фразы - пауза
        await TTS.speakPromise(viText, 'vi', btnVI);
        if (_stopped) return;
        await _delay(GAP_MS);
        if (_stopped) return;
        await TTS.speakPromise(viText, 'vi', btnVI);
        if (_stopped) return;
        await _delay(GAP_MS);
      } else {
        // Обычный режим
        if (pass === 1) {
          await TTS.speakPromise(ruText, 'ru', btnRU);
          if (_stopped) return;
          await _delay(GAP_MS);
          if (_stopped) return;
          await TTS.speakPromise(viText, 'vi', btnVI);
          if (_stopped) return;
          await _delay(GAP_MS);
          if (_stopped) return;
          await TTS.speakPromise(viText, 'vi', btnVI);
          if (_stopped) return;
          await _delay(GAP_MS);
        } else {
          await TTS.speakPromise(viText, 'vi', btnVI);
          if (_stopped) return;
          await _delay(GAP_MS);
        }
      }

      _updateStatus(cards.length, cards.indexOf(card), pass, cycle);
    }
  }

  async function _waitIfPaused() {
    while (_paused && !_stopped) {
      await new Promise(resolve => {
        _resolveWait = resolve;
        setTimeout(resolve, 100);
      });
    }
  }

  function _delay(ms) {
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

  function _updateStatus(total, idx, pass, cycle) {
    const status = document.getElementById('ap-bar-status');
    if (!status) return;
    const cyclePart = (_loopMode && cycle && cycle > 0) ? `🔁 Цикл ${cycle} · ` : '';
    if (_viOnlyMode) {
      status.textContent = `${cyclePart}Фраза ${idx + 1}/${total}`;
    } else {
      status.textContent = `${cyclePart}Проход ${pass}/2 · Фраза ${idx + 1}/${total}`;
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
    _updateViOnlyBtn();
  }

  function _updateViOnlyBtn() {
    const btn = document.getElementById('ap-vionly-btn');
    if (!btn) return;
    btn.textContent = _viOnlyMode && _active ? '🇻🇳 Вьет-плей: ВКЛ' : '🇻🇳 Вьет-плей';
    btn.classList.toggle('active', _viOnlyMode && _active);
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
    try { window.Capacitor?.Plugins?.BackgroundTts?.stopSequence?.(); } catch(e) {}
    _removeNativeListeners();
    TTS.stopAll();
    if (_currentCard) { _currentCard.classList.remove('ap-active'); _currentCard = null; }
    _updateBtn();
    _hideBar();
    _disableBackgroundMode();
  }

  function _removeNativeListeners() {
    try { _nativeProgressListener?.remove?.(); } catch(e) {}
    try { _nativeCompleteListener?.remove?.(); } catch(e) {}
    _nativeProgressListener = null;
    _nativeCompleteListener = null;
  }

  return { setLesson, toggle, togglePause, toggleLoop, toggleViOnly, startViOnly, setLoop, getLoop, setViOnly, getViOnly, stop };
})();
