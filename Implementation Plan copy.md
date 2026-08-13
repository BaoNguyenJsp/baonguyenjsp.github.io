# Kế Hoạch Triển Khai — "Món Quà Bí Ẩn" (The Hidden Gift)

> Implementation plan derived from `Game Plan.md`. Tech stack and game rules were confirmed with the owner.

## 1. Context

A small church group game where players earn points by completing quests each week. Points accumulate toward a hidden **Gift** worth **1000 points**. The Gift is gradually revealed as the group's total rises. Uses **CSV files as the database** (no external DB).

### Decisions confirmed with the user
- **Tech**: Local Node.js web app — browser UI + tiny zero-dependency Node server that reads/writes CSV. Node v22.18.0 is installed. **No `npm install` needed.**
- **Scoring**: The **Gift total = sum of all players' individual points**. When completing a quest, the game master **clicks players on a grid** (6 columns, rows auto-grow: 4 → 5 when a new player is added) to mark who completed it. Each selected player is credited the quest's points → feeds their ranking score AND the Gift total.
- **Quest mechanic**: Simple multiply — no "times to clear" tracking. The `times` field is shown on the quest button as flavor only; completing a quest immediately credits selected players and consumes the quest set.
- **Ranking**: Individual per-player, standard competition ranking (ties share the same rank: 1, 2, 2, 4).

## 2. Tech stack & how to run
- Node 22 built-in `http` module only — no dependencies.
- Run: `node server.js` → opens at `http://localhost:3210` (game) and `/admin` (admin page).
- CSV stored in `data/` next to the server.

## 3. File structure
```
HK1/
  server.js              # HTTP server + REST API + CSV read/write layer
  data/
    players.csv          # id,name,points
    points.csv           # point ledger: id,playerId,playerName,points,reason,date
    quests.csv           # id,name,type,points,times,active
    state.csv            # started,week,nextSet  (single data row)
    encouragements.csv   # id,text  (Vietnamese messages)
  public/
    index.html           # game screen (Gift, quests, modals)
    admin.html           # admin screen
    style.css
    app.js               # game-screen logic
    admin.js             # admin-screen logic
```

## 4. Data model (CSV schemas)

- **players.csv** — `id,name,points`. Points drive both ranking and Gift total.
- **points.csv** (the "store point and reason" table) — append-only ledger: `id,playerId,playerName,points,reason,date`. Every credit (quest or admin manual entry) is logged here. reason e.g. `Nhiệm vụ: Đọc Kinh Thánh` / `Admin: thưởng`.
- **quests.csv** — `id,name,type,points,times,active` where `type ∈ {Once, Special, Weekly, Normal}`. Color is **derived from type** (Once=Red, Special=Yellow, Weekly=Green, Normal=Gray). `times` = flavor number shown on the button. `active` = still available for quest sets.
- **state.csv** — single row `started,week,nextSet`. `nextSet` = comma-separated quest ids the admin pinned for the next set (empty = auto-generate).
- **encouragements.csv** — `id,text`; server returns a random one after each completion.

CSV layer: small RFC4180-style parser/serializer (handles quoted fields with commas — Vietnamese text may contain commas). Writes via temp-file + rename to avoid corruption. UTF-8 with BOM so Excel opens Vietnamese correctly.

## 5. Game logic

### Quest-set generation (server, for a given `week`)
The set = **3 quest buttons** + the always-present **"Sẽ cố gắng lần sau"** black button (skip).

1. If `state.nextSet` is pinned → use those quests (up to 3). Consumed after this set is shown.
2. Else auto-generate:
   - **Once (Red)** — if one is scheduled for this week (see Admin below), occupies a slot with huge points.
   - **Special (Yellow)** — one random active Special quest when `week % 3 === 0` (every 3 weeks), huge points.
   - **Weekly (Green)** — active Weekly quests fill remaining slots.
   - **Normal (Gray)** — fill leftover slots to reach 3.
3. Quest buttons colored by type (Once=Red, Special=Yellow, Weekly=Green, Normal=Gray).

First click of **"Nhiệm vụ"** when `started=false` initializes the game: `started=true, week=1`, generate set 1.

### Completing a quest
1. Game master clicks a colored quest button → **player-selection modal**: grid of players (6 columns; rows = `ceil(n/6)`, auto-grows), click to toggle selection, live selected-count shown.
2. Confirm → server credits **each selected player** `quest.points` (updates `players.csv`, appends to `points.csv` ledger with reason `Nhiệm vụ: <name>`).
3. Server advances: `week++`, generates the next set, and **deactivates the quest if it was Once** (one-time only). `started` stays true.
4. Gift % = `sum(players.points) / 1000`. UI re-renders the Gift (cover rises from the bottom proportional to %).

### Gift reveal & win
- Gift stage: a large 🎁 behind an opaque cover. Cover height from bottom = `(100 − pct)%` → gift revealed from the bottom as points grow.
- At `pct >= 100%`: gift fully revealed, **shine + confetti-explode animation**, congratulations message in Vietnamese. Show once per game (flag in state).

### Encouragement popup
After each completed quest: a random Vietnamese encouragement (from `encouragements.csv`) in a popup that auto-dismisses after **10 seconds**, then "Nhiệm vụ" button returns for the next set.

### Admin page
- **Manage quests**: add / edit / delete quests (name, type, points, times).
- **Fix the next quest set**: pin up to 3 quests to appear next; or create a **Once** quest which is automatically scheduled for the next set (huge points).
- **Manage players**: add / remove players, and **manually add/subtract points** for a player (with a reason) — logged to the ledger.
- **View ledger** (points + reasons history).
- **Reset game**: zero all player points, clear ledger, `week=0, started=false`, clear pins (keeps player list and quest definitions).

## 6. API endpoints (JSON)
- `GET /api/state` → `{ started, week, giftTotal, giftMax:1000, giftPct, giftAchieved, players, currentSet:[quests], encouragement? }`
- `POST /api/quest/complete` `{ questId, playerIds[] }` → credits players, advances set, returns new state + `encouragement`
- `POST /api/quest/skip` → advances set, returns new state
- `POST /api/admin/players` `{ name }`
- `DELETE /api/admin/players/:id`
- `POST /api/admin/players/:id/points` `{ points, reason }` (positive or negative)
- `POST /api/admin/quests` `{ id?, name, type, points, times, active }` (create/update) / `DELETE /api/admin/quests/:id`
- `POST /api/admin/nextSet` `{ questIds[] }` → pins next set (empty clears)
- `POST /api/admin/reset`
- `GET /api/ranking` → players sorted desc with competition ranks (ties share rank)
- Static: `GET /` (index.html), `GET /admin` (admin.html), `GET /public/*`

## 7. UI screens
**Game (`index.html`)** — header (title, "Xếp hạng" ranking button, Admin link); Gift stage with rising reveal + % label; big "Nhiệm vụ" button; quest panel; player-grid modal; encouragement modal; celebration overlay; ranking modal. All text is big size

**Admin (`admin.html`)** — quest management, next-set fixer, player management + manual points, ledger view, reset button.

All UI text in Vietnamese (e.g., "Nhiệm vụ", "Xếp hạng", "Chúc mừng!", encouragement phrases).

## 8. Implementation steps
1. `server.js`: CSV layer + HTTP router + static serving; define data tables.
2. Game logic: set generation (types/colors/week%), complete/skip, gift %, ranking with ties, reset.
3. API endpoints + state serialization.
4. `public/style.css`: gift stage, colored quest buttons, grid modal, modals, animations.
5. `public/app.js`: load state, quest flow, grid selection, encouragement timer, celebration, ranking.
6. `public/admin.html` + `public/admin.js`: quest CRUD, next-set pinning, players, manual points, reset.
7. Seed `data/*.csv` with starter content (sample players, quests of each type, Vietnamese encouragements).

## 9. Verification
1. `node server.js`, open `http://localhost:3210` in browser.
2. Click "Nhiệm vụ" → 3 colored quest buttons + skip button appear (game initializes).
3. Click a quest → player grid modal → select some players → confirm → Gift rises by the right %, encouragement popup shows and auto-closes after 10s, "Nhiệm vụ" returns.
4. Repeat across week 3 to confirm a Special quest appears; confirm Weekly quests appear every set; confirm a Once quest appears the set after it was created.
5. Reach 100% (temporarily set a player's points high via Admin) → gift shines + confetti + congratulations.
7. Admin: add/edit/delete quests, pin next set, add players, add/subtract points, check ledger, verify Gift % matches sum of player points.
8. Ranking modal: ties share rank; sorted desc.
9. Reset → all scores zeroed, gift hidden, game restarts clean.
10. Inspect a CSV file in Excel → Vietnamese renders correctly, no corruption after multiple writes.
