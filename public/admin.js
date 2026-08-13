const $ = id => document.getElementById(id);
let nextSet = [];

const TYPE_TAG = { Once: 'Super Special', Special: 'Special', Weekly: 'Weekly', Normal: 'Normal' };
const TYPE_COLOR = { Once: 'q-red', Special: 'q-yellow', Weekly: 'q-green', Normal: 'q-gray' };
const TYPE_POINTS = { Normal: 1, Weekly: 2, Special: 3, Once: 5 };

async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lỗi');
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

async function loadAll() {
  const [state, quests, players, points, report] = await Promise.all([
    api('/api/state'), api('/api/quests'), api('/api/players'), api('/api/points'), api('/api/report'),
  ]);
  nextSet = state.nextSet;
  renderQuests(quests.quests);
  renderPlayers(players.players);
  renderLedger(points.points);
  renderReport(report.report);
}

// ---- Quests ----
function renderQuests(quests) {
  const tbody = $('quest-tbody');
  tbody.innerHTML = '';
  for (const q of quests) {
    const tr = document.createElement('tr');
    const tdChk = document.createElement('td');
    tdChk.className = 'center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = nextSet.includes(String(q.id));
    cb.onchange = async () => {
      nextSet = cb.checked ? [...nextSet, String(q.id)].slice(-3) : nextSet.filter(i => i !== String(q.id));
      await api('/api/admin/nextSet', 'POST', { questIds: nextSet });
      loadAll();
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
      `<td>${q.name}</td><td><span class="tag ${TYPE_COLOR[q.type]}">${TYPE_TAG[q.type]}</span></td>` +
      `<td><b>${q.points}</b></td>`);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
}

function openQuestModal(q) {
  $('quest-modal-title').textContent = q ? '✏️ Sửa nhiệm vụ' : '➕ Thêm nhiệm vụ';
  $('q-name').value = q ? q.name : '';
  $('q-type').value = q ? q.type : 'Normal';
  $('quest-form').dataset.id = q ? q.id : '';
  syncType();
  $('modal-quest').hidden = false;
}

function syncType() {
  $('q-points-hint').textContent = TYPE_POINTS[$('q-type').value];
}
$('q-type').onchange = syncType;

$('quest-form').onsubmit = async e => {
  e.preventDefault();
  const body = {
    id: $('quest-form').dataset.id || null,
    name: $('q-name').value.trim(),
    type: $('q-type').value,
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
    tr.innerHTML = `<td>${p.name}</td><td><b>${p.points}</b></td>`;
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
  await api('/api/admin/players', 'POST', { name: $('p-name').value.trim() });
  $('modal-player').hidden = true;
  loadAll();
};

$('btn-new-player').onclick = () => { $('p-name').value = ''; $('modal-player').hidden = false; $('p-name').focus(); };

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

$('btn-reset').onclick = async () => {
  if (!confirm('Xóa toàn bộ điểm, sổ điểm và vòng? Giữ nguyên người chơi và nhiệm vụ.')) return;
  await api('/api/admin/reset', 'POST');
  loadAll();
};

loadAll();
