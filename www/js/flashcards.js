/* ===== FLASHCARDS SYSTEM ===== */
'use strict';

const Cards = (() => {
  const STORAGE_KEY = 'viet_cards';
  const FOLDERS_KEY = 'viet_folders';
  const PROGRESS_KEY = 'viet_progress';

  let _data = null;
  // { key: { vi, ru, note, lessonId, savedAt, folderId } }
  let _cards = {};
  // { id: { id, name, icon } }
  let _folders = {};
  // currently selected folder shown under the folders list
  let _activeFolderId = 'default';

  function init(appData) {
    _data = appData;
    _load();
  }

  function _load() {
    try {
      _cards = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      _folders = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '{}');
      if (!_folders['default']) {
        _folders['default'] = { id: 'default', name: 'Избранное', icon: '⭐' };
        _save();
      }
    } catch(e) {
      _cards = {};
      _folders = { default: { id: 'default', name: 'Избранное', icon: '⭐' } };
    }
  }

  function _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cards));
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(_folders));
  }

  function isSaved(key) {
    return !!_cards[key];
  }

  function toggleSave(key, vi, ru, note, lessonId, btn) {
    if (_cards[key]) {
      delete _cards[key];
      _save();
      if (btn) { btn.textContent = '☆'; btn.classList.remove('saved'); }
      App.showToast('Карточка удалена');
    } else {
      _cards[key] = { vi, ru, note, lessonId, savedAt: Date.now(), folderId: 'default' };
      _save();
      if (btn) { btn.textContent = '★'; btn.classList.add('saved'); }
      App.showToast('Карточка сохранена ★');
    }
  }

  function saveCard(key, vi, ru, note, lessonId, folderId) {
    _cards[key] = { vi, ru, note, lessonId, savedAt: Date.now(), folderId: folderId || 'default' };
    _save();
  }

  function deleteCard(key) {
    const card = _cards[key];
    if (!card) return;
    if (card.lessonId === 'custom') {
      _confirmDanger(
        'Удалить карточку?',
        'Эта карточка создана вручную. После удаления её нельзя будет восстановить из материалов уроков.',
        () => _doDeleteCard(key)
      );
      return;
    }
    _doDeleteCard(key);
  }

  function _doDeleteCard(key) {
    if (!_cards[key]) return;
    delete _cards[key];
    _save();
    render();
    App.showToast('Карточка удалена');
  }

  function moveToFolder(key, folderId) {
    if (_cards[key]) {
      _cards[key].folderId = folderId;
      _save();
      render();
      const folder = _folders[folderId];
      if (folder) App.showToast(`Перемещено в "${folder.name}"`);
    }
  }

  function createFolder() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
    <div class="dialog">
      <h3>Новая папка</h3>
      <input type="text" class="dialog-input" id="folder-name-input" placeholder="Название папки" maxlength="30">
      <div class="dialog-btns">
        <button class="btn-secondary" onclick="this.closest('.dialog-overlay').remove()">Отмена</button>
        <button class="btn-primary" onclick="Cards._doCreateFolder(this)">Создать</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#folder-name-input').focus();
  }

  function _doCreateFolder(btn) {
    const input = btn.closest('.dialog').querySelector('#folder-name-input');
    const name = input.value.trim();
    if (!name) return;
    const id = 'folder_' + Date.now();
    _folders[id] = { id, name, icon: '📁' };
    _save();
    btn.closest('.dialog-overlay').remove();
    render();
    App.showToast(`Папка "${name}" создана`);
  }

  function createCard(presetFolderId) {
    const folderOpts = Object.values(_folders).map(f =>
      `<option value="${f.id}" ${f.id === (presetFolderId || 'default') ? 'selected' : ''}>${f.icon} ${escHtml(f.name)}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
    <div class="dialog dialog-card">
      <h3>Новая карточка</h3>
      <label class="dialog-label">Вьетнамская фраза</label>
      <input type="text" class="dialog-input" id="card-vi-input" placeholder="Xin chào" lang="vi" autocapitalize="none" autocomplete="off">
      <label class="dialog-label">Пояснение (необязательно)</label>
      <input type="text" class="dialog-input" id="card-note-input" placeholder="разбор частей фразы" autocomplete="off">
      <label class="dialog-label">Русский перевод</label>
      <input type="text" class="dialog-input" id="card-ru-input" placeholder="Привет" autocomplete="off">
      <label class="dialog-label">Папка</label>
      <select class="select-input" id="card-folder-input" style="margin-bottom:16px;width:100%">
        ${folderOpts}
      </select>
      <div class="dialog-btns">
        <button class="btn-secondary" onclick="this.closest('.dialog-overlay').remove()">Отмена</button>
        <button class="btn-primary" onclick="Cards._doCreateCard(this)">Создать</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#card-vi-input').focus();
  }

  function _doCreateCard(btn) {
    const dialog = btn.closest('.dialog');
    const vi = dialog.querySelector('#card-vi-input').value.trim();
    const ru = dialog.querySelector('#card-ru-input').value.trim();
    const note = dialog.querySelector('#card-note-input').value.trim();
    const folderId = dialog.querySelector('#card-folder-input').value || 'default';
    if (!vi || !ru) {
      App.showToast('Введите вьетнамскую фразу и перевод');
      return;
    }
    const key = `custom::${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _cards[key] = { vi, ru, note, lessonId: 'custom', savedAt: Date.now(), folderId };
    _save();
    btn.closest('.dialog-overlay').remove();
    // Switch to the folder the user picked so they immediately see the new card
    _activeFolderId = folderId;
    render();
    App.showToast('Карточка создана ★');
  }

  function render() {
    _renderFolders();
    _renderSavedCards();
  }

  function _renderFolders() {
    const container = document.getElementById('folders-list');
    if (!container) return;
    const fList = Object.values(_folders);
    if (!fList.length) {
      container.innerHTML = '<div class="empty-state"><p>Нет папок</p></div>';
      return;
    }
    container.innerHTML = fList.map(f => {
      const count = Object.values(_cards).filter(c => c.folderId === f.id).length;
      const isActive = f.id === _activeFolderId;
      const playBtn = count > 0
        ? `<button class="folder-play-btn" title="Авто-плей папки" onclick="event.stopPropagation();Cards.playFolder('${f.id}')">▶</button>`
        : '';
      const studyBtn = count > 0
        ? `<button class="folder-study-btn" onclick="event.stopPropagation();Cards.studyFolder('${f.id}')">Учить</button>`
        : '';
      const delBtn = f.id !== 'default'
        ? `<button class="btn-text" onclick="event.stopPropagation();Cards.deleteFolder('${f.id}')">🗑</button>`
        : '';
      return `
      <div class="folder-item${isActive ? ' folder-item-active' : ''}" onclick="Cards.selectFolder('${f.id}')">
        <div class="folder-icon">${f.icon}</div>
        <div class="folder-info">
          <div class="folder-name">${escHtml(f.name)}</div>
          <div class="folder-count">${count} карточек</div>
        </div>
        <div class="folder-btns">
          ${playBtn}
          ${studyBtn}
          ${delBtn}
        </div>
      </div>`;
    }).join('');
  }

  function selectFolder(folderId) {
    if (!_folders[folderId]) return;
    _activeFolderId = folderId;
    render();
  }

  function _renderSavedCards() {
    const container = document.getElementById('saved-cards-list');
    if (!container) return;

    // Make sure active folder still exists
    if (!_folders[_activeFolderId]) _activeFolderId = 'default';
    const activeFolder = _folders[_activeFolderId];

    // Update section heading to reflect active folder
    const titleEl = document.getElementById('cards-list-title');
    if (titleEl) {
      titleEl.innerHTML = `${activeFolder.icon} Карточки в папке «${escHtml(activeFolder.name)}»`;
    }

    const saved = Object.entries(_cards).filter(([k, c]) => c.folderId === _activeFolderId);
    if (!saved.length) {
      const isDefault = _activeFolderId === 'default';
      container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">☆</div>
        <h3>В этой папке нет карточек</h3>
        <p>${isDefault
          ? 'Нажмите ☆ на любой фразе в уроке, или создайте свою кнопкой «+ Карточка»'
          : 'Переместите сюда карточки из других папок или создайте новые'}</p>
      </div>`;
      return;
    }
    container.innerHTML = saved.map(([key, card]) => {
      const folder = _folders[card.folderId] || _folders.default;
      const isCustom = card.lessonId === 'custom';
      const lesson = isCustom ? null : _data?.lessons?.find(l => l.id === card.lessonId);
      const lessonLabel = isCustom
        ? '✏️ Своя карточка'
        : (lesson ? `Урок ${lesson.level}-${lesson.num}` : card.lessonId);
      const metaText = lessonLabel;
      const folderOptions = Object.values(_folders).map(f =>
        `<option value="${f.id}" ${f.id === card.folderId ? 'selected' : ''}>${f.icon} ${f.name}</option>`
      ).join('');
      const noteHtml = card.note ? `<div class="saved-card-note">${escHtml(card.note)}</div>` : '';
      return `
      <div class="saved-card-item${isCustom ? ' saved-card-custom' : ''}">
        <div class="saved-card-texts">
          <div class="saved-card-vi">${escHtml(card.vi)}</div>
          <div class="saved-card-ru">${escHtml(card.ru)}</div>
          ${noteHtml}
          <div class="saved-card-meta">${metaText}</div>
          <select class="select-input" style="font-size:12px;padding:3px 8px;margin-top:4px" onchange="Cards.moveToFolder('${escAttr(key)}',this.value)">
            ${folderOptions}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn-tts btn-tts-vi a1up" onclick="TTS.speak('${escAttr(card.vi)}','vi',this)" style="font-size:11px;padding:4px 8px">🔊</button>
          <button class="btn-tts btn-tts-ru" onclick="TTS.speak('${escAttr(card.ru)}','ru',this)" style="font-size:11px;padding:4px 8px">🔊</button>
          <button class="unsave-btn" title="Удалить" onclick="Cards.deleteCard('${escAttr(key)}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  function deleteFolder(id) {
    if (id === 'default') return;
    // Move all cards (including manually created ones) to the default folder
    Object.values(_cards).forEach(c => { if (c.folderId === id) c.folderId = 'default'; });
    delete _folders[id];
    if (_activeFolderId === id) _activeFolderId = 'default';
    _save();
    render();
    App.showToast('Папка удалена');
  }

  function _confirmDanger(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
    <div class="dialog">
      <h3>${title}</h3>
      <p class="dialog-text">${message}</p>
      <div class="dialog-btns">
        <button class="btn-secondary" data-act="cancel">Отмена</button>
        <button class="btn-danger" data-act="confirm">Удалить совсем</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
  }

  function studyFolder(folderId) {
    const cards = Object.entries(_cards)
      .filter(([k, c]) => c.folderId === folderId)
      .map(([key, c]) => ({ key, ...c }));
    if (!cards.length) { App.showToast('Нет карточек в этой папке'); return; }
    _startStudy(cards, _folders[folderId]?.name || 'Карточки');
  }

  function playFolder(folderId) {
    const folder = _folders[folderId];
    if (!folder) return;
    const cards = Object.values(_cards).filter(c => c.folderId === folderId);
    if (!cards.length) { App.showToast('Нет карточек в этой папке'); return; }

    const content = document.getElementById('folder-play-content');
    if (!content) return;

    const cardsHtml = cards.map(c => `
      <div class="example-card" data-vi="${escHtml(c.vi)}" data-ru="${escHtml(c.ru)}">
        <div class="example-texts">
          <div class="example-vi">${escHtml(c.vi)}</div>
          <div class="example-ru">${escHtml(c.ru)}</div>
          ${c.note ? `<div class="example-note">${escHtml(c.note)}</div>` : ''}
        </div>
        <div class="example-btns">
          <button class="btn-tts btn-tts-vi a1up" onclick="TTS.speak('${escAttr(c.vi)}','vi',this)">🔊 VIE</button>
          <button class="btn-tts btn-tts-ru" onclick="TTS.speak('${escAttr(c.ru)}','ru',this)">🔊 RU</button>
        </div>
      </div>`).join('');

    content.innerHTML = `
    <div class="lesson-header" style="background:linear-gradient(135deg,#1a7a4f,#0e5435)">
      <div class="lesson-badge">📁 Папка</div>
      <div class="lesson-h-title">${escHtml(folder.name)}</div>
      <div class="lesson-h-meta">
        <span>🎯 ${cards.length} фраз</span>
      </div>
      <div class="ap-controls">
        <button class="btn-ap" id="ap-toggle-btn" onclick="AutoPlay.toggle()">▶ Авто-плей</button>
        <button class="ap-speed-btn" data-speed="0.5" onclick="TTS.setSpeed(0.5, this)">🐢</button>
        <button class="ap-speed-btn active" data-speed="1.0" onclick="TTS.setSpeed(1.0, this)">🚶</button>
        <button class="ap-speed-btn" data-speed="1.6" onclick="TTS.setSpeed(1.6, this)">🏃</button>
        <button class="btn-ap" id="ap-loop-btn" onclick="AutoPlay.toggleLoop()">🔁 Повтор</button>
      </div>
      <div class="ap-controls tts-mode-row">
        <span class="tts-mode-label">🎙️ Движок:</span>
        <button class="tts-mode-btn ${TTS.getMode()==='gtranslate'?'active':''}" data-mode="gtranslate" onclick="App.setTtsMode('gtranslate')">🌐 Google Translate</button>
        <button class="tts-mode-btn ${TTS.getMode()==='webspeech'?'active':''}" data-mode="webspeech" onclick="App.setTtsMode('webspeech')">🔵 Системный TTS</button>
      </div>
    </div>
    <div class="lesson-section">
      <div class="lesson-section-title">Все карточки папки</div>
      ${cardsHtml}
    </div>`;

    AutoPlay.stop();
    AutoPlay.setLesson(
      { level: '📁', num: '', title: folder.name },
      '',
      `📁 ${folder.name} · ${cards.length} фраз`
    );
    App.pushScreen('folder-play', folder.name);
    // Auto-start playback after navigation (DOM is rendered, screen is active)
    setTimeout(() => AutoPlay.toggle(), 80);
  }

  function _startStudy(cards, title) {
    // Shuffle cards
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    let idx = 0;
    let flipped = false;
    let unknown = [];

    function showCard(i) {
      flipped = false;
      const card = shuffled[i];
      const container = document.getElementById('study-content');
      if (!container) return;
      const isCustom = card.lessonId === 'custom';
      const lesson = isCustom ? null : _data?.lessons?.find(l => l.id === card.lessonId);
      const lessonMeta = isCustom ? '✏️ Своя карточка' : (lesson ? `Урок ${lesson.level}-${lesson.num}` : '');
      const pct = Math.round((i / shuffled.length) * 100);

      container.innerHTML = `
      <div class="study-progress">
        <span class="study-progress-text">${i + 1} / ${shuffled.length}</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="flashcard" id="fc-main" onclick="Cards._flip()">
        <div class="flashcard-front" id="fc-front">
          <div class="flashcard-hint">Нажмите, чтобы увидеть ответ</div>
          <div class="flashcard-ru">${escHtml(card.ru)}</div>
          <div class="flashcard-lesson">${lessonMeta}</div>
        </div>
        <div class="flashcard-back" id="fc-back" style="display:none">
          <div class="flashcard-vi">${escHtml(card.vi)}</div>
          ${card.note ? `<div class="flashcard-note">${escHtml(card.note)}</div>` : ''}
          <div class="flashcard-lesson">${lessonMeta}</div>
          <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
            <button class="btn-tts btn-tts-vi a1up" onclick="event.stopPropagation();TTS.speak('${escAttr(card.vi)}','vi',this)">🔊 VIE</button>
            <button class="btn-tts btn-tts-ru" onclick="event.stopPropagation();TTS.speak('${escAttr(card.ru)}','ru',this)">🔊 RU</button>
          </div>
        </div>
      </div>
      <div class="study-actions" id="study-actions" style="display:none">
        <button class="btn-unknown" onclick="Cards._markUnknown()">✗ Не знаю</button>
        <button class="btn-know" onclick="Cards._markKnow()">✓ Знаю</button>
      </div>
      <button class="btn-text-danger" onclick="App.goBack()">Завершить</button>
      `;
    }

    Cards._flip = function() {
      if (flipped) return;
      flipped = true;
      document.getElementById('fc-front').style.display = 'none';
      document.getElementById('fc-back').style.display = 'block';
      document.getElementById('study-actions').style.display = 'flex';
      // Auto-speak Vietnamese
      const card = shuffled[idx];
      TTS.speak(card.vi, 'vi', null);
    };

    Cards._markKnow = function() {
      TTS.stopAll();
      idx++;
      if (idx < shuffled.length) showCard(idx);
      else _showComplete(shuffled.length, unknown.length);
    };

    Cards._markUnknown = function() {
      TTS.stopAll();
      unknown.push(shuffled[idx]);
      idx++;
      if (idx < shuffled.length) showCard(idx);
      else _showComplete(shuffled.length, unknown.length);
    };

    function _showComplete(total, unknownCount) {
      const container = document.getElementById('study-content');
      container.innerHTML = `
      <div class="study-complete">
        <div class="study-complete-icon">${unknownCount === 0 ? '🎉' : '📚'}</div>
        <h2>${unknownCount === 0 ? 'Отлично!' : 'Сессия завершена'}</h2>
        <p>Изучено: ${total - unknownCount} / ${total}<br>
        ${unknownCount > 0 ? `Повторить: ${unknownCount} карточек` : 'Все карточки знаете!'}</p>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:center">
          ${unknownCount > 0 ? `<button class="btn-primary" onclick="Cards._restartWithUnknown()">Повторить незнакомые</button>` : ''}
          <button class="btn-secondary" onclick="App.goBack()">Вернуться</button>
        </div>
      </div>`;
      if (unknownCount > 0) {
        Cards._restartWithUnknown = function() {
          shuffled.length = 0;
          unknown.forEach(c => shuffled.push(c));
          unknown.length = 0;
          idx = 0;
          showCard(0);
        };
      }
    }

    App.pushScreen('study', title);
    showCard(0);
  }

  function getLevelProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    } catch(e) { return {}; }
  }

  function markLessonDone(lessonId) {
    const p = getLevelProgress();
    p[lessonId] = true;
    const lesson = lessonId.split('-');
    if (lesson.length >= 2) p[lesson[0]] = (p[lesson[0]] || 0) + 1;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escAttr(s) {
    return String(s || '').replace(/'/g,"\\'").replace(/\n/g,' ');
  }

  function getFolders() {
    return Object.values(_folders);
  }

  function getCardsInFolder(folderId) {
    return Object.values(_cards).filter(c => c.folderId === folderId);
  }

  // ===== Экспорт / импорт =====
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _stamp() {
    const d = new Date();
    return `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}-${_pad(d.getHours())}${_pad(d.getMinutes())}`;
  }

  async function exportData() {
    const payload = {
      app: 'viet-learn',
      schema: 1,
      exportedAt: new Date().toISOString(),
      counts: {
        folders: Object.keys(_folders).length,
        cards: Object.keys(_cards).length
      },
      folders: _folders,
      cards: _cards
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = `tiengviet-cards-${_stamp()}.json`;

    // На Android (Capacitor) пишем реальный файл через Filesystem и
    // открываем системный шер — пользователь сам выберет, куда сохранить.
    if (window.Capacitor?.isPluginAvailable?.('Filesystem')) {
      try {
        const fs = window.Capacitor.Plugins.Filesystem;
        const share = window.Capacitor.Plugins.Share;
        const Directory = (window.Capacitor?.Filesystem?.Directory) || { Cache: 'CACHE', Documents: 'DOCUMENTS' };

        // Пишем в Cache (без разрешений), потом шерим content:// URI
        const writeRes = await fs.writeFile({
          path: filename,
          data: json,
          directory: 'CACHE',
          encoding: 'utf8'
        });
        const fileUri = writeRes?.uri;

        if (share && share.share && fileUri) {
          try {
            await share.share({
              title: 'TiengViet — экспорт карточек',
              text: `${payload.counts.cards} карточек, ${payload.counts.folders} папок`,
              url: fileUri,
              dialogTitle: 'Сохранить или отправить файл'
            });
            App.showToast('Файл готов — выберите куда сохранить');
            return;
          } catch (shareErr) {
            // Пользователь отменил шер — не страшно. Пробуем ещё положить в Documents.
          }
        }

        // Fallback: продублируем в Documents (видно через приложение «Файлы»)
        try {
          await fs.writeFile({
            path: filename,
            data: json,
            directory: 'DOCUMENTS',
            encoding: 'utf8'
          });
          App.showToast(`Сохранено: Documents/${filename}`);
        } catch(e) {
          App.showToast('Файл записан во временную папку приложения');
        }
        return;
      } catch (e) {
        console.warn('Capacitor export failed, falling back to blob:', e);
      }
    }

    const blob = new Blob([json], { type: 'application/json' });

    // PWA / iPadOS Safari: системное меню "Поделиться" умеет сохранить
    // файл в Files, iCloud Drive, мессенджер или другое приложение.
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'TiengViet — экспорт карточек',
            text: `${payload.counts.cards} карточек, ${payload.counts.folders} папок`,
            files: [file]
          });
          App.showToast('Файл готов — выберите куда сохранить');
          return;
        }
      } catch (e) {
        if (e && e.name !== 'AbortError') {
          console.warn('Web Share export failed, falling back to download:', e);
        }
      }
    }

    // Web / Tauri fallback: классический blob-download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch(e) {}
      URL.revokeObjectURL(url);
    }, 200);
    App.showToast(`Экспортировано: ${payload.counts.cards} карточек, ${payload.counts.folders} папок`);
  }

  function importDataPrompt() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let data;
        try {
          data = JSON.parse(String(reader.result || ''));
        } catch(e) {
          App.showToast('Файл не является корректным JSON');
          return;
        }
        if (!data || data.app !== 'viet-learn' || !data.cards || !data.folders) {
          App.showToast('Не похоже на файл TiengViet');
          return;
        }
        _showImportDialog(data);
      };
      reader.onerror = () => App.showToast('Не удалось прочитать файл');
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  }

  function _showImportDialog(data) {
    const incFolders = Object.keys(data.folders || {}).length;
    const incCards = Object.keys(data.cards || {}).length;
    const haveFolders = Object.keys(_folders).length;
    const haveCards = Object.keys(_cards).length;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);color:var(--text-primary);border-radius:14px;padding:20px 22px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <h3 style="margin:0 0 12px;font-size:18px;">Импорт карточек</h3>
        <div style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:14px;">
          <div>В файле: <b>${incCards}</b> карточек, <b>${incFolders}</b> папок</div>
          <div>Сейчас в приложении: <b>${haveCards}</b> карточек, <b>${haveFolders}</b> папок</div>
          ${data.exportedAt ? `<div style="opacity:0.7;font-size:12px;margin-top:6px;">Экспорт от ${new Date(data.exportedAt).toLocaleString('ru-RU')}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="imp-merge" class="btn-primary" style="width:100%;">➕ Дополнить (добавить недостающее)</button>
          <button id="imp-replace" class="btn-outline" style="width:100%;color:var(--accent-red);border-color:var(--accent-red);">♻️ Заменить (стереть текущее)</button>
          <button id="imp-cancel" class="btn-text" style="width:100%;">Отмена</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { document.body.removeChild(overlay); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#imp-cancel').onclick = close;
    overlay.querySelector('#imp-merge').onclick = () => { close(); _doImport(data, 'merge'); };
    overlay.querySelector('#imp-replace').onclick = () => {
      if (!confirm('Заменить текущие карточки и папки содержимым файла? Это нельзя отменить.')) return;
      close();
      _doImport(data, 'replace');
    };
  }

  function _doImport(data, mode) {
    const incFolders = data.folders || {};
    const incCards = data.cards || {};
    let addedF = 0, addedC = 0, skippedF = 0, skippedC = 0;

    if (mode === 'replace') {
      _folders = { ...incFolders };
      // Гарантируем папку по умолчанию
      if (!_folders.default) {
        _folders.default = { id: 'default', name: 'Избранное', icon: '⭐' };
      }
      _cards = { ...incCards };
      // Чиним битые folderId — отправляем в default
      for (const [k, c] of Object.entries(_cards)) {
        if (!c.folderId || !_folders[c.folderId]) c.folderId = 'default';
      }
      addedF = Object.keys(incFolders).length;
      addedC = Object.keys(incCards).length;
    } else {
      // merge: только то, чего нет
      for (const [id, f] of Object.entries(incFolders)) {
        if (!_folders[id]) { _folders[id] = f; addedF++; }
        else skippedF++;
      }
      for (const [k, c] of Object.entries(incCards)) {
        if (!_cards[k]) {
          const cc = { ...c };
          if (!cc.folderId || !_folders[cc.folderId]) cc.folderId = 'default';
          _cards[k] = cc;
          addedC++;
        } else skippedC++;
      }
    }

    _save();
    _activeFolderId = _folders[_activeFolderId] ? _activeFolderId : 'default';
    render();

    if (mode === 'replace') {
      App.showToast(`Заменено: ${addedC} карточек, ${addedF} папок`);
    } else {
      App.showToast(`Добавлено ${addedC} карточек, ${addedF} папок · пропущено ${skippedC}/${skippedF}`);
    }
  }

  return { init, isSaved, toggleSave, saveCard, deleteCard, moveToFolder, createFolder, _doCreateFolder, createCard, _doCreateCard, deleteFolder, studyFolder, playFolder, selectFolder, render, getLevelProgress, markLessonDone, getFolders, getCardsInFolder, exportData, importDataPrompt };
})();
