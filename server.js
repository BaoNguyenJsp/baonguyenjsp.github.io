// "Món Quà Bí Ẩn" (The Hidden Gift) — zero-dependency CSV-backed game server.
// Run: node server.js  →  http://localhost:3210  (admin: /admin)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3210;
const GIFT_MAX = 1000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(DATA_DIR, 'state.csv');
const TYPE_COLOR = { Once: 'red', Special: 'yellow', Weekly: 'green', Normal: 'gray' };
const TYPE_POINTS = { Normal: 1, Weekly: 3, Special: 5, Once: 10 };
const HEADERS = {
  players: ['id', 'name', 'points'],
  points: ['id', 'playerId', 'playerName', 'points', 'reason', 'date'],
  quests: ['id', 'name', 'type', 'points'],
  encouragements: ['id', 'text'],
};

// ---- CSV layer (RFC4180-ish; quoted fields, UTF-8 BOM, atomic writes) ----
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows[0] || [];
  return rows.slice(1)
    .filter(r => r.length && r.some(f => f.trim() !== ''))
    .map(r => { const o = {}; header.forEach((h, i) => { o[h.trim()] = (r[i] ?? '').trim(); }); return o; });
}
function escapeField(v) {
  v = String(v ?? '');
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function serializeCSV(rows) {
  return '﻿' + rows.map(r => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
}
function writeFileAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

// ---- Data tables ----
const tableFile = name => path.join(DATA_DIR, name + '.csv');
function readTable(name) {
  const f = tableFile(name);
  if (!fs.existsSync(f)) return [];
  return parseCSV(fs.readFileSync(f, 'utf8'));
}
function writeTable(name, rows) {
  const head = HEADERS[name];
  writeFileAtomic(tableFile(name), serializeCSV([head, ...rows.map(r => head.map(h => r[h] ?? ''))]));
}
function nextId(rows) { return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; }

function readState() {
  if (!fs.existsSync(STATE_FILE)) return { round: 0, currentSet: '', nextSet: '', roundDone: '' };
  const r = parseCSV(fs.readFileSync(STATE_FILE, 'utf8'))[0] || {};
  return {
    round: Number(r.round) || 0,
    currentSet: r.currentSet || '',
    nextSet: r.nextSet || '',
    roundDone: r.roundDone || '',
  };
}
function writeState(s) {
  writeFileAtomic(STATE_FILE, serializeCSV([
    ['round', 'currentSet', 'nextSet', 'roundDone'],
    [s.round, s.currentSet, s.nextSet, s.roundDone],
  ]));
}

// ---- Game logic ----
const giftTotal = players => players.reduce((s, p) => s + (Number(p.points) || 0), 0);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const randItem = a => a[Math.floor(Math.random() * a.length)];
const todayStr = () => new Date().toISOString().slice(0, 10);

function generateSet(week, quests, pinnedIds) {
  const byId = new Map(quests.map(q => [String(q.id), q]));
  const set = [];
  for (const id of pinnedIds) {
    if (set.length >= 3) break;
    const q = byId.get(String(id));
    if (q) set.push(q);
  }
  if (set.length >= 3) return set;
  const active = quests.filter(q => !set.includes(q));
  if (week % 3 === 0) {
    const sp = randItem(shuffle(active.filter(q => q.type === 'Special')));
    if (sp) { set.push(sp); active.splice(active.indexOf(sp), 1); }
  }
  for (const q of shuffle(active.filter(q => q.type === 'Weekly'))) { if (set.length >= 3) break; set.push(q); }
  for (const q of shuffle(active.filter(q => q.type === 'Normal'))) { if (set.length >= 3) break; set.push(q); }
  return set.slice(0, 3);
}

const publicQuest = q => ({ id: Number(q.id), name: q.name, type: q.type, points: Number(q.points) || 0, color: TYPE_COLOR[q.type] || 'gray' });
const publicQuestFull = q => ({ id: Number(q.id), name: q.name, type: q.type, points: Number(q.points) || 0, color: TYPE_COLOR[q.type] || 'gray' });

function publicState() {
  const state = readState();
  const players = readTable('players');
  const quests = readTable('quests');
  const total = giftTotal(players);
  const ids = state.currentSet ? state.currentSet.split(',').filter(Boolean) : [];
  const done = state.roundDone ? state.roundDone.split(',') : [];
  return {
    round: state.round,
    roundActive: ids.length > 0,
    giftTotal: total,
    giftMax: GIFT_MAX,
    giftPct: Math.min(100, Math.round(total / GIFT_MAX * 100)),
    giftAchieved: total >= GIFT_MAX,
    players: players.map(p => ({ id: Number(p.id), name: p.name, points: Number(p.points) || 0 })),
    currentSet: ids.map(id => quests.find(q => String(q.id) === id)).filter(Boolean).map(publicQuest),
    roundDone: done.map(Number),
    nextSet: state.nextSet ? state.nextSet.split(',').filter(Boolean) : [],
  };
}

function startRound() {
  const state = readState();
  const quests = readTable('quests');
  const byId = new Map(quests.map(q => [String(q.id), q]));
  const chosen = (state.nextSet ? state.nextSet.split(',').filter(Boolean) : [])
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(q => String(q.id));
  state.round += 1;
  state.currentSet = (chosen.length ? chosen : generateSet(state.round, quests, []).map(q => String(q.id))).join(',');
  state.nextSet = '';
  state.roundDone = '';
  writeState(state);
}

function completeQuest(questId, playerIds) {
  const quests = readTable('quests');
  const q = quests.find(q => String(q.id) === String(questId));
  if (!q) throw new Error('Không tìm thấy nhiệm vụ');
  const players = readTable('players');
  const points = readTable('points');
  const pts = (Number(q.points) || 0);
  const chosen = new Set((playerIds || []).map(String));
  for (const p of players) {
    if (chosen.has(String(p.id))) {
      p.points = String((Number(p.points) || 0) + pts);
      points.push({ id: nextId(points), playerId: p.id, playerName: p.name, points: String(pts), reason: 'Nhiệm vụ: ' + q.name, date: todayStr() });
    }
  }
  writeTable('players', players);
  writeTable('points', points);
  const state = readState();
  const setIds = state.currentSet ? state.currentSet.split(',') : [];
  const done = state.roundDone ? state.roundDone.split(',') : [];
  let ended = false;
  if (setIds.includes(String(questId)) && !done.includes(String(questId))) {
    done.push(String(questId));
    state.roundDone = done.join(',');
    if (setIds.every(id => done.includes(id))) { state.currentSet = ''; state.roundDone = ''; ended = true; }
    writeState(state);
  }
  return ended;
}

function randomEncouragement() {
  const list = readTable('encouragements').map(r => r.text).filter(Boolean);
  return list.length ? randItem(list) : 'Tuyệt vời! 🎉';
}

function ranking() {
  const players = readTable('players')
    .map(p => ({ id: Number(p.id), name: p.name, points: Number(p.points) || 0 }))
    .sort((a, b) => b.points - a.points);
  let rank = 0, prev = null;
  return players.map((p, i) => {
    if (p.points !== prev) { rank = i + 1; prev = p.points; }
    return { ...p, rank };
  });
}

function report() {
  const players = readTable('players').map(p => ({ id: Number(p.id), name: p.name, points: Number(p.points) || 0 }));
  const ledger = readTable('points');
  const rankOf = new Map(ranking().map(r => [String(r.id), r.rank]));
  const isQuest = r => (r.reason || '').startsWith('Nhiệm vụ:');
  const byPlayer = players.map(p => {
    const mine = ledger.filter(r => String(r.playerId) === String(p.id));
    const questRows = mine.filter(isQuest);
    const questPts = questRows.reduce((s, r) => s + (Number(r.points) || 0), 0);
    return {
      name: p.name,
      points: p.points,
      rank: rankOf.get(String(p.id)) || 0,
      questsDone: questRows.length,
      avg: questRows.length ? Math.round(questPts / questRows.length) : 0,
    };
  }).sort((a, b) => b.points - a.points);
  const totalPoints = players.reduce((s, p) => s + p.points, 0);
  return {
    players: byPlayer,
    totals: {
      players: players.length,
      totalPoints,
      questsDone: ledger.filter(isQuest).length,
      giftMax: GIFT_MAX,
      giftPct: Math.min(100, Math.round(totalPoints / GIFT_MAX * 100)),
    },
  };
}

// ---- Admin ----
function addPlayer(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Tên không được để trống');
  const players = readTable('players');
  players.push({ id: nextId(players), name, points: '0' });
  writeTable('players', players);
}
function deletePlayer(id) { writeTable('players', readTable('players').filter(p => String(p.id) !== String(id))); }
function adjustPlayerPoints(id, delta, reason) {
  const players = readTable('players');
  const p = players.find(p => String(p.id) === String(id));
  if (!p) throw new Error('Không tìm thấy người chơi');
  const d = Number(delta) || 0;
  p.points = String(Math.max(0, (Number(p.points) || 0) + d));
  const points = readTable('points');
  points.push({ id: nextId(points), playerId: p.id, playerName: p.name, points: String(d), reason: reason || 'Admin', date: todayStr() });
  writeTable('players', players);
  writeTable('points', points);
}
function saveQuest(data) {
  const quests = readTable('quests');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Tên nhiệm vụ không được để trống');
  const q = data.id ? quests.find(q => String(q.id) === String(data.id)) : null;
  const body = { name, type: data.type, points: String(TYPE_POINTS[data.type] || 1) };
  if (q) Object.assign(q, body);
  else quests.push({ id: nextId(quests), ...body });
  writeTable('quests', quests);
  // ponytail: a new Once quest is auto-scheduled for the next set; cap pinned list at 3.
  if (!q && data.type === 'Once') {
    const s = readState();
    const pinned = s.nextSet ? s.nextSet.split(',').filter(Boolean) : [];
    if (!pinned.includes(String(quests[quests.length - 1].id))) pinned.unshift(String(quests[quests.length - 1].id));
    s.nextSet = pinned.slice(0, 3).join(',');
    writeState(s);
  }
}
function deleteQuest(id) { writeTable('quests', readTable('quests').filter(q => String(q.id) !== String(id))); }
function setNextSet(ids) { const s = readState(); s.nextSet = (ids || []).slice(0, 3).map(String).join(','); writeState(s); }
function resetGame() {
  writeTable('players', readTable('players').map(p => ({ ...p, points: '0' })));
  writeTable('points', []);
  writeState({ round: 0, currentSet: '', nextSet: '', roundDone: '' });
}

// ---- HTTP ----
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
function serveStatic(req, res, file) {
  const f = path.join(PUBLIC_DIR, path.basename(file));
  if (!fs.existsSync(f)) return json(res, { error: 'Not found' }, 404);
  const mime = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(f).size;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Cache-Control': 'no-store' });
    fs.createReadStream(f, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    const m = req.method;

    if (p === '/api/state' && m === 'GET') return json(res, publicState());
    if (p === '/api/ranking' && m === 'GET') return json(res, { ranking: ranking() });
    if (p === '/api/report' && m === 'GET') return json(res, { report: report() });
    if (p === '/api/quests' && m === 'GET') return json(res, { quests: readTable('quests').map(publicQuestFull) });
    if (p === '/api/players' && m === 'GET') return json(res, { players: readTable('players') });
    if (p === '/api/points' && m === 'GET') return json(res, { points: readTable('points').slice().reverse() });
    if (p === '/api/round/start' && m === 'POST') { startRound(); return json(res, publicState()); }
    if (p === '/api/quest/complete' && m === 'POST') {
      const b = await readBody(req);
      const roundEnded = completeQuest(b.questId, b.playerIds || []);
      return json(res, { ...publicState(), encouragement: randomEncouragement(), roundEnded });
    }
    if (p === '/api/admin/players' && m === 'POST') { const b = await readBody(req); addPlayer(b.name); return json(res, { ok: true }); }
    let x;
    if ((x = p.match(/^\/api\/admin\/players\/(\d+)$/)) && m === 'DELETE') { deletePlayer(x[1]); return json(res, { ok: true }); }
    if ((x = p.match(/^\/api\/admin\/players\/(\d+)\/points$/)) && m === 'POST') { const b = await readBody(req); adjustPlayerPoints(x[1], b.points, b.reason); return json(res, { ok: true }); }
    if (p === '/api/admin/quests' && m === 'POST') { const b = await readBody(req); saveQuest(b); return json(res, { ok: true }); }
    if ((x = p.match(/^\/api\/admin\/quests\/(\d+)$/)) && m === 'DELETE') { deleteQuest(x[1]); return json(res, { ok: true }); }
    if (p === '/api/admin/nextSet' && m === 'POST') { const b = await readBody(req); setNextSet(b.questIds); return json(res, { ok: true }); }
    if (p === '/api/admin/reset' && m === 'POST') { resetGame(); return json(res, { ok: true }); }

    if (p === '/') return serveStatic(req, res, 'index.html');
    if (p === '/admin') return serveStatic(req, res, 'admin.html');
    if (p.startsWith('/public/')) return serveStatic(req, res, p.slice('/public/'.length));
    if (p === '/favicon.ico') return res.writeHead(204).end();
    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message || 'Lỗi server' }, 400);
  }
});

// Ensure data files exist (seed files ship with the app; this covers a bare copy).
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const name of Object.keys(HEADERS)) if (!fs.existsSync(tableFile(name))) writeTable(name, []);
if (!fs.existsSync(STATE_FILE)) writeState({ round: 0, currentSet: '', nextSet: '', roundDone: '' });

server.listen(PORT, () => console.log(`🎁 Món Quà Bí Ẩn → http://localhost:${PORT}  (admin: /admin)`));
