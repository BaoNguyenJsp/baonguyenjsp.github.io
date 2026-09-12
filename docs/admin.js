const $ = id => document.getElementById(id);
let nextSet = [];

const TYPE_COLOR = { Normal: 'q-green', Medium: 'q-yellow', Hard: 'q-red' };
const TYPE_POINTS = { Normal: 2, Medium: 3, Hard: 5 };

const BASE = 'https://script.google.com/macros/s/AKfycbwauLUNRgCuCPYq-RyHwuGbLJ-JgeDGVF4o11iYj8-upL01IC-ihrF0vnBFVTPXD7OmBw/exec'; // Apps Script web app /exec URL (replace after deploy)
let ADMIN_KEY = sessionStorage.getItem('adminKey');
if (!ADMIN_KEY) { ADMIN_KEY = prompt('Nhập mã admin:') || ''; if (ADMIN_KEY) sessionStorage.setItem('adminKey', ADMIN_KEY); }
function route(url, body = {}) {
  let m;
  if ((m = url.match(/\/api\/admin\/players\/(\d+)\/points$/))) return { p: 'admin/player/points', body: { ...body, id: m[1] } };
  if ((m = url.match(/\/api\/admin\/players\/(\d+)$/))) return { p: 'admin/player/delete', body: { ...body, id: m[1] } };
  if ((m = url.match(/\/api\/admin\/quests\/(\d+)$/))) return { p: 'admin/quest/delete', body: { ...body, id: m[1] } };
  const p = url.replace(/^\/api\//, '');
  return { p: ({ 'admin/players': 'admin/player', 'admin/quests': 'admin/quest' })[p] || p, body };
}
async function api(url, method = 'GET', body) {
  const r = route(url, body);
  let res;
  try {
    res = await fetch(BASE + '?p=' + encodeURIComponent(r.p), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(r.p.startsWith('admin/') ? { ...r.body, key: ADMIN_KEY } : r.body),
    });
  } catch (e) {
    alert('Lỗi mạng: ' + e.message);
    throw e;
  }
  const data = await res.json();
  if (data && data.error) { alert('Lỗi: ' + data.error); throw new Error(data.error); }
  return data;
}

// ---- Tabs ----
const tabs = document.querySelectorAll('.tab');
const sections = { 'tab-quests': $('tab-quests'), 'tab-players': $('tab-players'), 'tab-points': $('tab-points'), 'tab-report': $('tab-report') };
tabs.forEach(t => t.onclick = () => {
  tabs.forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  for (const [k, s] of Object.entries(sections)) s.hidden = k !== t.dataset.tab;
});

document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { b.closest('.modal').hidden = true; });

// ---- Search & filter (client-side row hiding) ----
const SEARCH = [
  ['quest-tbody', 'quest-search'],
  ['player-tbody', 'player-search'],
  ['ledger-tbody', 'ledger-search'],
  ['report-tbody', 'report-search'],
];
function applyFilters() {
  const typeFilter = $('quest-type-filter').value;
  for (const [tbodyId, inputId] of SEARCH) {
    const tbody = $(tbodyId);
    const q = ($(inputId).value || '').trim().toLowerCase();
    for (const tr of tbody.children) {
      let show = !q || tr.textContent.toLowerCase().includes(q);
      if (show && tbodyId === 'quest-tbody' && typeFilter && tr.dataset.type !== typeFilter) show = false;
      tr.hidden = !show;
    }
  }
}
SEARCH.forEach(([, inputId]) => $(inputId).oninput = applyFilters);
$('quest-type-filter').onchange = applyFilters;

let allPlayers = [];
async function loadAll() {
  const [state, quests, players, points, report] = await Promise.all([
    api('/api/state'), api('/api/quests'), api('/api/players'), api('/api/points'), api('/api/report'),
  ]);
  nextSet = state.nextSet;
  allPlayers = players.players;
  renderQuests(quests.quests);
  renderNextSetCount();
  renderPlayers(players.players);
  renderLedger(points.points);
  renderReport(report.report);
  applyFilters();
}

// ---- Quests ----
function renderNextSetCount() {
  $('nextset-count').textContent = 'Đã chọn ' + nextSet.length + '/3';
}

function renderQuests(quests) {
  const tbody = $('quest-tbody');
  tbody.innerHTML = '';
  for (const q of quests) {
    const tr = document.createElement('tr');
    tr.dataset.type = q.type;
    const tdChk = document.createElement('td');
    tdChk.className = 'center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = nextSet.includes(String(q.id));
    cb.disabled = !cb.checked && nextSet.length >= 3;
    cb.title = cb.disabled ? 'Tối đa 3 nhiệm vụ' : '';
    cb.onchange = () => {
      nextSet = cb.checked ? [...nextSet, String(q.id)] : nextSet.filter(i => i !== String(q.id));
      renderQuests(quests);
      renderNextSetCount();
      applyFilters();
    };
    tdChk.appendChild(cb);
    const tdAct = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'btn small';
    edit.textContent = 'Sửa';
    edit.onclick = () => openQuestModal(q);
    const del = document.createElement('button');
    del.className = 'btn danger small';
    del.textContent = 'Xóa';
    del.onclick = async () => { if (confirm('Xóa nhiệm vụ "' + q.name + '"?')) { await api('/api/admin/quests/' + q.id, 'DELETE'); loadAll(); } };
    wrap.append(edit, del);
    tdAct.appendChild(wrap);
    tr.append(tdChk);
    tr.insertAdjacentHTML('beforeend',
      `<td>${q.name}</td><td><span class="tag ${TYPE_COLOR[q.type]}">${q.type}</span></td>` +
      `<td><b>${q.points}</b></td>`);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
}

function openQuestModal(q) {
  $('quest-modal-title').textContent = q ? '✏️ Sửa nhiệm vụ' : '➕ Thêm nhiệm vụ';
  $('q-name').value = q ? q.name : '';
  $('q-type').value = q ? q.type : 'Normal';
  $('q-points').value = q ? q.points : TYPE_POINTS[$('q-type').value];
  $('quest-form').dataset.id = q ? q.id : '';
  $('modal-quest').hidden = false;
}

function syncType() {
  $('q-points').value = TYPE_POINTS[$('q-type').value];
}
$('q-type').onchange = syncType;

$('quest-form').onsubmit = async e => {
  e.preventDefault();
  const body = {
    id: $('quest-form').dataset.id || null,
    name: $('q-name').value.trim(),
    type: $('q-type').value,
    points: $('q-points').value,
  };
  await api('/api/admin/quests', 'POST', body);
  $('modal-quest').hidden = true;
  loadAll();
};

$('btn-new-quest').onclick = () => openQuestModal(null);

// ---- Players ----
function renderPlayers(players) {
  const tbody = $('player-tbody');
  tbody.innerHTML = '';
  for (const p of players) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td>${p.gender || 'M'}</td><td><b>${p.points}</b></td>`;
    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = '+/-';
    input.className = 'small';
    const add = document.createElement('button');
    add.className = 'btn btn-plus small';
    add.textContent = '+';
    add.title = 'Cộng';
    add.onclick = async () => {
      const v = Number(input.value);
      if (!v) return;
      await api(`/api/admin/players/${p.id}/points`, 'POST', { points: v, reason: 'Admin: Điều chỉnh' });
      loadAll();
    };
    const tdAdj = document.createElement('td');
    const wrapAdj = document.createElement('div');
    wrapAdj.className = 'actions';
    wrapAdj.append(input, add);
    tdAdj.appendChild(wrapAdj);
    const tdDel = document.createElement('td');
    const wrapDel = document.createElement('div');
    wrapDel.className = 'actions';
    const del = document.createElement('button');
    del.className = 'btn danger small';
    del.textContent = 'Xóa';
    del.onclick = async () => { if (confirm('Xóa ' + p.name + '?')) { await api('/api/admin/players/' + p.id, 'DELETE'); loadAll(); } };
    wrapDel.appendChild(del);
    tdDel.appendChild(wrapDel);
    tr.appendChild(tdAdj);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  }
}

$('player-form').onsubmit = async e => {
  e.preventDefault();
  await api('/api/admin/players', 'POST', { 
    name: $('p-name').value.trim(),
    gender: $('p-gender').value
  });
  $('modal-player').hidden = true;
  loadAll();
};

$('btn-new-player').onclick = () => { 
  $('p-name').value = ''; 
  $('p-gender').value = 'M';
  $('modal-player').hidden = false; 
  $('p-name').focus(); 
};

// ---- Bulk bonus points (8-column center-out grid) ----
let bonusSelected = new Set();

function renderBonusPlayers() {
  const box = $('b-players');
  box.innerHTML = '';

  const males = allPlayers.filter(p => (p.gender || 'M').toUpperCase() === 'M');
  const females = allPlayers.filter(p => (p.gender || 'F').toUpperCase() === 'F');

  const rows = Math.max(Math.ceil(males.length / 4), Math.ceil(females.length / 4));

  const cell = p => {
    const el = document.createElement('div');
    el.className = 'cell';
    if (!p) { el.style.visibility = 'hidden'; return el; }

    el.textContent = `${p.name} (${p.points || 0})`;
    el.dataset.id = String(p.id);

    if (bonusSelected.has(String(p.id))) {
      el.classList.add('selected');
    }

    el.onclick = () => {
      const id = String(p.id);
      if (bonusSelected.has(id)) {
        bonusSelected.delete(id);
        el.classList.remove('selected');
      } else {
        bonusSelected.add(id);
        el.classList.add('selected');
      }
    };
    return el;
  };

  for (let r = 0; r < rows; r++) {
    // Left side (Males / M): Middle out (Col 4 -> Col 3 -> Col 2 -> Col 1)
    box.appendChild(cell(males[4 * r + 3])); // Col 1
    box.appendChild(cell(males[4 * r + 2])); // Col 2
    box.appendChild(cell(males[4 * r + 1])); // Col 3
    box.appendChild(cell(males[4 * r]));     // Col 4 (inner left)

    // Right side (Females / F): Middle out (Col 5 -> Col 6 -> Col 7 -> Col 8)
    box.appendChild(cell(females[4 * r]));     // Col 5 (inner right)
    box.appendChild(cell(females[4 * r + 1])); // Col 6
    box.appendChild(cell(females[4 * r + 2])); // Col 7
    box.appendChild(cell(females[4 * r + 3])); // Col 8
  }
}

$('b-all').onclick = () => {
  allPlayers.forEach(p => bonusSelected.add(String(p.id)));
  renderBonusPlayers();
};

$('b-none').onclick = () => {
  bonusSelected.clear();
  renderBonusPlayers();
};

$('btn-bonus').onclick = () => { 
  $('b-points').value = ''; 
  $('b-reason').value = ''; 
  bonusSelected.clear();
  renderBonusPlayers(); 
  $('modal-bonus').hidden = false; 
};

$('bonus-form').onsubmit = async e => {
  e.preventDefault();
  const v = Number($('b-points').value);
  if (!v) return;
  const playerIds = [...bonusSelected];
  if (!playerIds.length) { alert('Chưa chọn người chơi nào'); return; }
  await api('/api/admin/points', 'POST', { playerIds, points: v, reason: $('b-reason').value.trim() || 'Admin: Thưởng điểm' });
  $('modal-bonus').hidden = true;
  loadAll();
};

// ---- Ledger ----
function renderLedger(points) {
  const tbody = $('ledger-tbody');
  tbody.innerHTML = '';
  if (!points.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">Chưa có giao dịch nào.</td>';
    tbody.appendChild(tr);
    return;
  }
  for (const r of points) {
    const cls = Number(r.points) >= 0 ? 'pts-pos' : 'pts-neg';
    const sign = r.points > 0 ? '+' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.date}</td><td>${r.playerName}</td><td class="${cls}">${sign}${r.points}</td><td>${r.reason}</td>`;
    tbody.appendChild(tr);
  }
}

// ---- Report ----
function renderReport(r) {
  const stats = [
    ['👥', r.totals.players, 'Người chơi'],
    ['⭐', r.totals.totalPoints, 'Tổng điểm'],
    ['✅', r.totals.questsDone, 'Nhiệm vụ hoàn thành'],
    ['🎁', r.totals.giftPct + '%', 'Tiến độ quà'],
  ];
  $('report-stats').innerHTML = stats.map(([e, num, lbl]) =>
    `<div class="stat-card"><div class="num">${e} ${num}</div><div class="lbl">${lbl}</div></div>`).join('');
  const tbody = $('report-tbody');
  tbody.innerHTML = '';
  for (const p of r.players) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.rank}</td><td>${p.name}</td><td><b>${p.points}</b></td><td>${p.questsDone}</td><td>${p.avg}</td>`;
    tbody.appendChild(tr);
  }
}

$('btn-confirm-nextset').onclick = async () => {
  await api('/api/admin/nextSet', 'POST', { questIds: nextSet });
  const btn = $('btn-confirm-nextset');
  const orig = btn.textContent;
  btn.textContent = '✅ Đã lưu';
  setTimeout(() => { btn.textContent = orig; }, 1500);
  loadAll();
};

$('btn-reset').onclick = async () => {
  if (!confirm('Xóa toàn bộ điểm, sổ điểm và vòng? Giữ nguyên người chơi và nhiệm vụ.')) return;
  await api('/api/admin/reset', 'POST');
  loadAll();
};

loadAll();