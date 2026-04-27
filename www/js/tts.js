/* ===== TTS ENGINE ===== */
'use strict';

const TTS = (() => {
  const STORAGE_KEY = 'viet_tts_mode';
  const GT_MAX_CHARS = 180;          // лимит длины фразы для translate_tts
  const GT_END_GUARD_SEC = 0.35;     // если onended раньше duration на эту дельту — игнор
  let _rate = 1.0;
  let _audio = null;
  let _currentBtn = null;
  let _onDoneCallback = null;
  let _mode = 'gtranslate';
  let _modeListeners = [];
  let _token = 0;                    // токен для отмены текущего запуска

  function init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'gtranslate' || saved === 'webspeech') _mode = saved;
    } catch(e) {}

    if (window.speechSynthesis) {
      const load = () => window.speechSynthesis.getVoices();
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  function _isTauri() {
    if (window.__TAURI_INTERNALS__ || window.__TAURI__ || window.isTauri) return true;
    // Fallback по location: на Windows Tauri страница хостится с tauri.localhost,
    // на Linux/macOS — через tauri:// scheme.
    try {
      if (location.hostname && location.hostname.endsWith('tauri.localhost')) return true;
      if (location.protocol === 'tauri:') return true;
    } catch(e) {}
    // Fallback по UA
    if (/\bTauri\//i.test(navigator.userAgent || '')) return true;
    return false;
  }

  function _tauriInvoke(cmd, args) {
    const inv =
      window.__TAURI_INTERNALS__?.invoke ||
      window.__TAURI__?.core?.invoke ||
      window.__TAURI__?.invoke ||
      window.__TAURI_IPC__;
    if (!inv) return Promise.reject(new Error('no invoke (' + Object.keys(window).filter(k=>/tauri/i.test(k)).join(',') + ')'));
    return inv(cmd, args);
  }

  function _gtUrlDirect(text, lang) {
    const tl = lang === 'vi' ? 'vi' : 'ru';
    return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&client=tw-ob&q=${encodeURIComponent(text)}`;
  }

  // В Tauri тащим mp3 через Rust-команду fetch_gtts → base64 → data: URL.
  // На Android/HTML — обычный <audio src=...>.
  function _gtFetchSrc(text, lang) {
    if (_isTauri()) {
      return _tauriInvoke('fetch_gtts', { text, lang })
        .then(b64 => `data:audio/mpeg;base64,${b64}`);
    }
    return Promise.resolve(_gtUrlDirect(text, lang));
  }

  // Бэдж показывается ТОЛЬКО при ошибках Google Translate TTS (fallback в системный).
  function _showErrorBadge(msg) {
    let el = document.getElementById('tts-engine-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tts-engine-badge';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;max-width:90vw;background:rgba(176,0,32,0.92);color:#fff;font-size:12px;line-height:1.35;padding:6px 11px;border-radius:8px;z-index:9999;pointer-events:none;white-space:pre-wrap;font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
      document.body.appendChild(el);
    }
    el.textContent = '⚠️ ' + msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 4000);
    try { console.warn('[TTS]', msg); } catch(e) {}
  }

  // Делим длинный текст на куски ≤ maxLen, стараясь резать по предложениям и словам.
  function _chunkText(text, maxLen) {
    text = (text || '').trim();
    if (!text) return [];
    if (text.length <= maxLen) return [text];

    const result = [];
    const sentences = text.split(/(?<=[.!?…。])\s+/);
    let buf = '';

    const flush = () => { if (buf) { result.push(buf); buf = ''; } };
    const pushPiece = (piece) => {
      if (!piece) return;
      if ((buf + (buf ? ' ' : '') + piece).length <= maxLen) {
        buf = buf ? buf + ' ' + piece : piece;
      } else {
        flush();
        if (piece.length <= maxLen) {
          buf = piece;
        } else {
          // режем по словам
          const words = piece.split(/\s+/);
          let w = '';
          for (const word of words) {
            if ((w + (w ? ' ' : '') + word).length <= maxLen) {
              w = w ? w + ' ' + word : word;
            } else {
              if (w) result.push(w);
              if (word.length > maxLen) {
                // экстремально длинное слово — режем грубо
                for (let i = 0; i < word.length; i += maxLen) {
                  result.push(word.slice(i, i + maxLen));
                }
                w = '';
              } else {
                w = word;
              }
            }
          }
          if (w) buf = w;
        }
      }
    };

    for (const s of sentences) pushPiece(s);
    flush();
    return result;
  }

  function _stop() {
    _token++;                                  // отменяем все запущенные цепочки
    if (_audio) {
      try { _audio.onended = _audio.onerror = null; _audio.pause(); _audio.src = ''; } catch(e) {}
      _audio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (_currentBtn) {
      _currentBtn.classList.remove('speaking');
      _currentBtn = null;
    }
    const cb = _onDoneCallback;
    _onDoneCallback = null;
    if (cb) { try { cb(); } catch(e) {} }     // освобождаем pending speakPromise
  }

  function speak(text, lang, btn, onDone) {
    if (!text || !text.trim()) { if (onDone) onDone(); return; }

    // Тоггл повторного клика по той же кнопке — стоп
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
      if (myToken !== _token) return;          // нас уже отменили / заменили
      if (btn) btn.classList.remove('speaking');
      if (_currentBtn === btn) _currentBtn = null;
      const cb = _onDoneCallback;
      _onDoneCallback = null;
      if (cb) cb();
    };

    if (_mode === 'gtranslate') {
      _speakGT(text, lang, myToken, onEnd);
    } else {
      _speakSystem(text, lang, myToken, onEnd);
    }
  }

  function _speakSystem(text, lang, myToken, onEnd) {
    if (myToken !== _token) return;
    if (window.Capacitor?.isPluginAvailable?.('BackgroundTts')) {
      const plugin = window.Capacitor.Plugins.BackgroundTts;
      const removeListener = plugin.addListener?.('ttsDone', () => {
        removeListener?.remove?.();
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

  function _speakGT(text, lang, myToken, onEnd) {
    const chunks = _chunkText(text, GT_MAX_CHARS);
    if (!chunks.length) { onEnd(); return; }
    let idx = 0;

    const playChunk = () => {
      if (myToken !== _token) return;
      if (idx >= chunks.length) {
        _audio = null;
        onEnd();
        return;
      }
      const piece = chunks[idx++];

      _gtFetchSrc(piece, lang).then(src => {
        if (myToken !== _token) return;
        let audio;
        try {
          audio = new Audio();
          audio.preload = 'auto';
          audio.src = src;
        } catch(e) {
          _showErrorBadge('Google TTS недоступен — играю системным голосом');
          _speakSystem(chunks.slice(idx - 1).join(' '), lang, myToken, onEnd);
          return;
        }
        _audio = audio;

        let done = false;
        const finishOk = () => {
          if (done || myToken !== _token) return;
          const d = audio.duration;
          const t = audio.currentTime;
          if (isFinite(d) && d > 0 && d - t > GT_END_GUARD_SEC) {
            setTimeout(() => {
              if (audio.paused && !done) finishOk();
            }, 300);
            return;
          }
          done = true;
          audio.onended = audio.onerror = audio.onpause = null;
          const gap = idx < chunks.length ? 90 : 0;
          if (gap) setTimeout(playChunk, gap); else playChunk();
        };
        const finishErr = () => {
          if (done || myToken !== _token) return;
          done = true;
          audio.onended = audio.onerror = audio.onpause = null;
          _audio = null;
          _showErrorBadge('Google TTS не воспроизвёлся — играю системным голосом');
          _speakSystem(chunks.slice(idx - 1).join(' '), lang, myToken, onEnd);
        };

        audio.onended = finishOk;
        audio.onerror = finishErr;
        audio.addEventListener('canplay', () => {
          try { audio.playbackRate = _rate; } catch(e) {}
        }, { once: true });

        const pp = audio.play();
        if (pp && typeof pp.catch === 'function') pp.catch(finishErr);
      }).catch(err => {
        if (myToken !== _token) return;
        _showErrorBadge('Google TTS недоступен (' + (err?.message || err) + ') — играю системным голосом');
        _speakSystem(chunks.slice(idx - 1).join(' '), lang, myToken, onEnd);
      });
    };

    playChunk();
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

  function setMode(m) {
    if (m !== 'gtranslate' && m !== 'webspeech') return;
    _stop();
    _mode = m;
    try { localStorage.setItem(STORAGE_KEY, m); } catch(e) {}
    _modeListeners.forEach(fn => { try { fn(m); } catch(e) {} });
  }

  function getMode() { return _mode; }

  function onModeChange(fn) {
    _modeListeners.push(fn);
  }

  function setSpeed(val, btn) {
    _rate = parseFloat(val);
    if (_audio) {
      try { _audio.playbackRate = _rate; } catch(e) {}
    }
    if (btn) {
      btn.closest('.ap-controls')?.querySelectorAll('.ap-speed-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
    }
  }

  function stopAll() { _stop(); }
  function getRate() { return _rate; }

  function speakPromise(text, lang, btn) {
    return new Promise(resolve => speak(text, lang, btn, resolve));
  }

  function delayPromise(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { init, speak, speakPromise, delayPromise, stopAll, setSpeed, getRate, setMode, getMode, onModeChange };
})();
