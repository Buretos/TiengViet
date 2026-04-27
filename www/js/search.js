/* ===== GLOBAL SEARCH ===== */
'use strict';

const Search = (() => {
  let _data = null;
  let _filter = 'all';
  let _debounce = null;

  function init(appData) {
    _data = appData;
  }

  function setFilter(f, btn) {
    _filter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const q = document.getElementById('search-input').value;
    if (q.trim()) _doSearch(q);
  }

  function onInput(el) {
    const q = el.value.trim();
    document.getElementById('search-clear').style.display = q ? 'block' : 'none';
    clearTimeout(_debounce);
    if (!q) { _showEmpty(); return; }
    _debounce = setTimeout(() => _doSearch(q), 280);
  }

  function clear() {
    const input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('search-clear').style.display = 'none';
    _showEmpty();
    input.focus();
  }

  function _doSearch(query) {
    if (!_data) return;
    const q = query.toLowerCase().trim();
    if (!q) { _showEmpty(); return; }

    const results = [];

    // 1. Search across course lessons
    for (const lesson of _data.lessons) {
      const secEx = lesson.section_examples || {};
      const sectionValues = Object.values(secEx).filter(v => Array.isArray(v) && v.length);
      const searchable = sectionValues.length
        ? sectionValues.flat()
        : lesson.all_examples;
      const seen = new Set();
      for (const ex of searchable) {
        const key = ex.vi + '||' + ex.ru;
        if (seen.has(key)) continue;
        seen.add(key);
        const matchVi = ex.vi.toLowerCase().includes(q);
        const matchRu = ex.ru.toLowerCase().includes(q);
        if (_filter === 'vi' && !matchVi) continue;
        if (_filter === 'ru' && !matchRu) continue;
        if (_filter === 'all' && !matchVi && !matchRu) continue;
        results.push({
          source: 'lesson',
          vi: ex.vi, ru: ex.ru, note: ex.note || '',
          lessonId: lesson.id, level: lesson.level, num: lesson.num, title: lesson.title,
          matchVi, matchRu
        });
        if (results.length >= 200) break;
      }
      if (results.length >= 200) break;
    }

    // 2. Search across folder cards
    if (typeof Cards !== 'undefined' && Cards.getFolders) {
      const folders = Cards.getFolders();
      const seenFolderCards = new Set();
      outer: for (const folder of folders) {
        const cards = Cards.getCardsInFolder(folder.id);
        for (const card of cards) {
          const matchVi = (card.vi || '').toLowerCase().includes(q);
          const matchRu = (card.ru || '').toLowerCase().includes(q);
          if (_filter === 'vi' && !matchVi) continue;
          if (_filter === 'ru' && !matchRu) continue;
          if (_filter === 'all' && !matchVi && !matchRu) continue;
          // Avoid showing the same vi+ru phrase twice from the same folder
          const fkey = folder.id + '::' + card.vi + '||' + card.ru;
          if (seenFolderCards.has(fkey)) continue;
          seenFolderCards.add(fkey);
          results.push({
            source: 'folder',
            vi: card.vi, ru: card.ru, note: card.note || '',
            folderId: folder.id, folderName: folder.name, folderIcon: folder.icon,
            lessonId: card.lessonId,
            matchVi, matchRu
          });
          if (results.length >= 200) break outer;
        }
      }
    }

    _renderResults(results, query);
  }

  function _renderResults(results, query) {
    const container = document.getElementById('search-results');
    if (!results.length) {
      container.innerHTML = `
      <div class="search-empty">
        <div class="search-empty-icon">🔍</div>
        <p>Ничего не найдено по запросу <strong>"${escHtml(query)}"</strong></p>
      </div>`;
      return;
    }

    const lessonCount = results.filter(r => r.source === 'lesson').length;
    const folderCount = results.filter(r => r.source === 'folder').length;

    const limitedResults = results.slice(0, 100);
    const more = results.length > 100 ? results.length - 100 : 0;

    const countText = folderCount > 0
      ? `Найдено: ${results.length}${results.length >= 200 ? '+' : ''} (📚 уроки: ${lessonCount} · 📁 папки: ${folderCount})`
      : `Найдено: ${results.length}${results.length >= 200 ? '+' : ''} результатов`;

    container.innerHTML = `
    <div class="search-count">${countText}</div>
    <div class="search-results-list">
      ${limitedResults.map(r => _renderResult(r, query)).join('')}
      ${more ? `<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">...ещё ${more} результатов. Уточните запрос.</div>` : ''}
    </div>`;
  }

  function _renderResult(r, query) {
    const viHl = _highlight(r.vi, query);
    const ruHl = _highlight(r.ru, query);

    if (r.source === 'folder') {
      return `
      <div class="search-result-item search-result-folder"
           onclick="Search._openFolder('${escAttr(r.folderId)}')">
        <div class="search-result-vi">${viHl}</div>
        <div class="search-result-ru">${ruHl}</div>
        <div class="search-result-meta">
          <span class="search-result-badge search-result-badge-folder">${r.folderIcon || '📁'} ${escHtml(r.folderName)}</span>
          <span style="margin-left:8px">
            <button class="btn-tts btn-tts-vi a1up" onclick="event.stopPropagation();TTS.speak('${escAttr(r.vi)}','vi',this)" style="padding:3px 8px;font-size:11px">🔊</button>
            <button class="btn-tts btn-tts-ru" onclick="event.stopPropagation();TTS.speak('${escAttr(r.ru)}','ru',this)" style="padding:3px 8px;font-size:11px">🔊</button>
          </span>
        </div>
      </div>`;
    }

    return `
    <div class="search-result-item" data-lesson="${r.lessonId}" data-vi="${escHtml(r.vi)}" onclick="App.showLessonAt(this.dataset.lesson, this.dataset.vi)">
      <div class="search-result-vi">${viHl}</div>
      <div class="search-result-ru">${ruHl}</div>
      <div class="search-result-meta">
        <span class="search-result-badge">📚 Урок ${r.level}-${r.num}${r.title ? ': ' + escHtml(r.title.substring(0, 40)) : ''}</span>
        <span style="margin-left:8px">
          <button class="btn-tts btn-tts-vi a1up" onclick="event.stopPropagation();TTS.speak('${escAttr(r.vi)}','vi',this)" style="padding:3px 8px;font-size:11px">🔊</button>
          <button class="btn-tts btn-tts-ru" onclick="event.stopPropagation();TTS.speak('${escAttr(r.ru)}','ru',this)" style="padding:3px 8px;font-size:11px">🔊</button>
        </span>
      </div>
    </div>`;
  }

  function _openFolder(folderId) {
    const navBtn = document.querySelector('.nav-btn[data-screen="cards"]');
    if (navBtn && App && App.showTab) App.showTab('cards', navBtn);
    if (typeof Cards !== 'undefined' && Cards.selectFolder) {
      Cards.selectFolder(folderId);
    }
  }

  function _highlight(text, query) {
    const escaped = escHtml(text);
    if (!query) return escaped;
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(q, 'gi'), m => `<span class="highlight">${m}</span>`);
  }

  function _showEmpty() {
    document.getElementById('search-results').innerHTML = `
    <div class="search-empty">
      <div class="search-empty-icon">🔍</div>
      <p>Введите слово или фразу для поиска<br>по всем 300 урокам курса и сохранённым папкам</p>
    </div>`;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escAttr(s) {
    return String(s || '').replace(/'/g,"\\'").replace(/\n/g,' ');
  }

  return { init, setFilter, onInput, clear, _openFolder };
})();
