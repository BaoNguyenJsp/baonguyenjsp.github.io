const $ = id => document.getElementById(id);
let state = null;
let selected = new Set();
let bonusSelected = new Set();
const Q_COLOR = { Normal: 'q-green', Medium: 'q-yellow', Hard: 'q-red', Weekly: 'q-green', Special: 'q-yellow', Once: 'q-red' };

// Spiral reveal: cell order = outside ring to inside, starting top-left going right.
const coverRank = new Map(spiralOrder(10).map((i, k) => [i, k]));

function spiralOrder(n) {
  const idx = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c));
  const order = [];
  let t = 0, b = n - 1, l = 0, r = n - 1;
  while (t <= b && l <= r) {
    for (let c = l; c <= r; c++) order.push(idx[t][c]); t++;
    for (let rr = t; rr <= b; rr++) order.push(idx[rr][r]); r--;
    if (t <= b) { for (let c = r; c >= l; c--) order.push(idx[b][c]); b--; }
    if (l <= r) { for (let rr = b; rr >= t; rr--) order.push(idx[rr][l]); l++; }
  }
  return order;
}

function buildCover() {
  const cover = $('gift-cover');
  cover.innerHTML = '';
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    cover.appendChild(c);
  }
}
buildCover();

const BASE = 'https://script.google.com/macros/s/AKfycbzswmZR7DUeth8R-lydWWKR90ITI5bQSImFBd3f3ohRDNGyZssTUayj7cXWbB1eK5fZDQ/exec'; 

async function api(url, method = 'GET', body) {
  const res = await fetch(BASE + '?p=' + encodeURIComponent(url.replace(/^\/api\//, '')), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function loadState() { state = await api('/api/state'); render(); }

function render() {
  const pct = state.giftPct;
  const cells = $('gift-cover').children;
  for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('off', coverRank.get(i) < pct);
  $('gift-pct').textContent = pct + '%';
  $('round-label').textContent = state.round ? `Tuần ${state.round}` : '';
  const active = state.roundActive;
  $('btn-start-round').hidden = active;
  $('quest-panel').hidden = !active;
  if (active) renderQuests(state.currentSet, state.roundDone);
}

function renderQuests(set, doneIds) {
  const done = new Set(doneIds);
  const box = $('quest-buttons');
  box.innerHTML = '';
  for (const q of set) {
    const b = document.createElement('button');
    b.className = 'quest-btn ' + (Q_COLOR[q.type] || 'q-gray');
    const isDone = done.has(q.id);
    if (isDone) b.classList.add('done');
    b.innerHTML = `<span class="q-name">${isDone ? '✓ ' : ''}${q.name}</span>`;
    b.onclick = () => openPlayerModal(q);
    box.appendChild(b);
  }
}

// ---- Drag & Drop Global State Tracking ----
let draggedIndex = null;
let draggedGender = null;
let currentQ = null;

/**
 * Builds the 8-Column Player Grid (4 Columns Left = Males, 4 Columns Right = Females)
 * Center-out arrangement:
 * Males: Col 4 (Middle-Left) -> Col 3 -> Col 2 -> Col 1 (Outer-Left)
 * Females: Col 5 (Middle-Right) -> Col 6 -> Col 7 -> Col 8 (Outer-Right)
 */
function buildGenderGrid(container, playersList, isBonusModal = false) {
  container.innerHTML = '';

  const males = playersList.filter(p => p && String(p.gender).toUpperCase() === 'M');
  const females = playersList.filter(p => p && String(p.gender).toUpperCase() === 'F');

  const rows = Math.max(Math.ceil(males.length / 4), Math.ceil(females.length / 4));

  const createCell = (p, list, index) => {
    const el = document.createElement('div');
    el.className = 'cell';
    
    if (!p) { 
      el.style.visibility = 'hidden'; 
      return el; 
    }

    el.textContent = p.name;
    el.dataset.id = String(p.id);

    const targetSet = isBonusModal ? bonusSelected : selected;
    if (targetSet.has(String(p.id))) {
      el.classList.add('selected');
    }

    // Toggle Selection
    el.onclick = () => {
      const id = String(p.id);
      if (targetSet.has(id)) {
        targetSet.delete(id);
        el.classList.remove('selected');
      } else {
        targetSet.add(id);
        el.classList.add('selected');
      }
      if (!isBonusModal) {
        $('sel-count').textContent = 'Đã chọn: ' + selected.size;
      }
    };

    // Enable Drag and Drop on Player Modal
    if (!isBonusModal) {
      el.draggable = true;

      el.addEventListener('dragstart', (e) => {
        draggedIndex = index;
        draggedGender = String(p.gender).toUpperCase();
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
      });

      el.addEventListener('dragover', (e) => {
        if (draggedGender === String(p.gender).toUpperCase()) {
          e.preventDefault();
          el.classList.add('drag-over');
        }
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');

        if (draggedIndex === null || draggedIndex === index || draggedGender !== String(p.gender).toUpperCase()) return;

        // Swap players in gender list
        const targetList = String(p.gender).toUpperCase() === 'M' ? males : females;
        const temp = targetList[draggedIndex];
        targetList[draggedIndex] = targetList[index];
        targetList[index] = temp;

        // Maintain global state order
        state.players = [...males, ...females];

        // Re-render grid instantly
        buildGenderGrid(container, state.players, false);

        // Save reordered list to backend
        api('/api/admin/player/reorder', 'POST', {
          playerIds: state.players.map(pl => pl.id)
        });
      });
    }

    return el;
  };

  for (let r = 0; r < rows; r++) {
    // Left side (Males / M): Middle out (Col 4 -> Col 3 -> Col 2 -> Col 1)
    container.appendChild(createCell(males[4 * r + 3], males, 4 * r + 3)); 
    container.appendChild(createCell(males[4 * r + 2], males, 4 * r + 2)); 
    container.appendChild(createCell(males[4 * r + 1], males, 4 * r + 1)); 
    container.appendChild(createCell(males[4 * r],     males, 4 * r));     

    // Right side (Females / F): Middle out (Col 5 -> Col 6 -> Col 7 -> Col 8)
    container.appendChild(createCell(females[4 * r],     females, 4 * r));     
    container.appendChild(createCell(females[4 * r + 1], females, 4 * r + 1)); 
    container.appendChild(createCell(females[4 * r + 2], females, 4 * r + 2)); 
    container.appendChild(createCell(females[4 * r + 3], females, 4 * r + 3)); 
  }
}

// Open Player Selection Modal for Quests
function openPlayerModal(q) {
  currentQ = q;
  selected.clear();
  buildGenderGrid($('player-grid'), state.players, false);
  $('sel-count').textContent = 'Đã chọn: 0';
  $('modal-player').hidden = false;
}

// Open Bonus Points Modal
function renderBonusPlayers() {
  buildGenderGrid($('b-players'), state.players, true);
}

$('btn-bonus').onclick = () => {
  $('b-points').value = '';
  $('b-reason').value = '';
  bonusSelected.clear();
  renderBonusPlayers();
  $('modal-bonus').hidden = false;
};

$('btn-close-bonus').onclick = () => { $('modal-bonus').hidden = true; };

$('b-all').onclick = () => {
  state.players.forEach(p => bonusSelected.add(String(p.id)));
  renderBonusPlayers();
};

$('b-none').onclick = () => {
  bonusSelected.clear();
  renderBonusPlayers();
};

$('bonus-form').onsubmit = async e => {
  e.preventDefault();
  const v = Number($('b-points').value);
  if (!v) return;
  const playerIds = [...bonusSelected];
  if (!playerIds.length) { alert('Chưa chọn người chơi nào'); return; }

  const before = state.giftTotal;
  state = await api('/api/points', 'POST', { playerIds, points: v, reason: $('b-reason').value.trim() || 'Thưởng điểm' });
  $('modal-bonus').hidden = true;
  render();
  
  const gained = state.giftTotal - before;
  if (gained > 0) showPtsFloat(gained);
};

async function confirmQuest(q) {
  $('modal-player').hidden = true;
  const before = state.giftTotal;
  state = await api('/api/quest/complete', 'POST', { questId: q.id, playerIds: [...selected] });
  const gained = state.giftTotal - before;
  render();
  if (gained) setTimeout(() => showPtsFloat(gained), 1000);
  if (state.roundEnded) {
    $('celebrate-title').textContent = `🎉 Hoàn thành tuần ${state.round}! 🎉`;
    $('celebrate-msg').textContent = state.encouragement;
    setTimeout(showCelebration, 1000);
  }
}

function showPtsFloat(n) {
  const el = $('pts-float');
  el.textContent = '+' + n + ' điểm';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function showCelebration() {
  $('modal-celebrate').hidden = false;
  confetti();
  setTimeout(async () => { $('modal-celebrate').hidden = true; await loadState(); }, 5000);
}

function confetti() {
  const layer = $('confetti-layer');
  layer.innerHTML = '';
  const colors = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#f472b6', '#c084fc'];
  for (let i = 0; i < 120; i++) {
    const d = document.createElement('div');
    d.className = 'confetto';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = (2 + Math.random() * 2) + 's';
    d.style.animationDelay = (Math.random() * .5) + 's';
    layer.appendChild(d);
  }
  setTimeout(() => { layer.innerHTML = ''; }, 5000);
}

async function showRanking() {
  const { ranking } = await api('/api/ranking');
  const medal = ['🥇', '🥈', '🥉'];
  const top = $('ranking-top-body');
  const rest = $('ranking-body');
  top.innerHTML = '';
  rest.innerHTML = '';
  ranking.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i < 3 ? medal[i] + ' ' : ''}${r.rank}</td><td>${r.name}</td><td>${r.points}</td>`;
    (i < 3 ? top : rest).appendChild(tr);
  });
  $('ranking-scroll-wrap').hidden = ranking.length <= 3;
  $('modal-ranking').hidden = false;
}

$('btn-start-round').onclick = async () => { state = await api('/api/round/start', 'POST'); render(); };
$('btn-confirm').onclick = () => confirmQuest(currentQ);
$('btn-ranking').onclick = showRanking;
$('btn-close-ranking').onclick = () => { $('modal-ranking').hidden = true; };

$('btn-close-player').onclick = () => {
  $('modal-player').hidden = true;
};

// Close Bonus Modal without API call
$('btn-close-bonus').onclick = () => {
  $('modal-bonus').hidden = true;
};
$('btn-close-bonus-x').onclick = () => {
  $('modal-bonus').hidden = true;
};

loadState();