const $ = id => document.getElementById(id);
let state = null;
let selected = new Set();

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

const BASE = 'https://script.google.com/macros/s/AKfycbxx1yOQiqlL5SrnfeDIHo56u5qcVjjQleuWLOLTG3fCGmyUzlaK3mJIDeL7M7oCmxBfRQ/exec'; // Apps Script web app /exec URL (replace after deploy)
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
    b.className = 'quest-btn q-' + q.color;
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
const PLAYER_SPLIT = 12;
function openPlayerModal(q) {
  currentQ = q;
  selected.clear();
  const grid = $('player-grid');
  grid.innerHTML = '';
  const right = state.players.slice(0, PLAYER_SPLIT - 1);
  const left = state.players.slice(PLAYER_SPLIT - 1);
  const rows = Math.max(Math.ceil(left.length / 3), Math.ceil(right.length / 3));
  const cell = p => {
    const el = document.createElement('div');
    el.className = 'cell';
    if (!p) { el.style.visibility = 'hidden'; return el; }
    el.textContent = p.name;
    el.dataset.id = p.id;
    el.onclick = () => {
      const id = el.dataset.id;
      if (selected.has(id)) { selected.delete(id); el.classList.remove('selected'); }
      else { selected.add(id); el.classList.add('selected'); }
      $('sel-count').textContent = 'Đã chọn: ' + selected.size;
    };
    return el;
  };
  for (let r = 0; r < rows; r++) {
    grid.appendChild(cell(left[3 * r + 2]));   // col 1
    grid.appendChild(cell(left[3 * r + 1]));   // col 2
    grid.appendChild(cell(left[3 * r]));       // col 3
    grid.appendChild(cell(right[3 * r]));      // col 4
    grid.appendChild(cell(right[3 * r + 1]));  // col 5
    grid.appendChild(cell(right[3 * r + 2]));  // col 6
  }
  $('sel-count').textContent = 'Đã chọn: 0';
  $('modal-player').hidden = false;
}

async function confirmQuest(q) {
  if (!selected.size) return;
  $('modal-player').hidden = true;
  const before = state.giftTotal;
  state = await api('/api/quest/complete', 'POST', { questId: q.id, playerIds: [...selected] });
  const gained = state.giftTotal - before;
  render();
  setTimeout(() => showPtsFloat(gained), 1000);
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
