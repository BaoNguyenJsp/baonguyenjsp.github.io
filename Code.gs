// "Món Quà Bí Ẩn" (The Hidden Gift) — Google Sheets + Apps Script backend.
// Port of server.js: CSV storage → SpreadsheetApp; game logic unchanged.
//
// Deploy: Extensions → Apps Script → paste this file → Deploy → New deployment
//   → Web app (Execute as: Me, Who has access: Anyone). Copy the /exec URL.
//
// Frontend calls: fetch(BASE + '?p=<path>', { method: 'POST',
//   body: JSON.stringify(body) }) with Content-Type: text/plain (avoids CORS
//   preflight). GET works for read-only paths too.
//
// Optional admin protection: set a Script Property named ADMIN_KEY. When set,
// every admin/* call must include body.key === ADMIN_KEY. Leave unset to run
// open (matches the original localhost app).

const SPREADSHEET_ID = ''; // set only if the script is NOT bound to the spreadsheet
const GIFT_MAX = 1000;
const TYPE_COLOR = { Normal: 'green', Medium: 'yellow', Hard: 'red' };
const TYPE_POINTS = { Normal: 2, Medium: 3, Hard: 5 };
const HEADERS = {
  players: ['id', 'name', 'points'],
  points: ['id', 'playerId', 'playerName', 'points', 'reason', 'date'],
  quests: ['id', 'name', 'type', 'points'],
  encouragements: ['id', 'text'],
  state: ['round', 'currentSet', 'nextSet', 'roundDone'],
};

function ss() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// ---- Storage layer (replaces the CSV read/write layer) ----
function readTable(name) {
  const sheet = ss().getSheetByName(name);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const header = values[0].map(String);
  return values.slice(1)
    .filter(r => r.some(f => f !== '' && f != null))
    .map(r => {
      const o = {};
      header.forEach((h, i) => { o[h.trim()] = (r[i] == null ? '' : String(r[i])).trim(); });
      return o;
    });
}
function writeTable(name, rows) {
  const sheet = ss().getSheetByName(name);
  const head = HEADERS[name];
  const values = [head, ...rows.map(r => head.map(h => r[h] ?? ''))];
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, head.length).setValues(values);
}
function nextId(rows) { return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; }

function readState() {
  const r = readTable('state')[0] || {};
  return { round: Number(r.round) || 0, currentSet: r.currentSet || '', nextSet: r.nextSet || '', roundDone: r.roundDone || '' };
}
function writeState(s) {
  writeTable('state', [{ round: s.round, currentSet: s.currentSet, nextSet: s.nextSet, roundDone: s.roundDone }]);
}

// ---- Concurrency: one lock per mutation (replaces the CSV atomic rename) ----
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- Game logic (ported verbatim from server.js) ----
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
    const md = randItem(shuffle(active.filter(q => q.type === 'Medium')));
    if (md) { set.push(md); active.splice(active.indexOf(md), 1); }
  }
  for (const q of shuffle(active.filter(q => q.type === 'Normal'))) { if (set.length >= 3) break; set.push(q); }
  return set.slice(0, 3);
}

const publicQuest = q => ({ id: Number(q.id), name: q.name, type: q.type, points: Number(q.points) || 0, color: TYPE_COLOR[q.type] || 'gray' });

function publicState() {
  const state = readState();
  const players = readTable('players');
  const quests = readTable('quests');
  const total = giftTotal(players);
  const ids = state.currentSet ? state.currentSet.split(/[,;]/).filter(Boolean) : [];
  const done = state.roundDone ? state.roundDone.split(/[,;]/) : [];
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
    nextSet: state.nextSet ? state.nextSet.split(/[,;]/).filter(Boolean) : [],
  };
}

function startRound() {
  return withLock(() => {
    const state = readState();
    const quests = readTable('quests');
    const byId = new Map(quests.map(q => [String(q.id), q]));
    const chosen = (state.nextSet ? state.nextSet.split(/[,;]/).filter(Boolean) : [])
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(q => String(q.id));
    state.round += 1;
    state.currentSet = (chosen.length ? chosen : generateSet(state.round, quests, []).map(q => String(q.id))).join(';');
    state.nextSet = '';
    state.roundDone = '';
    writeState(state);
  });
}

function completeQuest(questId, playerIds) {
  return withLock(() => {
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
    const setIds = state.currentSet ? state.currentSet.split(/[,;]/) : [];
    const done = state.roundDone ? state.roundDone.split(/[,;]/) : [];
    let ended = false;
    if (setIds.includes(String(questId)) && !done.includes(String(questId))) {
      done.push(String(questId));
      state.roundDone = done.join(';');
      if (setIds.every(id => done.includes(id))) { state.currentSet = ''; state.roundDone = ''; ended = true; }
      writeState(state);
    }
    return ended;
  });
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
const ADMIN_KEY = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
function checkAdmin(body) {
  if (ADMIN_KEY && String((body && body.key) || '') !== ADMIN_KEY) throw new Error('Yêu cầu quyền admin');
}
function addPlayer(name) {
  return withLock(() => {
    name = String(name || '').trim();
    if (!name) throw new Error('Tên không được để trống');
    const players = readTable('players');
    players.push({ id: nextId(players), name, points: '0' });
    writeTable('players', players);
  });
}
function deletePlayer(id) {
  return withLock(() => writeTable('players', readTable('players').filter(p => String(p.id) !== String(id))));
}
function adjustPlayerPoints(id, delta, reason) { return adjustPlayersPoints([id], delta, reason); }
function adjustPlayersPoints(playerIds, delta, reason) {
  return withLock(() => {
    const players = readTable('players');
    const points = readTable('points');
    const d = Number(delta) || 0;
    const ids = new Set((playerIds || []).map(String));
    for (const p of players) {
      if (ids.has(String(p.id))) {
        p.points = String(Math.max(0, (Number(p.points) || 0) + d));
        points.push({ id: nextId(points), playerId: p.id, playerName: p.name, points: String(d), reason: reason || 'Admin', date: todayStr() });
      }
    }
    writeTable('players', players);
    writeTable('points', points);
  });
}
function saveQuest(data) {
  return withLock(() => {
    const quests = readTable('quests');
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Tên nhiệm vụ không được để trống');
    const q = data.id ? quests.find(q => String(q.id) === String(data.id)) : null;
    const pts = data.points == null || data.points === '' ? (TYPE_POINTS[data.type] || 2) : Math.max(0, Number(data.points) || 0);
    const body = { name, type: data.type, points: String(pts) };
    if (q) Object.assign(q, body);
    else quests.push({ id: nextId(quests), ...body });
    writeTable('quests', quests);
  });
}
function deleteQuest(id) {
  return withLock(() => writeTable('quests', readTable('quests').filter(q => String(q.id) !== String(id))));
}
function setNextSet(ids) {
  return withLock(() => { const s = readState(); s.nextSet = (ids || []).slice(0, 3).map(String).join(';'); writeState(s); });
}
function resetGame() {
  return withLock(() => {
    writeTable('players', readTable('players').map(p => ({ ...p, points: '0' })));
    writeTable('points', []);
    writeState({ round: 0, currentSet: '', nextSet: '', roundDone: '' });
  });
}

// ---- Router ----
function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function handle(p, body) {
  try {
    switch (p) {
      case 'state': return publicState();
      case 'ranking': return { ranking: ranking() };
      case 'report': return { report: report() };
      case 'quests': return { quests: readTable('quests').map(publicQuest) };
      case 'players': return { players: readTable('players') };
      case 'points': return { points: readTable('points').slice().reverse() };
      case 'round/start': checkAdmin(body); startRound(); return publicState();
      case 'quest/complete': { const ended = completeQuest(body.questId, body.playerIds || []); return { ...publicState(), encouragement: randomEncouragement(), roundEnded: ended }; }
      case 'admin/player': checkAdmin(body); addPlayer(body.name); return { ok: true };
      case 'admin/player/delete': checkAdmin(body); deletePlayer(body.id); return { ok: true };
      case 'admin/player/points': checkAdmin(body); adjustPlayerPoints(body.id, body.points, body.reason); return { ok: true };
      case 'admin/points': checkAdmin(body); adjustPlayersPoints(body.playerIds, body.points, body.reason); return { ok: true };
      case 'admin/quest': checkAdmin(body); saveQuest(body); return { ok: true };
      case 'admin/quest/delete': checkAdmin(body); deleteQuest(body.id); return { ok: true };
      case 'admin/nextSet': checkAdmin(body); setNextSet(body.questIds); return { ok: true };
      case 'admin/reset': checkAdmin(body); resetGame(); return { ok: true };
      default: return { error: 'Không tìm thấy endpoint: ' + p };
    }
  } catch (e) {
    return { error: e.message || 'Lỗi server' };
  }
}
function doGet(e) { return respond(handle((e && e.parameter && e.parameter.p) || '', {})); }
function doPost(e) {
  let body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  }
  return respond(handle((e && e.parameter && e.parameter.p) || '', body));
}

// ---- Setup: run once from the editor to create missing tabs + headers ----
function setup() {
  const book = ss();
  for (const [name, head] of Object.entries(HEADERS)) {
    let sheet = book.getSheetByName(name);
    if (!sheet) sheet = book.insertSheet(name);
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, head.length).setValues([head]);
  }
  migrateQuestTypes();
}

// Map old types (Weekly/Special/Once) onto the new Normal/Medium/Hard. Idempotent.
function migrateQuestTypes() {
  return withLock(() => {
    const map = { Weekly: 'Normal', Special: 'Medium', Once: 'Hard' };
    let changed = false;
    const quests = readTable('quests').map(q => {
      const type = map[q.type] || q.type;
      if (type !== q.type) { q.type = type; changed = true; }
      return q;
    });
    if (changed) writeTable('quests', quests);
  });
}
