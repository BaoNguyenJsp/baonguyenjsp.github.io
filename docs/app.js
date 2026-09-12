const $ = id => document.getElementById(id);
let state = null;
let selected = new Set();
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
  for (let i = 0; i < 100; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    cover.appendChild(c);
  }
}
buildCover();

const BASE = 'https://script.google.com/macros/s/AKfycby0ZpKNXKvBu0_L1Xk9zT0j0o6S36MBFawDQxdaDd_e9wLJ6flRMWdDUF8Jq0hVUoTSgA/exec'; // Apps Script web app /exec URL (replace after deploy)
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

let currentQ = null;
// Two-half player grid: right half (cols 4-6) = players 1..PLAYER_SPLIT-1 left-to-right,
// left half (cols 1-3) = players PLAYER_SPLIT..end right-to-left.
let draggedIndex = null;
let draggedGender = null;

function openPlayerModal(q) {
  currentQ = q;
  selected.clear();
  const grid = $('player-grid');
  grid.innerHTML = '';

  // Separate players by gender
  const males = state.players.filter(p => (p.gender || 'M').toUpperCase() === 'M');
  const females = state.players.filter(p => (p.gender || 'F').toUpperCase() === 'F');

  const rows = Math.max(Math.ceil(males.length / 4), Math.ceil(females.length / 4));

  // Helper cell generator with Drag & Drop listeners
  const cell = (p, list, index) => {
    const el = document.createElement('div');
    el.className = 'cell';
    
    if (!p) { 
      el.style.visibility = 'hidden'; 
      return el; 
    }

    el.textContent = p.name;
    el.dataset.id = p.id;
    el.draggable = true;

    // Toggle Selection
    el.onclick = () => {
      const id = el.dataset.id;
      if (selected.has(id)) { 
        selected.delete(id); 
        el.classList.remove('selected'); 
      } else { 
        selected.add(id); 
        el.classList.add('selected'); 
      }
      $('sel-count').textContent = 'Đã chọn: ' + selected.size;
    };

    // --- Drag and Drop Events ---
    el.addEventListener('dragstart', (e) => {
      draggedIndex = index;
      draggedGender = p.gender;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });

    el.addEventListener('dragover', (e) => {
      // Only allow dropping within the same gender side
      if (draggedGender === p.gender) {
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

      if (draggedIndex === null || draggedIndex === index || draggedGender !== p.gender) return;

      // Swap players inside the gender array
      const targetList = p.gender === 'M' ? males : females;
      const temp = targetList[draggedIndex];
      targetList[draggedIndex] = targetList[index];
      targetList[index] = temp;

      // Update global state players array to preserve new order
      state.players = [...females, ...males];
      renderModalGrid(males, females, rows);

      // Send the new ordered ID list to Apps Script without changing any ID values
      api('/api/admin/player/reorder', 'POST', {
        playerIds: state.players.map(p => p.id)
      });

      // Re-render modal grid with new order
      renderModalGrid(males, females, rows);
    });

    return el;
  };

  function renderModalGrid(mList, fList, totalRows) {
    grid.innerHTML = '';
    for (let r = 0; r < totalRows; r++) {
      // Left side (Males): Center out (Col 4 -> Col 1)
      grid.appendChild(cell(mList[4 * r + 3], mList, 4 * r + 3));
      grid.appendChild(cell(mList[4 * r + 2], mList, 4 * r + 2));
      grid.appendChild(cell(mList[4 * r + 1], mList, 4 * r + 1));
      grid.appendChild(cell(mList[4 * r],     mList, 4 * r));

      // Right side (Females): Center out (Col 5 -> Col 8)
      grid.appendChild(cell(fList[4 * r],     fList, 4 * r));
      grid.appendChild(cell(fList[4 * r + 1], fList, 4 * r + 1));
      grid.appendChild(cell(fList[4 * r + 2], fList, 4 * r + 2));
      grid.appendChild(cell(fList[4 * r + 3], fList, 4 * r + 3));
    }
  }

  renderModalGrid(males, females, rows);
  $('sel-count').textContent = 'Đã chọn: 0';
  $('modal-player').hidden = false;
}

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

loadState();
