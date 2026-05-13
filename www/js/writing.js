/* ===== WRITING PRACTICE ===== */
'use strict';

const Writing = (() => {
  let _data = null;
  let _pool = [];
  let _idx = 0;
  let _session = [];
  let _results = { correct: 0, close: 0, wrong: 0 };
  let _mistakes = { close: [], wrong: [] };
  let _mode = 'session'; // 'session' | 'retry'
  // Retry state
  let _retryItems = []; // [{...item, remaining, origRemaining, source: 'close'|'wrong'}]
  let _retryCurrent = null;
  let _retryStats = { correct: 0, close: 0, wrong: 0 };
  const SESSION_SIZE = 20;

  function init(appData) {
    _data = appData;
  }

  function refreshSources() {
    const select = document.getElementById('writing-source-select');
    if (!select) return;
    const prev = select.value;
    const folders = (typeof Cards !== 'undefined' && Cards.getFolders) ? Cards.getFolders() : [];
    const nonEmpty = folders.filter(f => Cards.getCardsInFolder(f.id).length > 0);
    const totalSaved = nonEmpty.reduce((n, f) => n + Cards.getCardsInFolder(f.id).length, 0);
    if (!totalSaved) {
      select.innerHTML = '<option value="">Нет сохранённых карточек — сохраните фразы в разделе «Карточки»</option>';
      return;
    }
    const allOpt = `<option value="all-saved">⭐ Все сохранённые (${totalSaved})</option>`;
    const folderOpts = nonEmpty.map(f => {
      const count = Cards.getCardsInFolder(f.id).length;
      return `<option value="folder:${f.id}">${f.icon} ${escHtml(f.name)} (${count})</option>`;
    }).join('');
    select.innerHTML = allOpt + folderOpts;
    if (prev && Array.from(select.options).some(o => o.value === prev)) {
      select.value = prev;
    }
  }

  function start() {
    const source = document.getElementById('writing-source-select').value;

    _pool = [];
    const haveCards = typeof Cards !== 'undefined';
    if (source === 'all-saved' && haveCards) {
      const folders = Cards.getFolders ? Cards.getFolders() : [];
      folders.forEach(f => {
        Cards.getCardsInFolder(f.id).forEach(c => {
          _pool.push({ vi: c.vi, ru: c.ru, note: c.note || '', lessonId: c.lessonId });
        });
      });
    } else if (source && source.startsWith('folder:') && haveCards) {
      const folderId = source.slice('folder:'.length);
      Cards.getCardsInFolder(folderId).forEach(c => {
        _pool.push({ vi: c.vi, ru: c.ru, note: c.note || '', lessonId: c.lessonId });
      });
    }

    if (!_pool.length) {
      App.showToast('Нет фраз для практики');
      return;
    }

    // Shuffle and pick session
    _pool = _pool.sort(() => Math.random() - 0.5);
    _session = _pool.slice(0, Math.min(SESSION_SIZE, _pool.length));
    _idx = 0;
    _results = { correct: 0, close: 0, wrong: 0 };
    _mistakes = { close: [], wrong: [] };
    _mode = 'session';

    document.getElementById('writing-setup').style.display = 'none';
    document.getElementById('writing-session').style.display = 'block';
    _renderSessionUI();
    _showItem();
  }

  function _renderSessionUI() {
    const container = document.getElementById('writing-session');
    container.innerHTML = `
    <div class="writing-progress">
      <span id="writing-progress-text">1 / ${_session.length}</span>
      <div class="progress-bar"><div class="progress-fill" id="writing-progress-bar"></div></div>
    </div>
    <div class="writing-card">
      <div class="wcard-lesson" id="wcard-lesson"></div>
      <div class="wcard-ru" id="wcard-ru"></div>
      <button class="btn-tts-inline" onclick="Writing.speakRu()">🔊 Послушать</button>
      <div class="wcard-input-row">
        <textarea id="wcard-input" class="wcard-textarea" placeholder="Введите вьетнамскую фразу..." rows="2" lang="vi" inputmode="text" autocapitalize="none" oninput="Writing.onInput(this)"></textarea>
        <button class="btn-primary" id="wcard-submit" onclick="Writing.check()">Проверить</button>
      </div>
      <div class="wcard-hint" id="wcard-hint" style="display:none">
        <button class="btn-text" id="wcard-hint-btn" onclick="Writing.toggleHint()">💡 Подсказка</button>
        <div id="wcard-hint-text" style="display:none;color:var(--accent);font-size:13px;font-family:monospace;margin-top:6px"></div>
      </div>
      <div class="wcard-result" id="wcard-result" style="display:none"></div>
      <div class="wcard-actions" id="wcard-actions" style="display:none">
        <button class="btn-secondary" onclick="Writing.next()">Следующая →</button>
      </div>
    </div>
    <button class="btn-text-danger" onclick="Writing.stop()">Завершить сессию</button>`;
  }

  function _showItem() {
    if (_idx >= _session.length) { _showSummary(); return; }
    const item = _session[_idx];
    const isCustom = item.lessonId === 'custom';
    const lesson = isCustom ? null : _data.lessons.find(l => l.id === item.lessonId);
    const lessonLabel = isCustom ? '✏️ Своя карточка' : (lesson ? `Урок ${lesson.level}-${lesson.num}` : item.lessonId);

    const pct = Math.round((_idx / _session.length) * 100);
    document.getElementById('writing-progress-text').textContent = `${_idx + 1} / ${_session.length}`;
    document.getElementById('writing-progress-bar').style.width = pct + '%';
    document.getElementById('wcard-lesson').textContent = lessonLabel;
    document.getElementById('wcard-ru').textContent = item.ru;

    _resetCardUI();
  }

  function _resetCardUI() {
    const input = document.getElementById('wcard-input');
    if (input) {
      input.value = '';
      input.style.borderColor = '';
      input.focus();
    }
    document.getElementById('wcard-result').style.display = 'none';
    document.getElementById('wcard-actions').style.display = 'none';
    document.getElementById('wcard-hint').style.display = 'block';
    const hintText = document.getElementById('wcard-hint-text');
    if (hintText) { hintText.textContent = ''; hintText.style.display = 'none'; }
    const hintBtn = document.getElementById('wcard-hint-btn');
    if (hintBtn) hintBtn.textContent = '💡 Подсказка';
    const submit = document.getElementById('wcard-submit');
    if (submit) { submit.disabled = false; submit.textContent = 'Проверить'; }
  }

  function onInput(el) {
    // Allow checking on Enter
    if (el.value.includes('\n')) {
      el.value = el.value.replace('\n', '');
      check();
    }
  }

  function speakRu() {
    const text = document.getElementById('wcard-ru').textContent;
    TTS.speak(text, 'ru', null);
  }

  function toggleHint() {
    const item = _mode === 'retry' ? _retryCurrent : _session[_idx];
    if (!item) return;
    const hintText = document.getElementById('wcard-hint-text');
    const hintBtn = document.getElementById('wcard-hint-btn');
    if (!hintText || !hintBtn) return;
    if (hintText.style.display === 'none') {
      const hint = item.vi.split(' ').map(w => w[0] + '_'.repeat(Math.max(0, w.length - 1))).join(' ');
      hintText.textContent = hint;
      hintText.style.display = 'block';
      hintBtn.textContent = '🙈 Скрыть подсказку';
    } else {
      hintText.style.display = 'none';
      hintText.textContent = '';
      hintBtn.textContent = '💡 Подсказка';
    }
  }

  function check() {
    if (_mode === 'retry') return _checkRetry();

    const item = _session[_idx];
    if (!item) return;

    const input = document.getElementById('wcard-input').value.trim();
    if (!input) { App.showToast('Введите ответ'); return; }

    const correct = item.vi.trim();
    const result = document.getElementById('wcard-result');
    const actions = document.getElementById('wcard-actions');

    document.getElementById('wcard-submit').disabled = true;
    result.style.display = 'block';
    actions.style.display = 'block';
    document.getElementById('wcard-hint').style.display = 'none';

    if (_normalize(input) === _normalize(correct)) {
      result.className = 'wcard-result correct';
      result.innerHTML = '✓ Правильно! <div class="wcard-correct-vi">' + escHtml(correct) + '</div>';
      _results.correct++;
      TTS.speak(correct, 'vi', null);
    } else if (_isSimilar(_normalize(input), _normalize(correct))) {
      result.className = 'wcard-result close';
      result.innerHTML = `⚠️ Почти верно!<br>Ваш ответ: <em>${escHtml(input)}</em><div class="wcard-correct-vi">Правильно: ${escHtml(correct)}</div>`;
      _results.close++;
      _mistakes.close.push(item);
      TTS.speak(correct, 'vi', null);
    } else {
      result.className = 'wcard-result wrong';
      result.innerHTML = `✗ Неверно<br>Ваш ответ: <em>${escHtml(input)}</em><div class="wcard-correct-vi">Правильно: ${escHtml(correct)}</div>`;
      _results.wrong++;
      _mistakes.wrong.push(item);
      TTS.speak(correct, 'vi', null);
    }
  }

  function next() {
    if (_mode === 'retry') return _nextRetry();
    TTS.stopAll();
    _idx++;
    _showItem();
  }

  function stop() {
    TTS.stopAll();
    _mode = 'session';
    _retryItems = [];
    _retryCurrent = null;
    _renderSessionUI();
    document.getElementById('writing-setup').style.display = 'block';
    document.getElementById('writing-session').style.display = 'none';
    refreshSources();
  }

  function _showSummary() {
    const total = _session.length;
    const pct = Math.round((_results.correct / total) * 100);
    const container = document.getElementById('writing-session');
    const yellowCount = _mistakes.close.length;
    const redCount = _mistakes.wrong.length;
    const hasErrors = yellowCount > 0 || redCount > 0;
    const retryTotal = yellowCount * 1 + redCount * 3;

    const retryDescription = hasErrors
      ? `<p style="font-size:15px;color:var(--text-muted);margin-top:4px">Повторение: жёлтые ×1, красные ×3 — всего ${retryTotal} попыт${_pluralAttempts(retryTotal)}</p>`
      : '';

    container.innerHTML = `
    <div class="study-complete">
      <div class="study-complete-icon">${pct >= 80 ? '🎉' : pct >= 50 ? '📚' : '💪'}</div>
      <h2>Сессия завершена!</h2>
      <p>
        ✓ Правильно: ${_results.correct}<br>
        ⚠️ Почти верно: ${_results.close}<br>
        ✗ Неверно: ${_results.wrong}<br>
        <strong>Точность: ${pct}%</strong>
      </p>
      ${retryDescription}
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:8px">
        ${hasErrors ? `<button class="btn-primary btn-lg" onclick="Writing._startRetry()">🔁 Повторить ошибки</button>` : ''}
        <button class="btn-secondary" onclick="Writing._restart()">Ещё раз</button>
        <button class="btn-text" onclick="Writing.stop()">Выбрать другие параметры</button>
      </div>
    </div>`;

    Writing._restart = function() {
      _pool = _pool.sort(() => Math.random() - 0.5);
      _session = _pool.slice(0, Math.min(SESSION_SIZE, _pool.length));
      _idx = 0;
      _results = { correct: 0, close: 0, wrong: 0 };
      _mistakes = { close: [], wrong: [] };
      _mode = 'session';
      _renderSessionUI();
      _showItem();
    };

    Writing._startRetry = function() {
      _mode = 'retry';
      _retryItems = [];
      _mistakes.close.forEach(item => _retryItems.push({ ...item, remaining: 1, origRemaining: 1, source: 'close' }));
      _mistakes.wrong.forEach(item => _retryItems.push({ ...item, remaining: 3, origRemaining: 3, source: 'wrong' }));
      _retryItems.sort(() => Math.random() - 0.5);
      _retryCurrent = null;
      _retryStats = { correct: 0, close: 0, wrong: 0 };
      _renderSessionUI();
      _showRetryItem();
    };
  }

  function _pluralAttempts(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'ка';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'ки';
    return 'ок';
  }

  function _showRetryItem() {
    const eligible = _retryItems.filter(it => it.remaining > 0);
    if (!eligible.length) { _showRetrySummary(); return; }

    // Avoid showing the same card twice in a row when possible
    let pool = eligible;
    if (eligible.length > 1 && _retryCurrent && eligible.includes(_retryCurrent)) {
      const others = eligible.filter(it => it !== _retryCurrent);
      if (others.length) pool = others;
    }
    _retryCurrent = pool[Math.floor(Math.random() * pool.length)];

    const item = _retryCurrent;
    const isCustom = item.lessonId === 'custom';
    const lesson = isCustom ? null : _data.lessons.find(l => l.id === item.lessonId);
    const lessonLabel = isCustom ? '✏️ Своя карточка' : (lesson ? `Урок ${lesson.level}-${lesson.num}` : item.lessonId);

    const totalOriginal = _retryItems.reduce((s, it) => s + it.origRemaining, 0);
    const totalRemaining = _retryItems.reduce((s, it) => s + it.remaining, 0);
    const completed = totalOriginal - totalRemaining;
    const pct = totalOriginal ? Math.round((completed / totalOriginal) * 100) : 0;

    const sourceTag = item.source === 'wrong' ? '🟥 Неверно' : '🟨 Почти';
    const repTag = `· повтор ${item.origRemaining - item.remaining + 1}/${item.origRemaining}`;

    document.getElementById('writing-progress-text').textContent = `🔁 ${completed} / ${totalOriginal}`;
    document.getElementById('writing-progress-bar').style.width = pct + '%';
    document.getElementById('wcard-lesson').textContent = `${lessonLabel} · ${sourceTag} ${repTag}`;
    document.getElementById('wcard-ru').textContent = item.ru;

    _resetCardUI();
  }

  function _checkRetry() {
    const item = _retryCurrent;
    if (!item) return;

    const input = document.getElementById('wcard-input').value.trim();
    if (!input) { App.showToast('Введите ответ'); return; }

    const correct = item.vi.trim();
    const result = document.getElementById('wcard-result');
    const actions = document.getElementById('wcard-actions');

    document.getElementById('wcard-submit').disabled = true;
    result.style.display = 'block';
    actions.style.display = 'block';
    document.getElementById('wcard-hint').style.display = 'none';

    if (_normalize(input) === _normalize(correct)) {
      result.className = 'wcard-result correct';
      const left = item.remaining - 1;
      const tail = left > 0 ? `<div style="font-size:13px;margin-top:6px;color:var(--text-muted)">Осталось повторить эту фразу: ${left}</div>` : '';
      result.innerHTML = `✓ Правильно! <div class="wcard-correct-vi">${escHtml(correct)}</div>${tail}`;
      item.remaining -= 1;
      _retryStats.correct++;
      TTS.speak(correct, 'vi', null);
    } else if (_isSimilar(_normalize(input), _normalize(correct))) {
      result.className = 'wcard-result close';
      result.innerHTML = `⚠️ Почти верно — попробуйте ещё раз<br>Ваш ответ: <em>${escHtml(input)}</em><div class="wcard-correct-vi">Правильно: ${escHtml(correct)}</div>`;
      _retryStats.close++;
      TTS.speak(correct, 'vi', null);
    } else {
      result.className = 'wcard-result wrong';
      result.innerHTML = `✗ Неверно — фраза вернётся ещё раз<br>Ваш ответ: <em>${escHtml(input)}</em><div class="wcard-correct-vi">Правильно: ${escHtml(correct)}</div>`;
      _retryStats.wrong++;
      TTS.speak(correct, 'vi', null);
    }
  }

  function _nextRetry() {
    TTS.stopAll();
    _showRetryItem();
  }

  function _showRetrySummary() {
    const container = document.getElementById('writing-session');
    const total = _retryStats.correct + _retryStats.close + _retryStats.wrong;
    container.innerHTML = `
    <div class="study-complete">
      <div class="study-complete-icon">🎉</div>
      <h2>Все ошибки исправлены!</h2>
      <p>
        Всего попыток: ${total}<br>
        ✓ Верно: ${_retryStats.correct}<br>
        ⚠️ Почти: ${_retryStats.close}<br>
        ✗ Неверно: ${_retryStats.wrong}
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:8px">
        <button class="btn-primary btn-lg" onclick="Writing._restart()">Ещё раз с начала</button>
        <button class="btn-text" onclick="Writing.stop()">Выбрать другие параметры</button>
      </div>
    </div>`;
    _mode = 'session';
    _retryCurrent = null;
  }

  function _normalize(s) {
    return s.toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _isSimilar(a, b) {
    // Levenshtein distance < 20% of length
    if (a === b) return true;
    const maxDist = Math.ceil(b.length * 0.2);
    return _levenshtein(a, b) <= maxDist;
  }

  function _levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m + 1}, (_, i) => Array.from({length: n + 1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
        else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, start, onInput, speakRu, toggleHint, check, next, stop, refreshSources };
})();
