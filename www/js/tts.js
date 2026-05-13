/* ===== TTS ENGINE ===== */
'use strict';

const TTS = (() => {
  let _rate = 1.0;
  let _mode = 'google';
  let _currentBtn = null;
  let _onDoneCallback = null;
  let _token = 0;
  let _currentAudio = null;
  let _googleAudio = null;
  let _googleAudioUnlocked = false;

  function _ensureGoogleAudio() {
    if (!_googleAudio) {
      _googleAudio = new Audio();
      _googleAudio.preload = 'auto';
    }
    return _googleAudio;
  }

  function _releaseAudioSrc(audio) {
    if (!audio) return;
    const src = audio.src || '';
    try {
      audio.removeAttribute('src');
      audio.load();
    } catch(e) {}
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }

  function unlockAudio() {
    if (_mode !== 'google' || _isAndroidTtsAvailable() || _googleAudioUnlocked) return;
    try {
      const audio = _ensureGoogleAudio();
      audio.muted = true;
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';
      const played = audio.play();
      if (played && typeof played.then === 'function') {
        played.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          _releaseAudioSrc(audio);
          _googleAudioUnlocked = true;
        }).catch(() => {
          audio.muted = false;
        });
      } else {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        _releaseAudioSrc(audio);
        _googleAudioUnlocked = true;
      }
    } catch(e) {}
  }

  function init() {
    try {
      const saved = localStorage.getItem('viet_tts_mode');
      _mode = saved === 'system' ? 'system' : 'google';
    } catch(e) {}
    if (window.speechSynthesis) {
      const load = () => window.speechSynthesis.getVoices();
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
    _refreshModeButtons();
  }

  function _stop() {
    _token++;
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      try { window.Capacitor.Plugins.BackgroundTts.stop(); } catch(e) {}
    }
    if (_currentAudio) {
      try {
        _currentAudio.pause();
        _releaseAudioSrc(_currentAudio);
      } catch(e) {}
      _currentAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (_currentBtn) {
      _currentBtn.classList.remove('speaking');
      _currentBtn = null;
    }
    const cb = _onDoneCallback;
    _onDoneCallback = null;
    if (cb) { try { cb(); } catch(e) {} }
  }

  function speak(text, lang, btn, onDone) {
    if (!text || !text.trim()) { if (onDone) onDone(); return; }

    if (_currentBtn === btn && btn) {
      _stop();
      return;
    }
    _stop();

    if (btn) {
      btn.classList.add('speaking');
      _currentBtn = btn;
    }
    _onDoneCallback = onDone;
    const myToken = ++_token;

    const onEnd = () => {
      if (myToken !== _token) return;
      if (btn) btn.classList.remove('speaking');
      if (_currentBtn === btn) _currentBtn = null;
      const cb = _onDoneCallback;
      _onDoneCallback = null;
      if (cb) cb();
    };

    if (_mode === 'system' || _isAndroidTtsAvailable()) {
      _speakSystem(text, lang, myToken, onEnd);
      return;
    }
    _speakGoogle(text, lang, myToken, onEnd);
  }

  async function _speakGoogle(text, lang, myToken, onEnd) {
    if (myToken !== _token) return;
    if (_isAndroidTtsAvailable()) return;
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    let src = '';
    let audio = null;
    try {
      const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
      if (invoke) {
        const b64 = await invoke('fetch_gtts', { text, lang });
        if (myToken !== _token) return;
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        src = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      } else if (location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
        const url = new URL('/__gtts', location.origin);
        url.searchParams.set('lang', lang);
        url.searchParams.set('q', text);
        src = url.toString();
      }

      if (!src) {
        _speakSystem(text, lang, myToken, onEnd);
        return;
      }

      audio = _ensureGoogleAudio();
      try {
        audio.pause();
        _releaseAudioSrc(audio);
      } catch(e) {}
      _currentAudio = audio;
      audio.muted = false;
      audio.src = src;
      audio.playbackRate = _rate;
      audio.onended = () => {
        if (_currentAudio === audio) _currentAudio = null;
        _releaseAudioSrc(audio);
        if (myToken === _token) onEnd();
      };
      audio.onerror = () => {
        if (_currentAudio === audio) _currentAudio = null;
        _releaseAudioSrc(audio);
        if (myToken === _token) onEnd();
      };
      await audio.play();
    } catch(e) {
      if (_currentAudio === audio) _currentAudio = null;
      try { audio?.pause(); } catch(err) {}
      _releaseAudioSrc(audio);
      if (myToken === _token) onEnd();
    }
  }

  function _speakSystem(text, lang, myToken, onEnd) {
    if (myToken !== _token) return;
    if (_currentAudio) {
      try {
        _currentAudio.pause();
        _releaseAudioSrc(_currentAudio);
      } catch(e) {}
      _currentAudio = null;
    }
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      const plugin = window.Capacitor.Plugins.BackgroundTts;
      let removeDone = null;
      let removeErr = null;
      removeDone = plugin.addListener?.('ttsDone', () => {
        removeDone?.remove?.();
        removeErr?.remove?.();
        if (myToken === _token) onEnd();
      });
      removeErr = plugin.addListener?.('ttsError', () => {
        removeDone?.remove?.();
        removeErr?.remove?.();
        if (myToken === _token) onEnd();
      });
      plugin.speak({ text, lang, rate: _rate }).catch(() => _speakWS(text, lang, myToken, onEnd));
      return;
    }
    if (window.Capacitor?.isPluginAvailable?.('TextToSpeech')) {
      const bcp = lang === 'vi' ? 'vi-VN' : 'ru-RU';
      window.Capacitor.Plugins.TextToSpeech.speak({
        text, lang: bcp, rate: _rate, pitch: 1.0, volume: 1.0, category: 'ambient'
      }).then(() => { if (myToken === _token) onEnd(); })
        .catch(() => _speakWS(text, lang, myToken, onEnd));
      return;
    }
    _speakWS(text, lang, myToken, onEnd);
  }

  function _speakWS(text, lang, myToken, onEnd) {
    if (myToken !== _token) return;
    const synth = window.speechSynthesis;
    if (!synth) { onEnd(); return; }
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    const bcp = lang === 'vi' ? 'vi-VN' : 'ru-RU';
    utt.lang = bcp;
    utt.rate = _rate;
    const voices = synth.getVoices();
    const googleVoice = voices.find(v => v.lang.startsWith(lang === 'vi' ? 'vi' : 'ru') && v.name.toLowerCase().includes('google'));
    const anyVoice = voices.find(v => v.lang.startsWith(lang === 'vi' ? 'vi' : 'ru'));
    if (googleVoice) utt.voice = googleVoice;
    else if (anyVoice) utt.voice = anyVoice;
    utt.onend = () => { if (myToken === _token) onEnd(); };
    utt.onerror = () => { if (myToken === _token) onEnd(); };
    synth.speak(utt);
  }

  function setSpeed(val, btn) {
    _rate = parseFloat(val);
    if (btn) {
      btn.closest('.ap-controls')?.querySelectorAll('.ap-speed-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
    }
  }

  function _isAndroidTtsAvailable() {
    return !!(
      window.Capacitor?.isPluginAvailable?.('BackgroundTts') ||
      window.Capacitor?.isPluginAvailable?.('TextToSpeech')
    );
  }

  function _modeLabel() {
    return _mode === 'system' ? 'Системный' : 'Google Translator';
  }

  function _refreshModeButtons() {
    document.querySelectorAll('.tts-mode-btn').forEach(btn => {
      btn.textContent = `🔊 ${_modeLabel()}`;
      btn.classList.toggle('active', _mode === 'google');
      btn.title = _mode === 'google'
        ? 'Озвучка через Google Translator. Нажмите для системного TTS'
        : 'Системная озвучка Ubuntu. Нажмите для Google Translator';
    });
  }

  function renderModeButton() {
    if (_isAndroidTtsAvailable()) return '';
    return `<button class="btn-ap tts-mode-btn ${_mode === 'google' ? 'active' : ''}" onclick="TTS.toggleMode()" title="${_mode === 'google' ? 'Озвучка через Google Translator. Нажмите для системного TTS' : 'Системная озвучка Ubuntu. Нажмите для Google Translator'}">🔊 ${_modeLabel()}</button>`;
  }

  function setMode(mode) {
    _mode = mode === 'system' ? 'system' : 'google';
    try { localStorage.setItem('viet_tts_mode', _mode); } catch(e) {}
    _refreshModeButtons();
  }

  function toggleMode() {
    setMode(_mode === 'google' ? 'system' : 'google');
    stopAll();
  }

  function stopAll() { _stop(); }
  function getRate() { return _rate; }
  function getMode() { return _mode; }
  function onModeChange() { _refreshModeButtons(); }

  function speakPromise(text, lang, btn) {
    return new Promise(resolve => speak(text, lang, btn, resolve));
  }

  function delayPromise(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { init, speak, speakPromise, delayPromise, stopAll, setSpeed, getRate, setMode, getMode, toggleMode, renderModeButton, onModeChange, unlockAudio };
})();
