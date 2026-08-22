# Refactor Plan — CSV + Node → Google Sheets + Apps Script

## 1. Goal

Replace the local Node.js server and its 5 CSV files with **one Google Spreadsheet (one tab per data table)** and an **Apps Script** backend. The frontend (`public/`) stays as static files — only the API base URL changes.

Current: `node server.js` → REST API + CSV storage + static hosting on port 3210.
Target: Apps Script web app → REST API + Spreadsheet storage. Static frontend hosted anywhere.

Key insight: **Apps Script is JavaScript**, so all game logic in `server.js` (`generateSet`, `completeQuest`, `publicState`, `ranking`, `report`, admin mutations) ports **1:1, unchanged**. Only the storage layer (`readTable`/`writeTable`/`readState`/`writeState`) is replaced with `SpreadsheetApp` calls.

## 2. Sheet layout (1 spreadsheet, 5 tabs)

| CSV file | Sheet tab | Columns |
|---|---|---|
| `data/players.csv` | `players` | id, name, points |
| `data/points.csv` | `points` | id, playerId, playerName, points, reason, date |
| `data/quests.csv` | `quests` | id, name, type, points |
| `data/encouragements.csv` | `encouragements` | id, text |
| `data/state.csv` | `state` | round, currentSet, nextSet, roundDone (single data row) |

Mirrors the CSV headers exactly → migration is a copy-paste and the `HEADERS` const in `server.js` is reused as-is.

Note: `getValues()` returns numbers as numbers (CSV gave strings). Harmless — the code already coerces everything with `String()`/`Number()` everywhere.

## 3. Apps Script file structure

One script bound to the spreadsheet (Extensions → Apps Script). One file, `Code.gs`:

```
Code.gs
  constants: SPREADSHEET_ID (omit if bound), GIFT_MAX, TYPE_COLOR, TYPE_POINTS, HEADERS
  storage layer:  readTable(name), writeTable(name, rows), readState(), writeState()   // was fs→CSV
  router:         doGet(e), doPost(e) → handle(path, body) → JSON via ContentService
  game logic:     nextId, generateSet, publicState, startRound, completeQuest,          // ports from server.js verbatim
                  randomEncouragement, ranking, report
  admin:          addPlayer, deletePlayer, adjustPlayerPoints, saveQuest, deleteQuest,
                  setNextSet, resetGame
```

## 4. Storage layer mapping (the only real rewrite)

| server.js | Code.gs |
|---|---|
| `readTable(name)` → parse CSV file | `Sheet.getSheetByName(name).getDataRange().getValues()` → header→object map |
| `writeTable(name, rows)` → atomic temp-file rename | `sheet.getRange(1,1,rows,cols).setValues(...)` under a script lock |
| `readState()` / `writeState()` | same as any table; `state` tab row 2 |
| `nextId(rows)` | unchanged |
| seed on startup | one-time `setup()` run from editor (creates tabs + headers if missing) |

`writeTable` = `clearContents()` then write the full table back. **Wrap every read-modify-write in `LockService.getScriptLock().waitLock(10000)`** — `completeQuest` reads players+points+state and writes all three; without a lock two simultaneous admin clicks race. (Atomicity that temp-file+rename gave CSV for free.)

## 5. Endpoint mapping (doGet/doPost router)

Frontend `api()` becomes `POST https://script.google.com/.../exec?p=<path>` with a JSON body, for *everything* (Apps Script supports only GET/POST — no DELETE). Reads work as GET too, but one POST router is simpler.

| Old route | New path (`?p=`) | Body |
|---|---|---|
| `GET /api/state` | `state` | — |
| `GET /api/ranking` | `ranking` | — |
| `GET /api/report` | `report` | — |
| `GET /api/quests` | `quests` | — |
| `GET /api/players` | `players` | — |
| `GET /api/points` | `points` | — |
| `POST /api/round/start` | `round/start` | — |
| `POST /api/quest/complete` | `quest/complete` | `{ questId, playerIds }` |
| `POST /api/admin/players` | `admin/player` | `{ name, key }` |
| `DELETE /api/admin/players/:id` | `admin/player/delete` | `{ id, key }` |
| `POST /api/admin/players/:id/points` | `admin/player/points` | `{ id, points, reason, key }` |
| `POST /api/admin/quests` | `admin/quest` | `{ id?, name, type, key }` |
| `DELETE /api/admin/quests/:id` | `admin/quest/delete` | `{ id, key }` |
| `POST /api/admin/nextSet` | `admin/nextSet` | `{ questIds, key }` |
| `POST /api/admin/reset` | `admin/reset` | `{ key }` |

Responses: `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)`.

## 6. Frontend changes (minimal)

Both `public/app.js` and `public/admin.js` change their `api()` helper only:

- `const BASE = '<WEB_APP_URL>';`
- All calls become POST to `BASE + '?p=' + path` with body.
- **Content-Type must be `text/plain`** (or form-encoded) — see gotcha #1.
- `api()` in `admin.js` prepends `key: <adminKey>` to every admin body.

Admin key: prompt once in `admin.html`, store in `sessionStorage`, append to admin calls. No password = anyone with the URL can call `admin/*`, and the web app is shareable.

The game pages (`index.html`/`admin.html`/`style.css`/`app.js`/`admin.js`/svg/mp4) are **unchanged** and stay static.

## 7. Deployment steps

1. Create a Google Spreadsheet; create the 5 tabs with the header rows above.
2. Import data: File → Import → Upload the 5 CSVs into their tabs (import strips headers→already have them, or paste values-only). Or write a one-time `setup()` in Code.gs seeded from `server.js`'s seed data.
3. Extensions → Apps Script → paste `Code.gs`.
4. Deploy → New deployment → **Web app** → *Execute as: Me*, *Who has access: Anyone*.
5. Copy the `/exec` URL into the `BASE` const in `app.js` and `admin.js`.
6. Host the `public/` folder on any static host (GitHub Pages, the old localhost, etc.). Point the browser there.
7. `server.js` and `data/*.csv` are retired.

## 8. Risks & gotchas

1. **CORS preflight.** A cross-origin `fetch` with `Content-Type: application/json` triggers an `OPTIONS` preflight that Apps Script doesn't answer. Send the body as `text/plain` (simple request, no preflight) and `JSON.parse` on the server.
2. **No DELETE.** All mutations route through POST with an explicit path.
3. **HtmlService can't serve the mp4** background. Don't move the frontend into the script — keep it static and let Apps Script be API-only.
4. **Quotas.** Web app: 20,000 requests/day, 90s per execution. Trivially fine at church-group scale; no caching needed.
5. **Spreadsheet can't be edited by a second person while a write is mid-flight** — the `LockService` guard covers it.
6. **Redaction/audit.** Admin key lives in a script property (not in the frontend source). Anyone viewing the HTML can still extract nothing — key is typed by the admin at runtime.

## 9. Suggested implementation order

1. Copy `server.js` game logic into `Code.gs` untouched; replace storage layer with `SpreadsheetApp` + `LockService`.
2. Add the doGet/doPost router.
3. Create spreadsheet, tabs, import CSV data.
4. Rewrite the two `api()` helpers; add admin-key prompt.
5. Deploy web app, wire `BASE`, verify player + admin flows against the checklist in `Implementation Plan copy.md` §9.
