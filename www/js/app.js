/* ===== MAIN APP CONTROLLER ===== */
'use strict';

const App = (() => {
  let _data = null;
  let _currentLevel = null;
  let _currentLesson = null;
  let _screenStack = ['home'];

  const LEVEL_NAMES = {
    A0: 'Начальный', A1: 'Элементарный',
    A2: 'Базовый', B1: 'Средний',
    B2: 'Выше среднего', C1: 'Продвинутый'
  };

  function init() {
    // Data is loaded via lessons_data.js which sets window.LESSONS_DATA
    if (!window.LESSONS_DATA) {
      document.querySelector('.loading-text').textContent = 'Ошибка загрузки данных!';
      return;
    }
    _data = window.LESSONS_DATA;

    // Sync the header toggle icon with the theme already applied in <head>
    _updateThemeButton();

    // Init subsystems
    TTS.init();
    Cards.init(_data);
    Search.init(_data);
    Writing.init(_data);

    // Render home
    _renderLevels();
    _updateHomeStats();

    // Show app
    setTimeout(() => {
      document.getElementById('loading-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      document.getElementById('bottom-nav').style.display = 'flex';
    }, 1200);
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('viet_theme', next); } catch(e) {}
    _updateThemeButton();
    showToast(next === 'dark' ? '🌙 Тёмная тема' : '☀️ Светлая тема');
  }

  function _updateThemeButton() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Светлая тема' : 'Тёмная тема';
  }

  function _renderLevels() {
    const grid = document.getElementById('levels-grid');
    const levels = ['A0','A1','A2','B1','B2','C1'];
    const progress = Cards.getLevelProgress();

    grid.innerHTML = levels.map(lvl => {
      const lessons = _data.lessons.filter(l => l.level === lvl);
      const done = progress[lvl] || 0;
      const pct = Math.round((done / 50) * 100);
      const color = _data.level_colors[lvl];
      return `
      <div class="level-card" onclick="App.showLevel('${lvl}')" style="border-top: 3px solid ${color.primary}">
        <div class="level-card-badge" style="background:${color.primary}">${lvl}</div>
        <div class="level-card-title">${LEVEL_NAMES[lvl]}</div>
        <div class="level-card-meta">${lessons.length} уроков · ${pct}% изучено</div>
        <div class="level-card-progress">
          <div class="level-card-progress-fill" style="width:${pct}%;background:${color.primary}"></div>
        </div>
      </div>`;
    }).join('');
  }

  function _updateHomeStats() {
    const total = _data.stats.total;
    const totalEx = _data.stats.examples;
    document.getElementById('home-stats').textContent =
      `${total} уроков · ${totalEx.toLocaleString()} фраз`;
  }

  function showLevel(level) {
    _currentLevel = level;
    const color = _data.level_colors[level];
    const lessons = _data.lessons.filter(l => l.level === level);

    document.getElementById('level-hero').innerHTML = `
      <div class="level-hero-badge">🇻🇳 Уровень ${level}</div>
      <div class="level-hero-title">${LEVEL_NAMES[level]}</div>
      <div class="level-hero-sub">${lessons.length} уроков · ${level} по CEFR</div>
    `;
    document.getElementById('level-hero').style.background = color.header;

    const grid = document.getElementById('lessons-grid');
    const progress = Cards.getLevelProgress();
    grid.innerHTML = lessons.map(l => {
      const done = (progress[`${level}_${l.num}`]) ? true : false;
      return `
      <div class="lesson-item" onclick="App.showLesson('${l.id}')">
        <div class="lesson-num ${done ? 'done' : ''}">${l.num}</div>
        <div class="lesson-info">
          <div class="lesson-item-title">${l.title}</div>
          <div class="lesson-item-meta">${l.all_examples.length} фраз${l.vocab.length ? ` · ${l.vocab.length} слов` : ''}</div>
        </div>
        <div class="lesson-item-arrow">›</div>
      </div>`;
    }).join('');

    _pushScreen('lessons', `Уровень ${level}`);
  }

  function showLesson(lessonId) {
    const lesson = _data.lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    _currentLesson = lesson;
    AutoPlay.stop();
    _renderLesson(lesson);
    _pushScreen('lesson', lesson.title);
  }

  function showLessonAt(lessonId, viText) {
    const lesson = _data.lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    _currentLesson = lesson;
    AutoPlay.stop();
    _renderLesson(lesson);
    _pushScreen('lesson', lesson.title);
    if (!viText) return;
    // Defer scroll until layout is ready
    setTimeout(() => {
      const cards = document.querySelectorAll('#lesson-content .example-card');
      const target = Array.from(cards).find(c => c.dataset.vi === viText);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('search-highlight');
        setTimeout(() => target.classList.remove('search-highlight'), 3500);
      }
    }, 120);
  }

  function _renderLesson(lesson) {
    const color = _data.level_colors[lesson.level];
    const container = document.getElementById('lesson-content');

    let sectionsHtml = '';
    const secExamples = lesson.section_examples || {};
    const hasSecExamples = Object.values(secExamples).some(v => v && v.length > 0);

    if (hasSecExamples) {
      // Render using section_examples keys mapped to sections
      // First build a title lookup from sections metadata
      const sectionTitles = {};
      for (const sec of (lesson.sections || [])) {
        sectionTitles[sec.id] = sec.title;
        // Also map ex-rule1 → rule1 title
        const normalized = sec.id.replace(/^ex-/, '');
        sectionTitles['ex-' + normalized] = sec.title;
      }

      // Group sub-sections under parent sections
      const parentSections = lesson.sections.filter(s => s.type !== 'vocab' && s.type !== 'summary');
      let usedKeys = new Set();

      sectionsHtml = parentSections.map(sec => {
        // Collect all sub-keys that belong to this section
        const secKeyBase = sec.id.replace(/^ex-/, '');
        const subKeys = Object.keys(secExamples).filter(k => {
          const kBase = k.replace(/^ex-/, '');
          return kBase === secKeyBase || kBase.startsWith(secKeyBase) || k === sec.id || k.startsWith('ex-' + secKeyBase);
        });

        let allExamples = [];
        for (const k of subKeys) {
          if (secExamples[k]) { allExamples = allExamples.concat(secExamples[k]); usedKeys.add(k); }
        }
        // Also try direct section ID
        if (!allExamples.length && secExamples[sec.id]) {
          allExamples = secExamples[sec.id];
          usedKeys.add(sec.id);
        }

        // Skip sections without any example cards — those render as visually empty rule blocks
        if (!allExamples.length) return '';
        const exHtml = allExamples.map(e => _renderExampleCard(e, lesson, color)).join('');
        return `<div class="lesson-section" id="ls-${sec.id}">\n<div class="lesson-section-title">${sec.title || sec.id}</div>\n${exHtml}\n</div>`;
      }).filter(Boolean).join('');

      // Add any remaining section_examples not covered above
      const remaining = Object.keys(secExamples).filter(k => !usedKeys.has(k));
      for (const k of remaining) {
        const examples = secExamples[k];
        if (!examples || !examples.length) continue;
        const title = sectionTitles[k] || k;
        const exHtml = examples.map(e => _renderExampleCard(e, lesson, color)).join('');
        sectionsHtml += `<div class="lesson-section" id="ls-${k}">\n<div class="lesson-section-title">${title}</div>\n${exHtml}\n</div>`;
      }
    } else {
      // Flat list grouped by sections or chunks
      const allEx = lesson.all_examples;
      const parentSections = lesson.sections.filter(s => s.type !== 'vocab' && s.type !== 'summary');

      if (parentSections.length > 0 && allEx.length > 0) {
        // Distribute examples evenly across sections
        const chunkSize = Math.ceil(allEx.length / Math.max(1, parentSections.length));
        sectionsHtml = parentSections.map((sec, idx) => {
          const chunk = allEx.slice(idx * chunkSize, (idx + 1) * chunkSize);
          const exHtml = chunk.map(e => _renderExampleCard(e, lesson, color)).join('');
          return `<div class="lesson-section" id="ls-${sec.id}">\n<div class="lesson-section-title">${sec.title || sec.id}</div>\n${exHtml}\n</div>`;
        }).join('');
      } else {
        // Simple chunks
        const chunkSize = 6;
        for (let i = 0; i < allEx.length; i += chunkSize) {
          const chunk = allEx.slice(i, i + chunkSize);
          const exHtml = chunk.map(e => _renderExampleCard(e, lesson, color)).join('');
          sectionsHtml += `<div class="lesson-section" id="ls-sec-${i/chunkSize|0}">\n<div class="lesson-section-title">Раздел ${(i/chunkSize|0)+1}</div>\n${exHtml}\n</div>`;
        }
      }
    }


    // Find next/prev
    const allLessons = _data.lessons.filter(l => l.level === lesson.level);
    const idx = allLessons.findIndex(l => l.id === lesson.id);
    const prev = idx > 0 ? allLessons[idx - 1] : null;
    const next = idx < allLessons.length - 1 ? allLessons[idx + 1] : null;

    const viColor = lesson.level === 'A0' ? 'style="background:linear-gradient(135deg,#b71c1c,#7f0000)"' : `style="background:${color.header}"`;
    const btnViClass = lesson.level === 'A0' ? '' : 'a1up';

    container.innerHTML = `
    <div class="lesson-header" ${viColor}>
      <div class="lesson-badge">🇻🇳 Уровень ${lesson.level} · Урок ${lesson.num}</div>
      <div class="lesson-h-title">${lesson.title}</div>
      ${lesson.subtitle ? `<div class="lesson-h-sub">${lesson.subtitle}</div>` : ''}
      <div class="lesson-h-meta">
        <span>📚 ${lesson.level}</span>
        <span>🎯 ${lesson.all_examples.length} фраз</span>
        ${lesson.vocab.length ? `<span>📖 ${lesson.vocab.length} слов</span>` : ''}
      </div>
      <div class="ap-controls">
        <button class="btn-ap" id="ap-toggle-btn" onclick="AutoPlay.toggle()">▶ Авто-плей</button>
        <button class="ap-speed-btn" data-speed="0.5" onclick="TTS.setSpeed(0.5, this)">🐢</button>
        <button class="ap-speed-btn active" data-speed="1.0" onclick="TTS.setSpeed(1.0, this)">🚶</button>
        <button class="ap-speed-btn" data-speed="1.6" onclick="TTS.setSpeed(1.6, this)">🏃</button>
        ${TTS.renderModeButton()}
        <button class="btn-ap" id="ap-vionly-btn" onclick="AutoPlay.startViOnly()">🇻🇳 Вьет-плей</button>
        <button class="btn-ap" id="ap-loop-btn" onclick="AutoPlay.toggleLoop()">🔁 Повтор</button>
      </div>
    </div>

    ${sectionsHtml}

    <div class="lesson-nav-bar">
      ${prev ? `<button class="btn-outline" onclick="App.showLesson('${prev.id}')">← Урок ${prev.num}</button>` : '<span></span>'}
      ${next ? `<button class="btn-outline" onclick="App.showLesson('${next.id}')">Урок ${next.num} →</button>` : '<span></span>'}
    </div>
    `;

    // Scroll to top
    document.getElementById('screen-lesson').scrollTop = 0;

    // Update AutoPlay context
    AutoPlay.setLesson(lesson, btnViClass);
  }

  function _renderExampleCard(item, lesson, color) {
    const viColor = lesson.level === 'A0' ? 'style="color:#b71c1c"' : '';
    const btnViClass = lesson.level === 'A0' ? '' : 'a1up';
    const savedKey = `${lesson.id}::${item.vi}`;
    const isSaved = Cards.isSaved(savedKey);

    return `
    <div class="example-card" data-vi="${escHtml(item.vi)}" data-ru="${escHtml(item.ru)}">
      <div class="example-texts">
        <div class="example-vi" ${viColor}>${escHtml(item.vi)}</div>
        <div class="example-ru">${escHtml(item.ru)}</div>
        ${item.note ? `<div class="example-note">${escHtml(item.note)}</div>` : ''}
      </div>
      <div class="example-btns">
        <button class="btn-tts btn-tts-vi ${btnViClass}" onclick="TTS.speak('${escAttr(item.vi)}','vi',this)">🔊 VIE</button>
        <button class="btn-tts btn-tts-ru" onclick="TTS.speak('${escAttr(item.ru)}','ru',this)">🔊 RU</button>
        <button class="save-btn ${isSaved ? 'saved' : ''}" title="Сохранить" onclick="Cards.toggleSave('${escAttr(savedKey)}','${escAttr(item.vi)}','${escAttr(item.ru)}','${escAttr(item.note||'')}','${lesson.id}',this)">
          ${isSaved ? '★' : '☆'}
        </button>
      </div>
    </div>`;
  }

  function _renderVocabSection(lesson, sec, color) {
    if (!lesson.vocab.length) return '';
    const btnViClass = lesson.level === 'A0' ? '' : 'a1up';
    const rows = lesson.vocab.map(v => `
    <tr>
      <td class="vocab-vi">${escHtml(v.vi)}</td>
      ${v.pron ? `<td class="vocab-pron">${escHtml(v.pron)}</td>` : '<td></td>'}
      <td>${escHtml(v.ru)}</td>
      <td class="vocab-btns">
        <button class="btn-tts btn-tts-vi ${btnViClass}" onclick="TTS.speak('${escAttr(v.vi)}','vi',this)">🔊</button>
        <button class="btn-tts btn-tts-ru" onclick="TTS.speak('${escAttr(v.ru)}','ru',this)">🔊</button>
      </td>
    </tr>`).join('');

    return `
    <div class="lesson-section" id="ls-vocabulary">
      <div class="lesson-section-title">${sec.title || '📖 Словарь урока'}</div>
      <table class="vocab-table">
        <thead><tr>
          <th>Вьетнамский</th>
          ${lesson.vocab[0]?.pron ? '<th>Произношение</th>' : '<th></th>'}
          <th>Русский</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function _pushScreen(name, title) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`).classList.add('active');

    // Update header
    document.getElementById('header-title').textContent = title;
    const backBtn = document.getElementById('btn-back');

    if (name === 'home') {
      _screenStack = ['home'];
      backBtn.style.display = 'none';
    } else {
      _screenStack.push(name);
      backBtn.style.display = 'flex';
    }

    _setFontControls(name !== 'home');
  }

  function pushScreen(name, title) {
    _pushScreen(name, title);
  }

  function _setFontControls(visible) {
    const el = document.getElementById('font-size-controls');
    if (el) el.style.display = visible ? 'flex' : 'none';
    if (visible && window.LessonFont) LessonFont.apply();
  }

  function showTab(tab, btn) {
    AutoPlay.stop();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${tab}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const titles = { home: 'Вьетнамский язык', cards: 'Карточки', writing: 'Практика письма', search: 'Поиск по курсу' };
    document.getElementById('header-title').textContent = titles[tab] || '';
    document.getElementById('btn-back').style.display = 'none';
    _screenStack = [tab];
    _setFontControls(tab !== 'home');

    if (tab === 'cards') Cards.render();
    if (tab === 'search') { document.getElementById('search-input').focus(); }
    if (tab === 'writing') {
      if (Writing.refreshSources) Writing.refreshSources();
    }
  }

  function goBack() {
    if (_screenStack.length <= 1) return;
    AutoPlay.stop();
    _screenStack.pop();
    const prev = _screenStack[_screenStack.length - 1];

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${prev}`).classList.add('active');
    _setFontControls(prev !== 'home');

    const tabTitles = { home: 'Вьетнамский язык', cards: 'Карточки', writing: 'Практика письма', search: 'Поиск по курсу' };
    if (prev === 'home') {
      document.getElementById('header-title').textContent = tabTitles.home;
      document.getElementById('btn-back').style.display = 'none';
    } else if (prev === 'lessons') {
      document.getElementById('header-title').textContent = `Уровень ${_currentLevel}`;
    } else if (tabTitles[prev]) {
      document.getElementById('header-title').textContent = tabTitles[prev];
      document.getElementById('btn-back').style.display = 'none';
      if (prev === 'cards') Cards.render();
      if (prev === 'writing' && Writing.refreshSources) Writing.refreshSources();
      // Sync bottom nav active state
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      const navBtn = document.querySelector(`.nav-btn[data-screen="${prev}"]`);
      if (navBtn) navBtn.classList.add('active');
    }
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function getLessons() { return _data?.lessons || []; }
  function getData() { return _data; }
  function getCurrentLesson() { return _currentLesson; }

  // Helpers
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escAttr(s) {
    return String(s || '').replace(/'/g,"\\'").replace(/\n/g,' ');
  }

  function showHelp() {
    AutoPlay.stop();
    pushScreen('help', 'Справка');
    _setFontControls(false);
    // Прокрутить в начало
    const screen = document.getElementById('screen-help');
    if (screen) screen.scrollTop = 0;
  }

  return { init, showLevel, showLesson, showLessonAt, showTab, goBack, showToast, getLessons, getData, getCurrentLesson, pushScreen, showHelp, toggleTheme };
})();

/* ===== LESSON FONT SIZE CONTROL ===== */
const LessonFont = (() => {
  const STORAGE_KEY = 'viet_lesson_font_scale';
  const STEPS = [70, 80, 90, 100, 110, 120, 130, 145, 160, 180];
  let _stepIdx = 3; // default = 100%

  function _load() {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '100', 10);
    _stepIdx = STEPS.indexOf(saved);
    if (_stepIdx < 0) _stepIdx = 3;
  }

  function apply() {
    _load();
    _applyScale();
  }

  function _applyScale() {
    const scale = STEPS[_stepIdx];
    const z = (scale / 100).toString();
    document.querySelectorAll('.screen-content').forEach(el => {
      el.style.zoom = z;
      el.style.webkitTextSizeAdjust = scale + '%';
    });
    const label = document.getElementById('font-sz-label');
    if (label) label.textContent = scale + '%';
  }

  function increase() {
    if (_stepIdx < STEPS.length - 1) {
      _stepIdx++;
      _save();
      _applyScale();
    }
  }

  function decrease() {
    if (_stepIdx > 0) {
      _stepIdx--;
      _save();
      _applyScale();
    }
  }

  function _save() {
    localStorage.setItem(STORAGE_KEY, STEPS[_stepIdx]);
  }

  return { apply, increase, decrease };
})();
