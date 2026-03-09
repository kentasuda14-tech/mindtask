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
  taskSort: 'priority',
  taskSortDir: 'asc',
};

// ===== 定数 =====

const STATUS_LABELS = {
  todo:        '未着手',
  in_progress: '進行中',
  on_hold:     '保留',
  consulting:  '要相談',
  done:        '完了',
  someday:     'いつかやる',
  cancelled:   'キャンセル',
};

const STATUS_ORDER = {
  in_progress: 0, todo: 1, on_hold: 2, consulting: 3, someday: 4, done: 5, cancelled: 6,
};

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
    const isDone  = isTask && (status === 'done' || status === 'cancelled');
    const isOverdue = isTask && !isDone && item.deadline && item.deadline < today;
    const indentW = item.level * INDENT_PX;

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
    const statusBadge = isTask && status && status !== 'todo'
      ? `<span class="item-status-badge status-${status}">${STATUS_LABELS[status] || status}</span>` : '';

    // モバイル用インデントボタン
    const indentBtns = `
      <div class="item-indent-btns">
        <button class="indent-btn" data-action="outdent" data-idx="${idx}" ${item.level === 0 ? 'disabled' : ''} title="インデントを戻す">←</button>
        <button class="indent-btn" data-action="indent" data-idx="${idx}" title="インデント">→</button>
      </div>`;

    return `
      <div class="outline-item ${isTask ? 'is-task' : ''} ${isDone ? 'is-done' : ''} ${isOverdue ? 'is-overdue' : ''}"
           data-idx="${idx}" data-level="${item.level}">
        <div class="item-indent" style="width:${indentW}px"></div>
        <button class="item-bullet ${bulletClass}" data-idx="${idx}"
                title="${isTask ? (isDone ? 'クリックで未完了に戻す' : 'クリックで完了') : ''}">${bulletChar}</button>
        <input class="item-input ${isDone ? 'done-text' : ''}" type="text"
               value="${esc(item.text)}" data-idx="${idx}"
               placeholder="${item.level === 0 ? 'タイトル' : 'アイテムを入力…'}">
        <div class="item-meta">${statusBadge}${priDot}${dlSpan}</div>
        ${indentBtns}
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
        isTask: false, done: false, status: null, deadline: null, priority: null,
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
      isTask: false, done: false, status: null, deadline: null, priority: null,
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
  document.getElementById('pop-status').value    = normalizeStatus(item) || 'todo';
  document.getElementById('pop-deadline').value  = item.deadline || '';
  document.querySelectorAll('.pri-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === (item.priority || '')));
  document.getElementById('pop-task-extra').classList.toggle('hidden', !item.isTask);

  const rect = btnEl.getBoundingClientRect();
  const popW = 230;
  const left = Math.max(4, Math.min(rect.right - popW, window.innerWidth - popW - 4));
  const top  = Math.min(rect.bottom + 4, window.innerHeight - 280);
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
    item.done   = item.status === 'done';
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
  item.done   = newStatus === 'done';
  renderOutline();
  scheduleMapUpdate(); scheduleSave();
  renderTaskList();
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
  document.querySelectorAll('.sort-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === sortKey);
    if (b.dataset.sort === sortKey) {
      b.textContent = { priority: '優先度', deadline: '期限', status: 'ステータス' }[sortKey]
        + (State.taskSortDir === 'asc' ? ' ↑' : ' ↓');
    } else {
      b.textContent = { priority: '優先度', deadline: '期限', status: 'ステータス' }[b.dataset.sort];
    }
  });
  renderTaskList();
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

// ===== ツリーレイアウト =====

const NODE_W = 152, NODE_H = 36, H_GAP = 205;

function subtreeH(node) {
  if (!node.children.length) return NODE_H + 18;
  return node.children.reduce((s, c) => s + subtreeH(c), 0);
}

function layoutTree(root, centerY) {
  function assign(node, x, y) {
    node.x = x; node.y = y;
    if (!node.children.length) return;
    const total = subtreeH(node);
    let cy = y - total / 2;
    for (const c of node.children) {
      const h = subtreeH(c);
      assign(c, x + H_GAP, cy + h / 2);
      cy += h;
    }
  }
  assign(root, 86, centerY);
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
      const x1 = parent.x + NODE_W / 2, y1 = parent.y;
      const x2 = node.x - NODE_W / 2,   y2 = node.y;
      const mx = (x1 + x2) / 2;
      path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
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

    g.addEventListener('click', e => { e.stopPropagation(); focusItemById(node.id); });

    let lastTap = 0;
    g.addEventListener('touchend', e => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastTap < 300) focusItemById(node.id);
      lastTap = now;
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
  layoutTree(vRoot, (svg.clientHeight || 600) / 2);
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
    .setAttribute('transform', `translate(${State.panX},${State.panY})`);
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

  svg.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.node-group')) return;
    State._panSX = e.touches[0].clientX; State._panSY = e.touches[0].clientY;
    State._panOX = State.panX; State._panOY = State.panY;
  }, { passive: true });

  svg.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    State.panX = State._panOX + (e.touches[0].clientX - State._panSX);
    State.panY = State._panOY + (e.touches[0].clientY - State._panSY);
    updateWorldTransform();
  }, { passive: false });

  svg.addEventListener('click', () => {
    document.getElementById('props-popup').classList.add('hidden');
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

  // ステータスフィルター
  if (filterStatus === 'active') {
    tasks = tasks.filter(t => {
      const s = normalizeStatus(t);
      return s !== 'done' && s !== 'cancelled';
    });
  } else if (filterStatus) {
    tasks = tasks.filter(t => normalizeStatus(t) === filterStatus);
  }

  // 優先度フィルター
  if (filterPri) tasks = tasks.filter(t => t.priority === filterPri);

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
      const sa = STATUS_ORDER[normalizeStatus(a)] ?? 7;
      const sb = STATUS_ORDER[normalizeStatus(b)] ?? 7;
      cmp = sa - sb;
    }
    return State.taskSortDir === 'desc' ? -cmp : cmp;
  });

  if (!tasks.length) {
    container.innerHTML = '<p class="no-tasks">タスクがありません<br><small>アイテム横の <b>•••</b> から「タスクにする」を設定してください</small></p>';
    return;
  }

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  container.innerHTML = tasks.map(t => {
    const status  = normalizeStatus(t);
    const overdue = status !== 'done' && status !== 'cancelled' && t.deadline && t.deadline < today;
    const isDone  = status === 'done' || status === 'cancelled';

    const statusSel = `
      <select class="task-status-sel status-sel-${status}"
              onchange="setTaskStatus('${t.id}', this.value)"
              onclick="event.stopPropagation()">
        ${Object.entries(STATUS_LABELS).map(([v, l]) =>
          `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`
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
      <div class="task-row ${overdue ? 'is-overdue' : ''} ${isDone ? 'is-done' : ''}">
        <div class="task-row-left">
          ${statusSel}
          <span class="task-row-text ${isDone ? 'done-text' : ''}"
                onclick="focusItemById('${t.id}')">${esc(t.text)}</span>
        </div>
        <div class="task-row-right">
          ${priSel}
          ${dlInput}
          ${t.section ? `<span class="task-section">📁 ${esc(t.section)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
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
    renderTaskList();
  });

  document.getElementById('filter-status').addEventListener('change', renderTaskList);
  document.getElementById('filter-priority').addEventListener('change', renderTaskList);

  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSortBy(btn.dataset.sort));
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
  });

  document.getElementById('doc-select').value = docId;
  renderOutline(0);
  refreshMap();

  requestAnimationFrame(() => {
    const svg = document.getElementById('mindmap-canvas');
    State.panX = 0;
    State.panY = (svg.clientHeight || 600) / 2 - (State._vRoot?.y || 300);
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
  loadDocList();

  document.getElementById('doc-select').addEventListener('change', e => loadDoc(e.target.value));
  document.getElementById('btn-new-doc').addEventListener('click', createNewDoc);

  initOutlineEditor();
  initPropsPopup();
  initPan();
  initResizableDivider();
  initMobileTabs();
  initViewToggle();
});
