'use strict';

/* =============================================================
   MindTask - アウトラインエディタ → マインドマップ
   ============================================================= */

// ===== STATE =====

const State = {
  items: [],
  currentDocId: null,
  propsIdx: null,
  panX: 0, panY: 0,
  isPanning: false,
  _panSX: 0, _panSY: 0, _panOX: 0, _panOY: 0,
  currentView: 'map',
  mobilePanel: 'editor',
  _vRoot: null,
  _mapTimer: null,
  _saveTimer: null,
  taskSort: 'deadline',
  taskSortDir: 'asc',
  taskSubView: 'list',
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  hideCompleted: false,
  scale: 1,
  quickFilter: '',   // '' | 'today' | 'tomorrow' | 'week'
  noteItemId: null,
  statusConfig: [],  // カスタムステータス設定
};

// ===== 定数 =====

const DEFAULT_STATUS_CONFIG = [
  { key: 'todo',        label: '未着手',     bg: '#F1F5F9', fg: '#475569', isDone: false },
  { key: 'in_progress', label: '進行中',     bg: '#EFF6FF', fg: '#1D4ED8', isDone: false },
  { key: 'on_hold',     label: '保留',       bg: '#FFFBEB', fg: '#92400E', isDone: false },
  { key: 'consulting',  label: '要相談',     bg: '#F5F3FF', fg: '#6D28D9', isDone: false },
  { key: 'done',        label: '完了',       bg: '#F0FDF4', fg: '#166534', isDone: true  },
  { key: 'someday',     label: 'いつかやる', bg: '#F8FAFC', fg: '#64748B', isDone: false },
  { key: 'cancelled',   label: 'キャンセル', bg: '#FFF5F5', fg: '#991B1B', isDone: true  },
];

const NEW_STATUS_COLORS = [
  { bg: '#FFF7ED', fg: '#9A3412' },
  { bg: '#FDF4FF', fg: '#7E22CE' },
  { bg: '#ECFEFF', fg: '#155E75' },
  { bg: '#FEFCE8', fg: '#A16207' },
  { bg: '#FFF1F2', fg: '#BE123C' },
  { bg: '#F0FDF4', fg: '#15803D' },
];

// ===== UTILS =====

let _idCount = 0;
function genId() { return `i${Date.now()}_${++_idCount}`; }

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scheduleMapUpdate() {
  clearTimeout(State._mapTimer);
  State._mapTimer = setTimeout(refreshMap, 380);
}

function scheduleSave() {
  clearTimeout(State._saveTimer);
  document.getElementById('save-status').textContent = '保存中…';
  State._saveTimer = setTimeout(saveCurrentDoc, 2000);
}

// ===== ステータス設定ヘルパー =====

function loadStatusConfig() {
  try {
    const s = localStorage.getItem('mindtask_status_config');
    State.statusConfig = s ? JSON.parse(s) : [];
  } catch(e) { State.statusConfig = []; }
  if (!State.statusConfig.length)
    State.statusConfig = DEFAULT_STATUS_CONFIG.map(s => ({...s}));
}

function saveStatusConfig() {
  localStorage.setItem('mindtask_status_config', JSON.stringify(State.statusConfig));
}

function getStatusLabel(key) {
  const s = State.statusConfig.find(s => s.key === key);
  return s ? s.label : (key || '');
}

function getStatusBadgeStyle(key) {
  const s = State.statusConfig.find(s => s.key === key);
  return s ? `background:${s.bg};color:${s.fg}` : 'background:#F1F5F9;color:#475569';
}

function isStatusDone(key) {
  const s = State.statusConfig.find(s => s.key === key);
  return s ? !!s.isDone : (key === 'done' || key === 'cancelled');
}

function getStatusOrder(key) {
  const idx = State.statusConfig.findIndex(s => s.key === key);
  return idx === -1 ? 99 : idx;
}

function syncStatusOptions() {
  // pop-status の選択肢を動的生成
  const popStatus = document.getElementById('pop-status');
  if (popStatus) {
    const cur = popStatus.value;
    popStatus.innerHTML = State.statusConfig.map(s =>
      `<option value="${esc(s.key)}">${esc(s.label)}</option>`
    ).join('');
    if (State.statusConfig.some(s => s.key === cur)) popStatus.value = cur;
  }
  // filter-status の選択肢を動的生成
  const filterStatus = document.getElementById('filter-status');
  if (filterStatus) {
    const cur = filterStatus.value;
    filterStatus.innerHTML =
      `<option value="active">未完了のみ</option>` +
      `<option value="">全て</option>` +
      State.statusConfig.map(s =>
        `<option value="${esc(s.key)}">${esc(s.label)}</option>`
      ).join('');
    filterStatus.value = cur;
  }
}

// アイテムのステータスを正規化（後方互換）
function normalizeStatus(item) {
  if (!item.isTask) return null;
  if (item.status) return item.status;
  return item.done ? 'done' : 'todo';
}

// ===== アウトラインレンダリング =====

const INDENT_PX = 28;

function renderOutline(focusIdx, cursorPos) {
  const today = new Date().toISOString().slice(0, 10);
  const container = document.getElementById('outline-editor');

  container.innerHTML = State.items.map((item, idx) => {
    const isTask  = item.isTask;
    const status  = normalizeStatus(item);
    const isDone  = isTask && isStatusDone(status);
    const isOverdue = isTask && !isDone && item.deadline && item.deadline < today;
    const indentW = item.level * INDENT_PX;
    const markerColorClass = item.markerColor ? `marker-${item.markerColor}` : '';
    const stampSpan = item.markerStamp ? `<span class="item-stamp">${item.markerStamp}</span>` : '';
    const hasNote = !!(item.note || (item.links && item.links.length > 0));

    let bulletChar, bulletClass;
    if (isTask) {
      bulletChar  = isDone ? '☑' : '☐';
      bulletClass = isDone ? 'bullet-done' : 'bullet-task';
    } else {
      bulletChar  = '●';
      bulletClass = '';
    }

    const priDot = item.priority
      ? `<span class="pri-dot pri-${item.priority}" title="${{high:'高',mid:'中',low:'低'}[item.priority]}"></span>` : '';
    const dlSpan = item.deadline
      ? `<span class="item-dl ${isOverdue ? 'overdue' : ''}">${item.deadline}</span>` : '';
    const defaultKey = State.statusConfig[0]?.key || 'todo';
    const statusBadge = isTask && status && status !== defaultKey
      ? `<span class="item-status-badge" style="${getStatusBadgeStyle(status)}">${getStatusLabel(status)}</span>` : '';
    const assigneeBadge = item.assignee
      ? `<span class="item-assignee-badge">👤 ${esc(item.assignee)}</span>` : '';

    // モバイル用インデントボタン
    const indentBtns = `
      <div class="item-indent-btns">
        <button class="indent-btn" data-action="outdent" data-idx="${idx}" ${item.level === 0 ? 'disabled' : ''} title="インデントを戻す">←</button>
        <button class="indent-btn" data-action="indent" data-idx="${idx}" title="インデント">→</button>
      </div>`;

    return `
      <div class="outline-item ${isTask ? 'is-task' : ''} ${isDone ? 'is-done' : ''} ${isOverdue ? 'is-overdue' : ''} ${markerColorClass}"
           data-idx="${idx}" data-level="${item.level}">
        <button class="item-drag-handle" data-idx="${idx}" tabindex="-1" title="ドラッグで並び替え">⠿</button>
        <div class="item-indent" style="width:${indentW}px"></div>
        <button class="item-bullet ${bulletClass}" data-idx="${idx}"
                title="${isTask ? (isDone ? 'クリックで未完了に戻す' : 'クリックで完了') : ''}">${bulletChar}</button>
        <input class="item-input ${isDone ? 'done-text' : ''}" type="text"
               value="${esc(item.text)}" data-idx="${idx}"
               placeholder="${item.level === 0 ? 'タイトル' : 'アイテムを入力…'}">
        <div class="item-meta">${stampSpan}${statusBadge}${assigneeBadge}${priDot}${dlSpan}</div>
        ${indentBtns}
        <button class="item-note-btn${hasNote ? ' has-note' : ''}" data-idx="${idx}" title="メモ・リンク">📝</button>
        <button class="item-props-btn" data-idx="${idx}" title="タスク設定・優先度・期限">•••</button>
      </div>`;
  }).join('');

  if (focusIdx !== undefined && focusIdx >= 0 && focusIdx < State.items.length) {
    requestAnimationFrame(() => {
      const input = container.querySelector(`.outline-item[data-idx="${focusIdx}"] .item-input`);
      if (!input) return;
      input.focus();
      const pos = cursorPos !== undefined ? Math.min(cursorPos, input.value.length) : input.value.length;
      input.setSelectionRange(pos, pos);
    });
  }
}

// ===== アウトラインキーボード処理 =====

function initOutlineEditor() {
  const container = document.getElementById('outline-editor');

  container.addEventListener('keydown', e => {
    if (e.target.tagName !== 'INPUT') return;
    if (e.isComposing) return; // IME変換中のEnterは無視
    const itemEl = e.target.closest('.outline-item');
    if (!itemEl) return;
    const idx = parseInt(itemEl.dataset.idx);
    const item = State.items[idx];

    if (e.key === 'Enter') {
      e.preventDefault();
      const cur = e.target.selectionStart;
      const val = e.target.value;
      item.text = val.slice(0, cur);
      const newItem = {
        id: genId(), text: val.slice(cur), level: item.level,
        isTask: true, done: false, status: State.statusConfig[0]?.key || 'todo', deadline: null, priority: null,
        markerColor: null, markerStamp: null, note: '', links: [], assignee: '',
      };
      State.items.splice(idx + 1, 0, newItem);
      renderOutline(idx + 1, 0);
      scheduleMapUpdate(); scheduleSave();
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const prev = State.items[idx - 1];
      const maxLevel = prev ? prev.level + 1 : 0;
      if (item.level < maxLevel) {
        item.level++;
        renderOutline(idx);
        scheduleMapUpdate(); scheduleSave();
      }
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (item.level > 0) {
        item.level--;
        renderOutline(idx);
        scheduleMapUpdate(); scheduleSave();
      }
      return;
    }

    if (e.key === 'Backspace' && e.target.value === '') {
      e.preventDefault();
      if (State.items.length === 1) return;
      State.items.splice(idx, 1);
      renderOutline(Math.max(0, idx - 1));
      scheduleMapUpdate(); scheduleSave();
      return;
    }

    if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      container.querySelectorAll('.item-input')[idx - 1]?.focus();
      return;
    }
    if (e.key === 'ArrowDown' && idx < State.items.length - 1) {
      e.preventDefault();
      container.querySelectorAll('.item-input')[idx + 1]?.focus();
      return;
    }
  });

  container.addEventListener('input', e => {
    if (!e.target.classList.contains('item-input')) return;
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    State.items[idx].text = e.target.value;
    scheduleMapUpdate(); scheduleSave();
  });

  container.addEventListener('click', e => {
    // 箇条書き記号 → done/undone トグル
    if (e.target.classList.contains('item-bullet')) {
      const idx = parseInt(e.target.dataset.idx);
      const item = State.items[idx];
      if (item.isTask) {
        const curStatus = normalizeStatus(item);
        const newStatus = (curStatus === 'done') ? 'todo' : 'done';
        item.status = newStatus;
        item.done   = newStatus === 'done';
        renderOutline(idx);
        scheduleMapUpdate(); scheduleSave();
        if (State.currentView === 'tasks') renderTaskList();
      }
      return;
    }

    // 📝ノートボタン
    if (e.target.classList.contains('item-note-btn')) {
      const idx = parseInt(e.target.dataset.idx);
      openNoteDrawer(State.items[idx].id);
      return;
    }

    // •••ボタン
    if (e.target.classList.contains('item-props-btn')) {
      const idx = parseInt(e.target.dataset.idx);
      openPropsPopup(e.target, idx);
      return;
    }

    // モバイル インデント/アウトデントボタン
    if (e.target.classList.contains('indent-btn')) {
      const idx    = parseInt(e.target.dataset.idx);
      const action = e.target.dataset.action;
      const item   = State.items[idx];
      if (action === 'indent') {
        const prev = State.items[idx - 1];
        const maxLevel = prev ? prev.level + 1 : 0;
        if (item.level < maxLevel) { item.level++; renderOutline(idx); scheduleMapUpdate(); scheduleSave(); }
      } else if (action === 'outdent') {
        if (item.level > 0) { item.level--; renderOutline(idx); scheduleMapUpdate(); scheduleSave(); }
      }
      return;
    }
  });

  document.getElementById('btn-add-item').addEventListener('click', () => {
    const last = State.items[State.items.length - 1];
    const newItem = {
      id: genId(), text: '', level: last ? last.level : 0,
      isTask: true, done: false, status: State.statusConfig[0]?.key || 'todo', deadline: null, priority: null,
      markerColor: null, markerStamp: null, note: '', links: [], assignee: '',
    };
    State.items.push(newItem);
    renderOutline(State.items.length - 1);
    scheduleMapUpdate(); scheduleSave();
  });
}

// ===== プロパティポップアップ =====

function openPropsPopup(btnEl, idx) {
  State.propsIdx = idx;
  const item = State.items[idx];
  const popup = document.getElementById('props-popup');

  document.getElementById('pop-is-task').checked = item.isTask;
  // ステータス選択肢を動的生成
  syncStatusOptions();
  const curStatus = normalizeStatus(item) || (State.statusConfig[0]?.key || 'todo');
  document.getElementById('pop-status').value = curStatus;
  document.getElementById('pop-deadline').value  = item.deadline || '';
  // 担当フィールド
  const popAssignee = document.getElementById('pop-assignee');
  if (popAssignee) {
    popAssignee.value = item.assignee || '';
    document.querySelectorAll('.assignee-preset-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.v === (item.assignee || '')));
  }
  document.querySelectorAll('.pri-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === (item.priority || '')));
  document.querySelectorAll('.marker-color-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.color === (item.markerColor || '')));
  document.querySelectorAll('.marker-stamp-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.stamp === (item.markerStamp || '')));
  document.getElementById('pop-task-extra').classList.toggle('hidden', !item.isTask);

  const rect = btnEl.getBoundingClientRect();
  const popW = 240;
  const left = Math.max(4, Math.min(rect.right - popW, window.innerWidth - popW - 4));
  const top  = Math.min(rect.bottom + 4, window.innerHeight - 420);
  popup.style.left = `${left}px`;
  popup.style.top  = `${top}px`;
  popup.classList.remove('hidden');
}

function initPropsPopup() {
  const popup = document.getElementById('props-popup');

  document.getElementById('pop-is-task').addEventListener('change', e => {
    if (State.propsIdx === null) return;
    const item = State.items[State.propsIdx];
    item.isTask = e.target.checked;
    if (item.isTask) {
      if (!item.status) { item.status = 'todo'; item.done = false; }
    } else {
      item.done = false; item.status = null; item.deadline = null; item.priority = null;
    }
    document.getElementById('pop-task-extra').classList.toggle('hidden', !item.isTask);
    document.getElementById('pop-status').value = item.status || 'todo';
    renderOutline(State.propsIdx);
    scheduleMapUpdate(); scheduleSave();
  });

  document.getElementById('pop-status').addEventListener('change', e => {
    if (State.propsIdx === null) return;
    const item = State.items[State.propsIdx];
    item.status = e.target.value;
    item.done   = isStatusDone(item.status);
    renderOutline(State.propsIdx);
    scheduleMapUpdate(); scheduleSave();
    if (State.currentView === 'tasks') renderTaskList();
  });

  document.getElementById('pop-deadline').addEventListener('change', e => {
    if (State.propsIdx === null) return;
    State.items[State.propsIdx].deadline = e.target.value || null;
    renderOutline(State.propsIdx);
    scheduleMapUpdate(); scheduleSave();
  });

  document.querySelectorAll('.pri-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.propsIdx === null) return;
      const p = btn.dataset.p || null;
      State.items[State.propsIdx].priority = p;
      document.querySelectorAll('.pri-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.p === (p || '')));
      renderOutline(State.propsIdx);
      scheduleMapUpdate(); scheduleSave();
    });
  });

  document.querySelectorAll('.marker-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.propsIdx === null) return;
      const color = btn.dataset.color || null;
      State.items[State.propsIdx].markerColor = color;
      document.querySelectorAll('.marker-color-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.color === (color || '')));
      renderOutline(State.propsIdx);
      if (State.currentView === 'tasks') renderTaskList();
      scheduleSave();
    });
  });

  document.querySelectorAll('.marker-stamp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.propsIdx === null) return;
      const stamp = btn.dataset.stamp || null;
      State.items[State.propsIdx].markerStamp = stamp;
      document.querySelectorAll('.marker-stamp-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stamp === (stamp || '')));
      renderOutline(State.propsIdx);
      if (State.currentView === 'tasks') renderTaskList();
      scheduleSave();
    });
  });

  // 担当プリセットボタン
  document.querySelectorAll('.assignee-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (State.propsIdx === null) return;
      const v = btn.dataset.v;
      State.items[State.propsIdx].assignee = v;
      document.getElementById('pop-assignee').value = v;
      document.querySelectorAll('.assignee-preset-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.v === v));
      renderOutline(State.propsIdx);
      scheduleSave();
      if (State.currentView === 'tasks') renderTaskList();
    });
  });

  // 担当テキスト入力
  document.getElementById('pop-assignee').addEventListener('input', e => {
    if (State.propsIdx === null) return;
    const v = e.target.value;
    State.items[State.propsIdx].assignee = v;
    document.querySelectorAll('.assignee-preset-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.v === v));
    renderOutline(State.propsIdx);
    scheduleSave();
    if (State.currentView === 'tasks') renderTaskList();
  });

  document.addEventListener('click', e => {
    if (!popup.classList.contains('hidden') &&
        !popup.contains(e.target) &&
        !e.target.classList.contains('item-props-btn')) {
      popup.classList.add('hidden');
    }
  });
}

// ===== タスクリスト操作（インライン編集） =====

function setTaskStatus(itemId, newStatus) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  item.status = newStatus;
  item.done   = isStatusDone(newStatus);
  renderOutline();
  scheduleMapUpdate(); scheduleSave();
  renderTaskList();
}

function setTaskAssignee(itemId, assignee) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  item.assignee = (assignee || '').trim();
  renderOutline();
  scheduleSave();
  if (State.currentView === 'tasks') renderTaskList();
}

function promptTaskAssignee(itemId) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  const cur = item.assignee || '';
  const v = prompt('担当者名（空欄で未設定、「自分」で自分担当）:', cur);
  if (v === null) return;
  setTaskAssignee(itemId, v);
}

function setTaskPriority(itemId, newPriority) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  item.priority = newPriority || null;
  renderOutline();
  scheduleMapUpdate(); scheduleSave();
  renderTaskList();
}

function setTaskDeadline(itemId, newDeadline) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  item.deadline = newDeadline || null;
  renderOutline();
  scheduleMapUpdate(); scheduleSave();
  renderTaskList();
}

function toggleSortBy(sortKey) {
  if (State.taskSort === sortKey) {
    State.taskSortDir = State.taskSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    State.taskSort = sortKey;
    State.taskSortDir = 'asc';
  }
  const SORT_LABELS = { priority: '優先度', deadline: '期限', status: 'ステータス', assignee: '担当' };
  document.querySelectorAll('.sort-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === sortKey);
    if (b.dataset.sort === sortKey) {
      b.textContent = SORT_LABELS[sortKey] + (State.taskSortDir === 'asc' ? ' ↑' : ' ↓');
    } else {
      b.textContent = SORT_LABELS[b.dataset.sort] || b.dataset.sort;
    }
  });
  renderTaskList();
}

// ===== 完了非表示トグル =====

function toggleHideCompleted() {
  State.hideCompleted = !State.hideCompleted;
  document.getElementById('outline-editor')
    .classList.toggle('hide-completed', State.hideCompleted);
  const btn = document.getElementById('btn-hide-completed');
  btn.textContent = State.hideCompleted ? '完了を表示' : '完了を非表示';
  btn.classList.toggle('active', State.hideCompleted);
}

// ===== エクスポート =====

function exportMarkdown() {
  const title = State.items.length > 0 ? (State.items[0].text || '無題') : '無題';
  const date  = new Date().toISOString().slice(0, 10);
  const PRI_LABEL = { high: '高', mid: '中', low: '低' };
  let md = '';
  for (const item of State.items) {
    const indent = '  '.repeat(Math.max(0, item.level - 1));
    if (!item.isTask) {
      if (item.level === 0)      md += `# ${item.text}\n\n`;
      else if (item.level === 1) md += `\n## ${item.text}\n\n`;
      else                       md += `${indent}- ${item.text}\n`;
    } else {
      const status  = normalizeStatus(item);
      const isDone  = status === 'done' || status === 'cancelled';
      const check   = isDone ? '[x]' : '[ ]';
      const meta    = [];
      if (status && status !== (State.statusConfig[0]?.key || 'todo')) meta.push(getStatusLabel(status));
      if (item.priority)                meta.push(`優先度:${PRI_LABEL[item.priority]}`);
      if (item.deadline)                meta.push(`期限:${item.deadline}`);
      const metaStr = meta.length ? `  _(${meta.join(' / ')})_` : '';
      md += `${indent}- ${check} ${item.text}${metaStr}\n`;
    }
  }
  downloadBlob(md, `${title}_${date}.md`, 'text/markdown');
}

function exportCSV() {
  const title = State.items.length > 0 ? (State.items[0].text || '無題') : '無題';
  const date  = new Date().toISOString().slice(0, 10);
  const PRI_LABEL = { high: '高', mid: '中', low: '低' };
  const header = ['テキスト', 'ステータス', '優先度', '期限', 'セクション'];
  const tasks  = State.items
    .map((item, idx) => ({ ...item, _idx: idx }))
    .filter(item => item.isTask);

  const rows = tasks.map(item => {
    const status  = normalizeStatus(item);
    let section = '';
    for (let i = item._idx - 1; i >= 0; i--) {
      if (State.items[i].level < item.level && !State.items[i].isTask) {
        section = State.items[i].text; break;
      }
    }
    return [
      item.text,
      getStatusLabel(status),
      PRI_LABEL[item.priority] || '',
      item.deadline || '',
      section,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const bom = '\uFEFF'; // Excel文字化け防止
  downloadBlob(bom + [header.join(','), ...rows].join('\n'),
    `${title}_tasks_${date}.csv`, 'text/csv');
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ===== items → ツリー変換 =====

function itemsToTree(items) {
  const root = { id: '__root__', text: 'Root', level: -1, children: [], isTask: false };
  const stack = [root];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
    const node = { ...item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

function getVisualRoot(tree) {
  if (tree.children.length === 0) {
    return { id: 'ph', text: '(左にアイテムを入力してください)', level: 0, children: [], isTask: false, x: 0, y: 0 };
  }
  if (tree.children.length === 1) return tree.children[0];
  return tree;
}

// ===== ツリーレイアウト（左右展開） =====

const NODE_W = 152, NODE_H = 36, H_GAP = 210;

function countLeaves(node) {
  if (!node.children.length) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function subtreeH(node) {
  if (!node.children.length) return NODE_H + 18;
  return node.children.reduce((s, c) => s + subtreeH(c), 0);
}

// 左右均等に展開するマインドマップ型レイアウト
function layoutBiTree(root, centerY) {
  root.x = 0; root.y = centerY; root._side = 'root';
  if (!root.children.length) return;

  const children = root.children;
  const totalLeaves = children.reduce((s, c) => s + countLeaves(c), 0);

  // 葉の数で左右を均等分割（前半→右、後半→左）
  const rightChildren = [], leftChildren = [];
  let rightLeaves = 0;
  for (const child of children) {
    if (rightLeaves < totalLeaves / 2) {
      rightChildren.push(child);
      rightLeaves += countLeaves(child);
    } else {
      leftChildren.push(child);
    }
  }
  // 子が1つのときは右側に
  if (children.length >= 2 && rightChildren.length === 0) rightChildren.push(leftChildren.shift());
  if (children.length >= 2 && leftChildren.length === 0)  leftChildren.push(rightChildren.pop());

  function assignSubtree(node, x, y, dir) {
    node.x = x; node.y = y; node._side = dir > 0 ? 'right' : 'left';
    if (!node.children.length) return;
    const total = node.children.reduce((s, c) => s + subtreeH(c), 0);
    let cy = y - total / 2;
    for (const c of node.children) {
      const h = subtreeH(c);
      assignSubtree(c, x + dir * H_GAP, cy + h / 2, dir);
      cy += h;
    }
  }

  // 右側
  const rightTotal = rightChildren.reduce((s, c) => s + subtreeH(c), 0);
  let rcy = centerY - rightTotal / 2;
  for (const child of rightChildren) {
    const h = subtreeH(child);
    assignSubtree(child, H_GAP, rcy + h / 2, 1);
    rcy += h;
  }

  // 左側
  const leftTotal = leftChildren.reduce((s, c) => s + subtreeH(c), 0);
  let lcy = centerY - leftTotal / 2;
  for (const child of leftChildren) {
    const h = subtreeH(child);
    assignSubtree(child, -H_GAP, lcy + h / 2, -1);
    lcy += h;
  }
}

// ===== SVG レンダリング =====

function nodeClass(node) {
  const status = normalizeStatus(node);
  if (node.level === 0) return 'node-root';
  if (node.level === 1) return 'node-section';
  if (node.isTask) {
    if (status === 'done' || node.done) return 'node-done';
    if (status === 'in_progress') return 'node-inprogress';
    const today = new Date().toISOString().slice(0, 10);
    if (node.deadline && node.deadline < today) return 'node-overdue';
    return 'node-task';
  }
  return 'node-normal';
}

function trunc(text, max) { return (text || '').length > max ? text.slice(0, max - 1) + '…' : (text || ''); }
function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

function drawMap() {
  const edgesLayer = document.getElementById('edges-layer');
  const nodesLayer = document.getElementById('nodes-layer');
  edgesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';
  if (!State._vRoot) return;

  function visit(node, parent) {
    if (parent) {
      const path = svgEl('path');
      {
        // 左右展開ツリー: node._side で接続方向を決定
        const isLeft = node._side === 'left';
        const x1 = isLeft ? parent.x - NODE_W / 2 : parent.x + NODE_W / 2;
        const x2 = isLeft ? node.x   + NODE_W / 2 : node.x   - NODE_W / 2;
        const mx = (x1 + x2) / 2;
        path.setAttribute('d', `M${x1},${parent.y} C${mx},${parent.y} ${mx},${node.y} ${x2},${node.y}`);
      }
      path.setAttribute('class', 'edge-line');
      if (node.isTask) path.setAttribute('stroke', (node.done || node.status === 'done') ? '#86EFAC' : '#FDBA74');
      edgesLayer.appendChild(path);
    }

    const g = svgEl('g');
    g.setAttribute('class', `node-group ${nodeClass(node)}`);
    g.setAttribute('data-id', node.id);
    g.setAttribute('transform', `translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`);

    const rect = svgEl('rect');
    rect.setAttribute('class', 'node-rect');
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    g.appendChild(rect);

    if (node.isTask) {
      const cb = svgEl('text');
      cb.setAttribute('x', '11'); cb.setAttribute('y', NODE_H / 2);
      cb.setAttribute('class', 'node-badge'); cb.setAttribute('dominant-baseline', 'middle');
      cb.textContent = (node.done || node.status === 'done') ? '✓' : '○';
      g.appendChild(cb);
    }

    if (node.isTask && !(node.done || node.status === 'done') && node.priority) {
      const dot = svgEl('circle');
      dot.setAttribute('cx', NODE_W - 9); dot.setAttribute('cy', NODE_H / 2); dot.setAttribute('r', '4');
      dot.setAttribute('fill', node.priority === 'high' ? '#EF4444' : node.priority === 'mid' ? '#F59E0B' : '#10B981');
      g.appendChild(dot);
    }

    const text = svgEl('text');
    text.setAttribute('x', node.isTask ? NODE_W / 2 + 6 : NODE_W / 2);
    text.setAttribute('y', NODE_H / 2);
    text.setAttribute('class', 'node-label');
    text.textContent = trunc(node.text, node.isTask ? 11 : 13);
    g.appendChild(text);

    // マウス: ドラッグ判定（クリックとドラッグを区別）
    g.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      startNodeDrag(e, node.id);
    });

    // タッチ: ダブルタップでフォーカス、シングルでドラッグ開始
    let lastTap = 0;
    g.addEventListener('touchstart', e => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastTap < 300) { e.preventDefault(); focusItemById(node.id); }
      lastTap = now;
    }, { passive: true });
    g.addEventListener('touchend', e => {
      e.preventDefault();
    });

    nodesLayer.appendChild(g);
    for (const child of node.children) visit(child, node);
  }

  visit(State._vRoot, null);
}

function refreshMap() {
  const tree  = itemsToTree(State.items);
  const vRoot = getVisualRoot(tree);
  State._vRoot = vRoot;
  const svg = document.getElementById('mindmap-canvas');
  layoutBiTree(vRoot, (svg.clientHeight || 600) / 2);
  drawMap();
  if (State.currentView === 'tasks') renderTaskList();
}

function focusItemById(itemId) {
  const idx = State.items.findIndex(it => it.id === itemId);
  if (idx === -1) return;
  if (window.innerWidth <= 768) switchMobilePanel('editor');
  const inputs = document.querySelectorAll('#outline-editor .item-input');
  if (inputs[idx]) {
    inputs[idx].focus();
    inputs[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function updateWorldTransform() {
  document.getElementById('world')
    .setAttribute('transform', `translate(${State.panX},${State.panY}) scale(${State.scale})`);
}

// ===== パン（マップ移動） =====

function initPan() {
  const svg = document.getElementById('mindmap-canvas');

  svg.addEventListener('mousedown', e => {
    if (e.target.closest('.node-group')) return;
    State.isPanning = true;
    State._panSX = e.clientX; State._panSY = e.clientY;
    State._panOX = State.panX; State._panOY = State.panY;
    svg.classList.add('is-panning');
  });
  window.addEventListener('mousemove', e => {
    if (!State.isPanning) return;
    State.panX = State._panOX + (e.clientX - State._panSX);
    State.panY = State._panOY + (e.clientY - State._panSY);
    updateWorldTransform();
  });
  window.addEventListener('mouseup', () => {
    State.isPanning = false;
    svg.classList.remove('is-panning');
  });

  // ===== ホイール: ピンチズーム + 2本指パン =====
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (e.ctrlKey) {
      // ピンチ操作（trackpad pinch / Ctrl+scroll）
      const factor = e.deltaY > 0 ? 0.92 : 1.09;
      const ns = Math.max(0.2, Math.min(4, State.scale * factor));
      State.panX = cx - (cx - State.panX) * ns / State.scale;
      State.panY = cy - (cy - State.panY) * ns / State.scale;
      State.scale = ns;
    } else {
      // 2本指スクロールでパン
      State.panX -= e.deltaX;
      State.panY -= e.deltaY;
    }
    updateWorldTransform();
  }, { passive: false });

  // ===== タッチ: 1本指パン + 2本指ピンチ =====
  let _pt = null; // 1本指パン用
  let _pinchDist = null;

  svg.addEventListener('touchstart', e => {
    if (e.target.closest('.node-group')) return;
    if (e.touches.length === 1) {
      _pt = { sx: e.touches[0].clientX, sy: e.touches[0].clientY,
               ox: State.panX, oy: State.panY };
      _pinchDist = null;
    } else if (e.touches.length === 2) {
      _pt = null;
      _pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  svg.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && _pt) {
      State.panX = _pt.ox + (e.touches[0].clientX - _pt.sx);
      State.panY = _pt.oy + (e.touches[0].clientY - _pt.sy);
      updateWorldTransform();
    } else if (e.touches.length === 2 && _pinchDist !== null) {
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const rect = svg.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const factor = newDist / _pinchDist;
      const ns = Math.max(0.2, Math.min(4, State.scale * factor));
      State.panX = cx - (cx - State.panX) * ns / State.scale;
      State.panY = cy - (cy - State.panY) * ns / State.scale;
      State.scale = ns;
      _pinchDist = newDist;
      updateWorldTransform();
    }
  }, { passive: false });

  svg.addEventListener('touchend', e => {
    if (e.touches.length < 2) _pinchDist = null;
    if (e.touches.length === 0) _pt = null;
  }, { passive: true });

  svg.addEventListener('click', () => {
    document.getElementById('props-popup').classList.add('hidden');
  });
}


// ===== ステータス管理モーダル =====

function openStatusModal() {
  syncStatusOptions();
  renderStatusList();
  document.getElementById('status-modal-overlay').classList.remove('hidden');
}

function closeStatusModal() {
  document.getElementById('status-modal-overlay').classList.add('hidden');
  syncStatusOptions();
  renderOutline();
  if (State.currentView === 'tasks') renderTaskList();
}

function renderStatusList() {
  const container = document.getElementById('status-item-list');
  container.innerHTML = State.statusConfig.map((s, i) => `
    <div class="status-item" data-idx="${i}">
      <div class="status-item-left">
        <span class="status-item-sample" style="background:${s.bg};color:${s.fg}">${esc(s.label)}</span>
        <input type="text" class="status-item-label" value="${esc(s.label)}" data-idx="${i}" placeholder="ラベル名">
        <label class="status-item-done-label" title="完了扱いにするとフィルターの「未完了のみ」から除外されます">
          <input type="checkbox" class="status-item-done" data-idx="${i}" ${s.isDone ? 'checked' : ''}>
          <span>完了扱い</span>
        </label>
      </div>
      <div class="status-item-right">
        <button class="status-order-btn" data-idx="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''} title="上へ">↑</button>
        <button class="status-order-btn" data-idx="${i}" data-dir="down" ${i === State.statusConfig.length - 1 ? 'disabled' : ''} title="下へ">↓</button>
        <button class="status-delete-btn" data-idx="${i}" title="削除">✕</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.status-item-label').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx);
      State.statusConfig[idx].label = e.target.value;
      const sample = e.target.closest('.status-item').querySelector('.status-item-sample');
      if (sample) sample.textContent = e.target.value;
      saveStatusConfig();
    });
  });

  container.querySelectorAll('.status-item-done').forEach(cb => {
    cb.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx);
      State.statusConfig[idx].isDone = e.target.checked;
      saveStatusConfig();
    });
  });

  container.querySelectorAll('.status-order-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const dir = btn.dataset.dir;
      if (dir === 'up' && idx > 0) {
        [State.statusConfig[idx], State.statusConfig[idx-1]] =
          [State.statusConfig[idx-1], State.statusConfig[idx]];
      } else if (dir === 'down' && idx < State.statusConfig.length - 1) {
        [State.statusConfig[idx], State.statusConfig[idx+1]] =
          [State.statusConfig[idx+1], State.statusConfig[idx]];
      }
      saveStatusConfig();
      renderStatusList();
    });
  });

  container.querySelectorAll('.status-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (State.statusConfig.length <= 1) return;
      State.statusConfig.splice(idx, 1);
      saveStatusConfig();
      renderStatusList();
    });
  });
}

function initStatusModal() {
  document.getElementById('status-modal-close').addEventListener('click', closeStatusModal);
  document.getElementById('status-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('status-modal-overlay')) closeStatusModal();
  });
  document.getElementById('btn-add-status').addEventListener('click', () => {
    const colorIdx = State.statusConfig.length % NEW_STATUS_COLORS.length;
    const color = NEW_STATUS_COLORS[colorIdx];
    State.statusConfig.push({
      key: `custom_${Date.now()}`,
      label: '新しいステータス',
      bg: color.bg,
      fg: color.fg,
      isDone: false,
    });
    saveStatusConfig();
    renderStatusList();
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll('.status-item-label');
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    });
  });
  document.getElementById('btn-status-settings').addEventListener('click', openStatusModal);
}


function resetMapView() {
  const svg = document.getElementById('mindmap-canvas');
  State.scale = 1;
  State.panX = (svg.clientWidth  || 900) / 2;
  State.panY = (svg.clientHeight || 600) / 2;
  updateWorldTransform();
}

// ===== ノードドラッグ（親子関係の組み替え） =====

const _drag = {
  active: false, nodeId: null,
  startX: 0, startY: 0, moved: false,
  ghostEl: null, dropTargetId: null,
};

function startNodeDrag(e, nodeId) {
  _drag.active    = true;
  _drag.nodeId    = nodeId;
  _drag.startX    = e.clientX;
  _drag.startY    = e.clientY;
  _drag.moved     = false;
  _drag.dropTargetId = null;
  _drag.ghostEl   = null;
}

function cleanupDrag() {
  if (_drag.ghostEl) { _drag.ghostEl.remove(); _drag.ghostEl = null; }
  const orig = document.querySelector(`[data-id="${_drag.nodeId}"]`);
  if (orig) orig.style.opacity = '';
  if (_drag.dropTargetId) {
    document.querySelector(`[data-id="${_drag.dropTargetId}"]`)
      ?.classList.remove('drop-target');
  }
  _drag.active = _drag.moved = false;
  _drag.nodeId = _drag.dropTargetId = null;
}

function reparentNode(dragId, targetId) {
  const items = State.items;
  const dragIdx = items.findIndex(i => i.id === dragId);
  const targetIdx = items.findIndex(i => i.id === targetId);
  if (dragIdx === -1 || targetIdx === -1 || dragIdx === targetIdx) return;

  // 子孫にはドロップ不可
  const dragLevel = items[dragIdx].level;
  let endIdx = dragIdx + 1;
  while (endIdx < items.length && items[endIdx].level > dragLevel) endIdx++;
  if (targetIdx > dragIdx && targetIdx < endIdx) return;

  // サブツリーを切り出し
  const subtree = items.splice(dragIdx, endIdx - dragIdx);

  // ターゲットの位置（splice後に再検索）
  const newTargetIdx = items.findIndex(i => i.id === targetId);
  const targetLevel  = items[newTargetIdx].level;

  // ターゲットのサブツリー末尾を探す
  let insertIdx = newTargetIdx + 1;
  while (insertIdx < items.length && items[insertIdx].level > targetLevel) insertIdx++;

  // レベル調整して挿入
  const levelDiff = (targetLevel + 1) - subtree[0].level;
  subtree.forEach(item => item.level = Math.max(0, item.level + levelDiff));
  items.splice(insertIdx, 0, ...subtree);

  renderOutline();
  scheduleMapUpdate();
  scheduleSave();
}

function initMapDrag() {
  window.addEventListener('mousemove', e => {
    if (!_drag.active) return;
    const dx = e.clientX - _drag.startX;
    const dy = e.clientY - _drag.startY;
    if (!_drag.moved && Math.hypot(dx, dy) < 8) return;
    _drag.moved = true;

    // ゴースト生成
    if (!_drag.ghostEl) {
      const item = State.items.find(i => i.id === _drag.nodeId);
      _drag.ghostEl = document.createElement('div');
      _drag.ghostEl.className = 'map-drag-ghost';
      _drag.ghostEl.textContent = item?.text || '';
      document.body.appendChild(_drag.ghostEl);
      const orig = document.querySelector(`[data-id="${_drag.nodeId}"]`);
      if (orig) orig.style.opacity = '0.3';
    }
    _drag.ghostEl.style.left = (e.clientX + 14) + 'px';
    _drag.ghostEl.style.top  = (e.clientY +  6) + 'px';

    // ドロップターゲット検出
    _drag.ghostEl.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    _drag.ghostEl.style.visibility = '';
    const tg    = under?.closest('.node-group');
    const newId = (tg && tg.dataset.id && tg.dataset.id !== _drag.nodeId)
      ? tg.dataset.id : null;

    if (newId !== _drag.dropTargetId) {
      if (_drag.dropTargetId)
        document.querySelector(`[data-id="${_drag.dropTargetId}"]`)?.classList.remove('drop-target');
      _drag.dropTargetId = newId;
      if (_drag.dropTargetId)
        document.querySelector(`[data-id="${_drag.dropTargetId}"]`)?.classList.add('drop-target');
    }
  });

  window.addEventListener('mouseup', () => {
    if (!_drag.active) return;
    if (!_drag.moved) {
      focusItemById(_drag.nodeId);
    } else if (_drag.dropTargetId) {
      reparentNode(_drag.nodeId, _drag.dropTargetId);
    }
    cleanupDrag();
  });
}

// ===== アウトラインドラッグ＆ドロップ =====

const _outlineDrag = {
  active: false, startIdx: null, subtreeLen: null,
  ghostEl: null, indicatorEl: null, insertAtIdx: null,
  startY: 0, moved: false,
};

function reorderOutlineItem(startIdx, subtreeLen, insertAtIdx) {
  const items = State.items;
  const endIdx = startIdx + subtreeLen;
  if (insertAtIdx === startIdx || (insertAtIdx > startIdx && insertAtIdx <= endIdx)) return;
  const subtree = items.splice(startIdx, subtreeLen);
  const targetIdx = insertAtIdx > endIdx ? insertAtIdx - subtreeLen : insertAtIdx;
  items.splice(targetIdx, 0, ...subtree);
  renderOutline(targetIdx);
  scheduleMapUpdate();
  scheduleSave();
}

function initOutlineDrag() {
  const container = document.getElementById('outline-editor');

  container.addEventListener('mousedown', e => {
    const handle = e.target.closest('.item-drag-handle');
    if (!handle) return;
    e.preventDefault();
    const idx = parseInt(handle.dataset.idx);
    const level = State.items[idx].level;
    let end = idx + 1;
    while (end < State.items.length && State.items[end].level > level) end++;
    _outlineDrag.active = true;
    _outlineDrag.startIdx = idx;
    _outlineDrag.subtreeLen = end - idx;
    _outlineDrag.startY = e.clientY;
    _outlineDrag.moved = false;
    _outlineDrag.ghostEl = null;
    _outlineDrag.indicatorEl = null;
    _outlineDrag.insertAtIdx = null;
  });

  window.addEventListener('mousemove', e => {
    if (!_outlineDrag.active) return;
    if (!_outlineDrag.moved && Math.abs(e.clientY - _outlineDrag.startY) < 4) return;
    _outlineDrag.moved = true;

    if (!_outlineDrag.ghostEl) {
      const ghost = document.createElement('div');
      ghost.className = 'outline-drag-ghost';
      ghost.textContent = State.items[_outlineDrag.startIdx]?.text || '(空)';
      document.body.appendChild(ghost);
      _outlineDrag.ghostEl = ghost;
    }
    _outlineDrag.ghostEl.style.top  = (e.clientY + 10) + 'px';
    _outlineDrag.ghostEl.style.left = (e.clientX + 10) + 'px';

    const itemEls = container.querySelectorAll('.outline-item');
    let insertAtIdx = State.items.length;
    for (const el of itemEls) {
      const rect = el.getBoundingClientRect();
      const elIdx = parseInt(el.dataset.idx);
      if (e.clientY < rect.top + rect.height / 2) { insertAtIdx = elIdx; break; }
    }
    _outlineDrag.insertAtIdx = insertAtIdx;

    if (!_outlineDrag.indicatorEl) {
      const ind = document.createElement('div');
      ind.className = 'outline-drop-indicator';
      document.body.appendChild(ind);
      _outlineDrag.indicatorEl = ind;
    }
    const contRect = container.getBoundingClientRect();
    let indY;
    if (insertAtIdx < State.items.length) {
      const targetEl = container.querySelector(`.outline-item[data-idx="${insertAtIdx}"]`);
      if (targetEl) indY = targetEl.getBoundingClientRect().top;
    } else {
      const lastEl = itemEls[itemEls.length - 1];
      if (lastEl) indY = lastEl.getBoundingClientRect().bottom;
    }
    if (indY !== undefined) {
      _outlineDrag.indicatorEl.style.top   = (indY - 1) + 'px';
      _outlineDrag.indicatorEl.style.left  = contRect.left + 'px';
      _outlineDrag.indicatorEl.style.width = contRect.width + 'px';
    }
  });

  window.addEventListener('mouseup', () => {
    if (!_outlineDrag.active) return;
    if (_outlineDrag.moved && _outlineDrag.insertAtIdx !== null) {
      reorderOutlineItem(_outlineDrag.startIdx, _outlineDrag.subtreeLen, _outlineDrag.insertAtIdx);
    }
    if (_outlineDrag.ghostEl) { _outlineDrag.ghostEl.remove(); _outlineDrag.ghostEl = null; }
    if (_outlineDrag.indicatorEl) { _outlineDrag.indicatorEl.remove(); _outlineDrag.indicatorEl = null; }
    _outlineDrag.active = _outlineDrag.moved = false;
  });
}

// ===== 区切り線ドラッグ =====

function initResizableDivider() {
  const divider = document.getElementById('panel-divider');
  const panel   = document.getElementById('editor-panel');
  let dragging = false, startX = 0, startW = 0;

  divider.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(200, Math.min(startW + (e.clientX - startX), window.innerWidth - 300));
    panel.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.cursor = document.body.style.userSelect = '';
  });
}

// ===== タスクリスト =====

function renderTaskList() {
  const container    = document.getElementById('task-list-container');
  const filterStatus = document.getElementById('filter-status').value;
  const filterPri    = document.getElementById('filter-priority').value;
  const today        = new Date().toISOString().slice(0, 10);

  let tasks = State.items
    .map((item, idx) => ({ ...item, _origIdx: idx }))
    .filter(item => item.isTask);

  // 期間クイックフィルター
  const todayStr    = today;
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekEndStr  = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  if (State.quickFilter === 'today') {
    tasks = tasks.filter(t => t.deadline === todayStr);
  } else if (State.quickFilter === 'tomorrow') {
    tasks = tasks.filter(t => t.deadline && t.deadline <= tomorrowStr);
  } else if (State.quickFilter === 'week') {
    tasks = tasks.filter(t => t.deadline && t.deadline <= weekEndStr);
  } else if (State.quickFilter === 'overdue') {
    tasks = tasks.filter(t => !isStatusDone(normalizeStatus(t)) && t.deadline && t.deadline < todayStr);
  }

  // ステータスフィルター
  if (filterStatus === 'active') {
    tasks = tasks.filter(t => !isStatusDone(normalizeStatus(t)));
  } else if (filterStatus) {
    tasks = tasks.filter(t => normalizeStatus(t) === filterStatus);
  }

  // 優先度フィルター
  if (filterPri) tasks = tasks.filter(t => t.priority === filterPri);

  // 担当フィルター
  const filterAssignee = document.getElementById('filter-assignee').value;
  if (filterAssignee === 'self') {
    tasks = tasks.filter(t => t.assignee === '自分');
  } else if (filterAssignee === 'delegated') {
    tasks = tasks.filter(t => t.assignee && t.assignee !== '自分');
  } else if (filterAssignee === 'none') {
    tasks = tasks.filter(t => !t.assignee);
  }

  // セクション名
  tasks = tasks.map(item => {
    let section = '';
    for (let i = item._origIdx - 1; i >= 0; i--) {
      if (State.items[i].level < item.level && !State.items[i].isTask) {
        section = State.items[i].text;
        break;
      }
    }
    return { ...item, section };
  });

  // ソート
  const PRI = { high: 0, mid: 1, low: 2 };
  tasks.sort((a, b) => {
    let cmp = 0;
    if (State.taskSort === 'priority') {
      const pa = PRI[a.priority] ?? 3, pb = PRI[b.priority] ?? 3;
      cmp = pa - pb;
      if (cmp === 0) {
        if (a.deadline && b.deadline) cmp = a.deadline.localeCompare(b.deadline);
        else cmp = a.deadline ? -1 : b.deadline ? 1 : 0;
      }
    } else if (State.taskSort === 'deadline') {
      if (a.deadline && b.deadline) cmp = a.deadline.localeCompare(b.deadline);
      else cmp = a.deadline ? -1 : b.deadline ? 1 : 0;
    } else if (State.taskSort === 'status') {
      cmp = getStatusOrder(normalizeStatus(a)) - getStatusOrder(normalizeStatus(b));
    } else if (State.taskSort === 'assignee') {
      cmp = (a.assignee || '').localeCompare(b.assignee || '');
    }
    return State.taskSortDir === 'desc' ? -cmp : cmp;
  });

  if (!tasks.length) {
    container.innerHTML = '<p class="no-tasks">タスクがありません<br><small>アイテム横の <b>•••</b> から「タスクにする」を設定してください</small></p>';
    return;
  }

  container.innerHTML = tasks.map(t => {
    const status  = normalizeStatus(t);
    const overdue = !isStatusDone(status) && t.deadline && t.deadline < today;
    const isDone  = isStatusDone(status);
    const markerColorClass = t.markerColor ? `marker-${t.markerColor}` : '';
    const stampEl = t.markerStamp ? `<span class="task-stamp">${t.markerStamp}</span>` : '';
    const hasTaskNote = !!(t.note || (t.links && t.links.length > 0));
    const taskNoteBtn = `<button class="task-note-btn${hasTaskNote ? ' has-note' : ''}" data-id="${t.id}" onclick="openNoteDrawer('${t.id}'); event.stopPropagation();" title="メモ・リンク">📝</button>`;
    const assigneeEl = t.assignee
      ? `<span class="task-assignee-badge" onclick="promptTaskAssignee('${t.id}'); event.stopPropagation();" title="担当を変更">👤 ${esc(t.assignee)}</span>`
      : `<button class="task-assignee-add" onclick="promptTaskAssignee('${t.id}'); event.stopPropagation();">＋ 担当</button>`;

    const statusSel = `
      <select class="task-status-sel"
              style="${getStatusBadgeStyle(status)}"
              onchange="setTaskStatus('${t.id}', this.value)"
              onclick="event.stopPropagation()">
        ${State.statusConfig.map(s =>
          `<option value="${esc(s.key)}" ${status === s.key ? 'selected' : ''}>${esc(s.label)}</option>`
        ).join('')}
      </select>`;

    const priSel = `
      <select class="task-pri-sel"
              onchange="setTaskPriority('${t.id}', this.value)"
              onclick="event.stopPropagation()">
        <option value="" ${!t.priority ? 'selected' : ''}>優先度</option>
        <option value="high" ${t.priority==='high'?'selected':''}>🔴 高</option>
        <option value="mid"  ${t.priority==='mid' ?'selected':''}>🟡 中</option>
        <option value="low"  ${t.priority==='low' ?'selected':''}>🟢 低</option>
      </select>`;

    const dlInput = `
      <input type="date" class="task-dl-inp" value="${t.deadline || ''}"
             onchange="setTaskDeadline('${t.id}', this.value)"
             onclick="event.stopPropagation()">`;

    return `
      <div class="task-row ${overdue ? 'is-overdue' : ''} ${isDone ? 'is-done' : ''} ${markerColorClass}">
        <div class="task-row-left">
          ${statusSel}
          ${stampEl}
          <span class="task-row-text ${isDone ? 'done-text' : ''}"
                onclick="focusItemById('${t.id}')">${esc(t.text)}</span>
        </div>
        <div class="task-row-right">
          ${assigneeEl}
          ${taskNoteBtn}
          ${priSel}
          ${dlInput}
          ${t.section ? `<span class="task-section">📁 ${esc(t.section)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ===== カレンダービュー =====

function renderCalendarView() {
  const year  = State.calendarYear;
  const month = State.calendarMonth;
  const today = new Date().toISOString().slice(0, 10);
  const filterStatus   = document.getElementById('filter-status').value;
  const filterPri      = document.getElementById('filter-priority').value;
  const filterAssignee = document.getElementById('filter-assignee').value;

  // タスクを取得（フィルター適用）
  let tasks = State.items
    .map((item, idx) => ({ ...item, _origIdx: idx }))
    .filter(item => item.isTask);
  if (filterStatus === 'active') {
    tasks = tasks.filter(t => !isStatusDone(normalizeStatus(t)));
  } else if (filterStatus) {
    tasks = tasks.filter(t => normalizeStatus(t) === filterStatus);
  }
  if (filterPri) tasks = tasks.filter(t => t.priority === filterPri);
  if (filterAssignee === 'self') tasks = tasks.filter(t => t.assignee === '自分');
  else if (filterAssignee === 'delegated') tasks = tasks.filter(t => t.assignee && t.assignee !== '自分');
  else if (filterAssignee === 'none') tasks = tasks.filter(t => !t.assignee);

  // タイトル
  document.getElementById('cal-title').textContent =
    `${year}年 ${month + 1}月`;

  // カレンダーグリッド生成
  const firstDay = new Date(year, month, 1).getDay(); // 0=日
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = document.getElementById('calendar-grid');

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  let html = '<div class="cal-weekdays">' +
    weekdays.map((d, i) => `<div class="cal-wday ${i===0?'sun':i===6?'sat':''}">${d}</div>`).join('') +
    '</div><div class="cal-days">';

  // 前月の空白セル
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell cal-empty"></div>';
  }

  // 日付セル
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = (firstDay + d - 1) % 7;
    const isToday = dateStr === today;
    const isPast  = dateStr < today;
    const dayTasks = tasks.filter(t => t.deadline === dateStr);
    const hasOverdue = dayTasks.some(t => !isStatusDone(normalizeStatus(t)));

    let cellClass = 'cal-cell';
    if (isToday)  cellClass += ' cal-today';
    if (dow === 0) cellClass += ' cal-sun';
    if (dow === 6) cellClass += ' cal-sat';
    if (isPast && !isToday && hasOverdue) cellClass += ' cal-overdue-day';

    const taskItems = dayTasks.map(t => {
      const status = normalizeStatus(t);
      const isDone = isStatusDone(status);
      const overdue = !isDone && t.deadline && t.deadline < today;
      return `<div class="cal-task-chip ${isDone?'cal-chip-done':''} ${overdue?'cal-chip-overdue':''}"
                   onclick="focusItemById('${t.id}')" title="${esc(t.text)}">
        ${esc(t.text.length > 14 ? t.text.slice(0,13)+'…' : t.text)}
      </div>`;
    }).join('');

    html += `<div class="${cellClass}">
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-tasks">${taskItems}</div>
    </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;

  // 期限なしタスク
  const noDlTasks = tasks.filter(t => !t.deadline);
  const noDlList = document.getElementById('calendar-no-deadline-list');
  if (noDlTasks.length) {
    document.getElementById('calendar-no-deadline').style.display = '';
    noDlList.innerHTML = noDlTasks.map(t => {
      const status = normalizeStatus(t);
      const isDone = isStatusDone(status);
      return `<div class="cal-task-chip ${isDone?'cal-chip-done':''}"
                   onclick="focusItemById('${t.id}')" title="${esc(t.text)}">
        ${esc(t.text.length > 20 ? t.text.slice(0,19)+'…' : t.text)}
      </div>`;
    }).join('');
  } else {
    document.getElementById('calendar-no-deadline').style.display = 'none';
  }
}

function switchTaskSubView(sv) {
  State.taskSubView = sv;
  document.querySelectorAll('.subview-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.sv === sv));
  document.getElementById('task-list-container').classList.toggle('hidden', sv === 'calendar');
  document.getElementById('calendar-view').classList.toggle('hidden', sv === 'list');
  if (sv === 'list') renderTaskList();
  else renderCalendarView();
}

// ===== マップ / タスク 切り替え =====

function initViewToggle() {
  document.getElementById('btn-view-map').addEventListener('click', () => {
    State.currentView = 'map';
    document.getElementById('map-view').classList.remove('hidden');
    document.getElementById('task-view').classList.add('hidden');
    document.getElementById('btn-view-map').classList.add('active');
    document.getElementById('btn-view-tasks').classList.remove('active');
  });

  document.getElementById('btn-view-tasks').addEventListener('click', () => {
    State.currentView = 'tasks';
    document.getElementById('task-view').classList.remove('hidden');
    document.getElementById('map-view').classList.add('hidden');
    document.getElementById('btn-view-tasks').classList.add('active');
    document.getElementById('btn-view-map').classList.remove('active');
    if (State.taskSubView === 'list') renderTaskList();
    else renderCalendarView();
  });

  document.getElementById('filter-status').addEventListener('change', () => {
    if (State.taskSubView === 'list') renderTaskList(); else renderCalendarView();
  });
  document.getElementById('filter-priority').addEventListener('change', () => {
    if (State.taskSubView === 'list') renderTaskList(); else renderCalendarView();
  });
  document.getElementById('filter-assignee').addEventListener('change', () => {
    if (State.taskSubView === 'list') renderTaskList(); else renderCalendarView();
  });

  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSortBy(btn.dataset.sort));
  });

  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      State.quickFilter = btn.dataset.filter;
      document.querySelectorAll('.quick-filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === State.quickFilter));
      if (State.taskSubView === 'list') renderTaskList(); else renderCalendarView();
    });
  });

  // サブビュートグル
  document.querySelectorAll('.subview-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTaskSubView(btn.dataset.sv));
  });

  // カレンダーナビ
  document.getElementById('cal-prev').addEventListener('click', () => {
    State.calendarMonth--;
    if (State.calendarMonth < 0) { State.calendarMonth = 11; State.calendarYear--; }
    renderCalendarView();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    State.calendarMonth++;
    if (State.calendarMonth > 11) { State.calendarMonth = 0; State.calendarYear++; }
    renderCalendarView();
  });
}

// ===== ノートドロワー =====

function openNoteDrawer(itemId) {
  State.noteItemId = itemId;
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('note-drawer-title').textContent = item.text || '(無題)';
  document.getElementById('note-textarea').value = item.note || '';
  renderLinks();
  document.getElementById('note-drawer').classList.add('open');
}

function closeNoteDrawer() {
  document.getElementById('note-drawer').classList.remove('open');
  State.noteItemId = null;
}

function refreshNoteButtonState(itemId) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  const hasNote = !!(item.note || (item.links && item.links.length > 0));
  const idx = State.items.indexOf(item);
  const outlineBtn = document.querySelector(`.outline-item[data-idx="${idx}"] .item-note-btn`);
  if (outlineBtn) outlineBtn.classList.toggle('has-note', hasNote);
  document.querySelectorAll(`.task-note-btn[data-id="${itemId}"]`).forEach(b =>
    b.classList.toggle('has-note', hasNote));
}

function renderLinks() {
  if (!State.noteItemId) return;
  const item = State.items.find(i => i.id === State.noteItemId);
  if (!item) return;
  const links = item.links || [];
  const container = document.getElementById('links-list');

  if (!links.length) {
    container.innerHTML = '<p class="no-links">リンクがまだありません</p>';
    return;
  }

  container.innerHTML = links.map((link, i) => `
    <div class="link-row">
      <div class="link-preview">
        ${link.url
          ? `<a href="${esc(link.url)}" target="_blank" rel="noopener" class="link-anchor">${esc(link.label || link.url)}</a>`
          : '<span class="link-empty">URLを入力してください</span>'}
      </div>
      <div class="link-edit-row">
        <input class="link-label-inp" type="text" value="${esc(link.label)}" placeholder="表示名（省略可）" data-li="${i}">
        <input class="link-url-inp" type="url" value="${esc(link.url)}" placeholder="https://..." data-li="${i}">
        <button class="link-delete-btn" data-li="${i}" title="削除">✕</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.link-label-inp').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = parseInt(e.target.dataset.li);
      if (!item.links[i]) return;
      item.links[i].label = e.target.value;
      const anchor = e.target.closest('.link-row').querySelector('.link-anchor');
      if (anchor) anchor.textContent = e.target.value || item.links[i].url;
      scheduleSave();
    });
  });

  container.querySelectorAll('.link-url-inp').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = parseInt(e.target.dataset.li);
      if (!item.links[i]) return;
      item.links[i].url = e.target.value;
      scheduleSave();
    });
    inp.addEventListener('change', () => renderLinks());
  });

  container.querySelectorAll('.link-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.li);
      item.links.splice(i, 1);
      renderLinks();
      refreshNoteButtonState(State.noteItemId);
      scheduleSave();
    });
  });
}

function initNoteDrawer() {
  document.getElementById('note-drawer-close').addEventListener('click', closeNoteDrawer);

  document.getElementById('note-textarea').addEventListener('input', e => {
    if (!State.noteItemId) return;
    const item = State.items.find(i => i.id === State.noteItemId);
    if (!item) return;
    item.note = e.target.value;
    refreshNoteButtonState(State.noteItemId);
    scheduleSave();
  });

  document.getElementById('btn-add-link').addEventListener('click', () => {
    if (!State.noteItemId) return;
    const item = State.items.find(i => i.id === State.noteItemId);
    if (!item) return;
    if (!item.links) item.links = [];
    item.links.push({ url: '', label: '' });
    renderLinks();
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll('#links-list .link-url-inp');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    scheduleSave();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('note-drawer').classList.contains('open')) {
      closeNoteDrawer();
    }
  });
}

// ===== モバイルタブ =====

function initMobileTabs() {
  document.querySelectorAll('.mob-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMobilePanel(btn.dataset.panel));
  });
}

function switchMobilePanel(panel) {
  State.mobilePanel = panel;
  document.querySelectorAll('.mob-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.panel === panel));

  const editorPanel = document.getElementById('editor-panel');
  const viewPanel   = document.getElementById('view-panel');
  const mapView     = document.getElementById('map-view');
  const taskView    = document.getElementById('task-view');

  editorPanel.classList.toggle('mob-hidden', panel !== 'editor');
  viewPanel.classList.toggle('mob-hidden', panel === 'editor');

  if (panel === 'map') {
    mapView.classList.remove('hidden');
    taskView.classList.add('hidden');
  } else if (panel === 'tasks') {
    mapView.classList.add('hidden');
    taskView.classList.remove('hidden');
    renderTaskList();
  }
}

// ===== ドキュメント管理 =====

async function loadDocList() {
  const res  = await fetch('/api/docs');
  const docs = await res.json();

  const select = document.getElementById('doc-select');
  select.innerHTML = docs.map(d => `<option value="${d.id}">${esc(d.title)}</option>`).join('');
  if (docs.length > 0) await loadDoc(docs[0].id);
}

async function loadDoc(docId) {
  const res = await fetch(`/api/docs/${docId}`);
  const doc = await res.json();

  State.currentDocId = docId;
  State.items = (doc.items || []);
  State.items.forEach(item => {
    if (!item.id) item.id = genId();
    // 後方互換: done フラグ → status に移行
    if (item.isTask && !item.status) {
      item.status = item.done ? 'done' : 'todo';
    }
    // note/links マイグレーション
    if (item.note === undefined) item.note = '';
    if (!item.links) item.links = [];
    // assignee マイグレーション
    if (item.assignee === undefined) item.assignee = '';
  });

  document.getElementById('doc-select').value = docId;
  renderOutline(0);
  refreshMap();

  requestAnimationFrame(() => {
    const svg = document.getElementById('mindmap-canvas');
    State.panX = (svg.clientWidth  || 900) / 2;
    State.panY = (svg.clientHeight || 600) / 2;
    updateWorldTransform();
  });
}

async function saveCurrentDoc() {
  if (!State.currentDocId) return;
  const title = State.items.length > 0 ? (State.items[0].text || '無題') : '無題';

  await fetch(`/api/docs/${State.currentDocId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: State.items, title }),
  });

  document.getElementById('save-status').textContent = '保存済み';
  const opt = document.querySelector(`#doc-select option[value="${State.currentDocId}"]`);
  if (opt) opt.textContent = title;
}

async function createNewDoc() {
  const title = prompt('新しいドキュメントのタイトル：', '新しいドキュメント');
  if (!title) return;

  const res = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const doc = await res.json();

  const select = document.getElementById('doc-select');
  const opt = document.createElement('option');
  opt.value = doc.id; opt.textContent = doc.title;
  select.insertBefore(opt, select.firstChild);
  await loadDoc(doc.id);
}

// ===== 初期化 =====

document.addEventListener('DOMContentLoaded', () => {
  loadStatusConfig();
  syncStatusOptions();
  loadDocList();

  document.getElementById('doc-select').addEventListener('change', e => loadDoc(e.target.value));
  document.getElementById('btn-new-doc').addEventListener('click', createNewDoc);

  document.getElementById('btn-hide-completed').addEventListener('click', toggleHideCompleted);
  document.getElementById('btn-export-md').addEventListener('click', exportMarkdown);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

  document.getElementById('btn-map-reset').addEventListener('click', resetMapView);
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    State.scale = Math.min(4, State.scale * 1.2); updateWorldTransform();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    State.scale = Math.max(0.2, State.scale / 1.2); updateWorldTransform();
  });

  initOutlineEditor();
  initOutlineDrag();
  initNoteDrawer();
  initPropsPopup();
  initPan();
  initMapDrag();
  initResizableDivider();
  initMobileTabs();
  initViewToggle();
  initStatusModal();
});
