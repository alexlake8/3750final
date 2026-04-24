@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap');

/* ============================================================
   DESIGN TOKENS — tactical command-console theme
   ============================================================ */
:root {
  color-scheme: dark;

  /* Surfaces — stepped navy */
  --bg-void:     #05080f;
  --bg:          #0a1020;
  --surface-1:   #101830;
  --surface-2:   #16203c;
  --surface-3:   #1d2a4d;

  /* Borders */
  --line:        rgba(148, 175, 230, 0.10);
  --line-strong: rgba(148, 175, 230, 0.22);

  /* Signal colors */
  --sonar:       #38bdf8;
  --sonar-bright:#7dd3fc;
  --sonar-soft:  rgba(56, 189, 248, 0.10);
  --sonar-glow:  rgba(56, 189, 248, 0.28);
  --alert:       #fbbf24;
  --alert-soft:  rgba(251, 191, 36, 0.14);
  --hit:         #f43f5e;
  --hit-soft:    rgba(244, 63, 94, 0.15);
  --sunk:        #fb923c;
  --sunk-soft:   rgba(251, 146, 60, 0.18);
  --miss:        #64748b;
  --miss-soft:   rgba(100, 116, 139, 0.18);
  --ship:        #2dd4bf;
  --ship-soft:   rgba(45, 212, 191, 0.18);
  --ok:          #34d399;

  /* Text */
  --ink:         #e2e8f0;
  --ink-bright:  #f8fafc;
  --ink-muted:   #94a3b8;
  --ink-dim:     #64748b;

  /* Type */
  --font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
  --font-body:    'Outfit', ui-sans-serif, system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, monospace;

  /* Radii */
  --r-sm: 6px;
  --r:    10px;
  --r-lg: 14px;
}

:root[data-theme="light"] {
  --bg: #f4f7fb;
  --panel: #ffffff;
  --panel-soft: #eef4fb;
  --panel-strong: #dbeafe;
  --text: #102033;
  --muted: #52677f;
  --border: #c8d7ea;
  --accent: #0ea5e9;
  --accent-strong: #0284c7;
  --success: #047857;
  --danger: #dc2626;
  --warning: #ca8a04;
  --cell: #38bdf8;
  --cell-dark: #0ea5e9;
  --ship: #16a34a;
}
:root[data-theme="light"] body {
  background:
    linear-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px),
    var(--bg);
  color: var(--text);
}

:root[data-theme="light"] input,
:root[data-theme="light"] select {
  background: #ffffff;
  color: var(--text);
  border-color: var(--border);
}

:root[data-theme="light"] .panel,
:root[data-theme="light"] .board-card,
:root[data-theme="light"] .game-card,
:root[data-theme="light"] .summary-card,
:root[data-theme="light"] .stat,
:root[data-theme="light"] .player-pill,
:root[data-theme="light"] .log-item {
  background: var(--panel);
  border-color: var(--border);
}

:root[data-theme="light"] .cell {
  background: #38bdf8;
}

:root[data-theme="light"] .cell.ship {
  background: #16a34a;
}

:root[data-theme="light"] .cell.hit,
:root[data-theme="light"] .cell.sunk {
  background: #dc2626;
}

:root[data-theme="light"] .cell.miss {
  background: #93c5fd;
}
/* ============================================================
   RESET + BASE
   ============================================================ */
*, *::before, *::after { box-sizing: border-box; }

html, body { margin: 0; padding: 0; }

body {
  min-height: 100vh;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink);
  background-color: var(--bg);
  /* Nautical chart grid — barely there */
  background-image:
    linear-gradient(to right, rgba(56, 189, 248, 0.035) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(56, 189, 248, 0.035) 1px, transparent 1px);
  background-size: 40px 40px;
  background-attachment: fixed;
}

/* ============================================================
   TYPOGRAPHY
   ============================================================ */
h1, h2, h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink-bright);
  line-height: 1.15;
}

h1 { font-size: 1.9rem; letter-spacing: -0.02em; }
h2 { font-size: 1.05rem; font-weight: 600; }
h3 { font-size: 0.95rem; font-weight: 600; }

p { margin: 0; }

.eyebrow {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--sonar);
}

.small {
  font-size: 0.83rem;
  color: var(--ink-muted);
}

.mono { font-family: var(--font-mono); }

.wrap { overflow-wrap: anywhere; word-break: break-all; }

/* ============================================================
   APP SHELL  —  2 columns, no overlap possible
   ============================================================ */
#app {
  max-width: 1560px;
  margin: 0 auto;
  padding: 1.75rem 1.5rem 3rem;
}

.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 1.5rem;
}

.hero > div:first-child h1 { margin-top: 0.25rem; }

.hero p {
  margin-top: 0.3rem;
  color: var(--ink-muted);
  font-size: 0.9rem;
}

.layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 1.75rem;
  align-items: start;
}

/* The .sidebar wrapper is the sole left-column grid child. Inside it,
   identity-col and lobby-col stack via flex so they always sit
   back-to-back, independent of how tall the game column grows. */
.sidebar {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.identity-col,
.lobby-col {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.game-col,
main.stack {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

aside.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

/* ============================================================
   PANEL  —  NO box-shadow. Borders + surface tints only.
   ============================================================ */
.panel {
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}

.panel h2 {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.panel h2::before {
  content: "";
  width: 3px;
  height: 1em;
  background: var(--sonar);
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.section-head h2 { margin: 0; }

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

/* ============================================================
   FORM CONTROLS
   ============================================================ */
label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

input, select {
  width: 100%;
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--ink);
  background: var(--bg-void);
  border: 1px solid var(--line-strong);
  border-radius: var(--r);
  padding: 0.7rem 0.85rem;
  outline: none;
  transition: border-color 140ms, box-shadow 140ms;
}

input::placeholder { color: var(--ink-dim); }

input:focus, select:focus {
  border-color: var(--sonar);
  box-shadow: 0 0 0 3px var(--sonar-soft);
}

/* ============================================================
   BUTTONS
   ============================================================ */
button {
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.65rem 1rem;
  border-radius: var(--r);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 140ms, border-color 140ms, color 140ms, transform 60ms;
  letter-spacing: 0;
}

button:active:not(:disabled) { transform: translateY(1px); }

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Primary — cyan sonar */
button[type="submit"],
button:not(.ghost):not(.secondary) {
  background: var(--sonar);
  color: var(--bg-void);
  border-color: var(--sonar);
}

button[type="submit"]:hover:not(:disabled),
button:not(.ghost):not(.secondary):hover:not(:disabled) {
  background: var(--sonar-bright);
  border-color: var(--sonar-bright);
}

button.secondary {
  background: var(--surface-2);
  color: var(--ink);
  border-color: var(--line-strong);
}

button.secondary:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--sonar);
}

button.ghost {
  background: transparent;
  color: var(--ink);
  border-color: var(--line-strong);
}

button.ghost:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--sonar);
  color: var(--sonar-bright);
}

button.small-button {
  padding: 0.4rem 0.7rem;
  font-size: 0.78rem;
}

.actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

/* ============================================================
   BADGE / CALLOUT
   ============================================================ */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  color: var(--ink-muted);
  background: var(--surface-2);
  white-space: nowrap;
}

.badge.active {
  color: var(--bg-void);
  background: var(--sonar);
  border-color: var(--sonar);
}

.callout {
  background: var(--sonar-soft);
  border: 1px solid var(--sonar-glow);
  border-radius: var(--r);
  padding: 0.7rem 0.85rem;
  font-size: 0.87rem;
}

.callout strong { color: var(--ink-bright); }

/* ============================================================
   MESSAGES
   ============================================================ */
.message {
  padding: 0.75rem 0.9rem;
  border-radius: var(--r);
  font-weight: 500;
  margin-bottom: 1rem;
  border: 1px solid transparent;
}

.message.error {
  background: var(--hit-soft);
  border-color: rgba(244, 63, 94, 0.4);
  color: #fecaca;
}

.message.success {
  background: rgba(52, 211, 153, 0.12);
  border-color: rgba(52, 211, 153, 0.4);
  color: #a7f3d0;
}

.message.info {
  background: var(--sonar-soft);
  border-color: var(--sonar-glow);
  color: var(--sonar-bright);
}

/* ============================================================
   STATS / INFO GRID
   ============================================================ */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.55rem;
}

.stat {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 0.65rem 0.75rem;
  min-width: 0;
}

.stat .label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stat .value {
  margin-top: 0.3rem;
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--ink-bright);
  overflow-wrap: anywhere;
}

/* ============================================================
   GAME LIST / LEADERBOARD
   ============================================================ */
.game-list,
.leaderboard-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.game-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  transition: border-color 140ms, background 140ms;
}

.game-card:hover { border-color: var(--line-strong); }

.game-card.current {
  border-color: var(--sonar);
  background: var(--sonar-soft);
}

.game-card strong { color: var(--ink-bright); font-weight: 600; }

.game-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.game-actions button { padding: 0.38rem 0.7rem; font-size: 0.78rem; }

.leaderboard-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
}

.leaderboard-row strong {
  font-family: var(--font-display);
  color: var(--ink-bright);
  font-weight: 600;
}

.leaderboard-row.me {
  border-color: var(--ok);
  background: rgba(52, 211, 153, 0.08);
}

/* ============================================================
   SUMMARY GRID (Current Game stat strip)
   ============================================================ */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.6rem;
}

.summary-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

.summary-card .label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.summary-card .value {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ink-bright);
  overflow-wrap: anywhere;
}

.summary-card-emphasis {
  border-color: var(--sonar);
  background: var(--sonar-soft);
}

.summary-actions { margin-top: 0.25rem; }

/* ============================================================
   PLAYER PILLS (with pulsing active-turn indicator)
   ============================================================ */
.players-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.6rem;
}

.player-pill {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 0.7rem 0.85rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  position: relative;
}

.player-pill strong {
  color: var(--ink-bright);
  font-family: var(--font-display);
  font-weight: 600;
}

.player-pill.turn {
  border-color: var(--alert);
  background: var(--alert-soft);
}

.player-pill.turn::after {
  content: "";
  position: absolute;
  top: 0.65rem; right: 0.7rem;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--alert);
  box-shadow: 0 0 8px var(--alert);
  animation: pulse 1.5s ease-in-out infinite;
}

.player-pill.eliminated {
  opacity: 0.55;
  border-style: dashed;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(1.4); }
}

/* ============================================================
   BOARDS
   ============================================================ */
.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 1rem;
}

.board-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.board-head h3 {
  font-family: var(--font-display);
  font-weight: 700;
}

.board {
  display: inline-grid;
  gap: 3px;
  background: var(--bg-void);
  padding: 8px;
  border-radius: var(--r);
  border: 1px solid var(--line-strong);
  width: fit-content;
  max-width: 100%;
  overflow: auto;
}

.board-row {
  display: flex;
  gap: 3px;
}

.cell, .axis-cell {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  user-select: none;
  flex-shrink: 0;
}

.axis-cell {
  background: transparent;
  color: var(--ink-dim);
  font-weight: 500;
}

.cell {
  background: #0a1835;               /* dark navy water */
  border: 1px solid rgba(96, 165, 250, 0.18);
  color: transparent;
  transition: background 100ms, border-color 100ms;
}

.cell.interactive { cursor: crosshair; }
.cell.interactive:hover {
  background: var(--sonar-soft);
  border-color: var(--sonar);
}

/* ---- OWN BOARD ---- */
/* Your placed ships: green */
.board-self .cell.ship {
  background: #22c55e;
  border-color: rgba(5, 8, 15, 0.55);
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.6);
}

/* Your ship got hit: red */
.board-self .cell.hit {
  background: #ef4444;
  border-color: #b91c1c;
  box-shadow: none;
}
.board-self .cell.hit::after { content: "✕"; color: #fff; font-weight: 700; }

/* Your fleet is fully sunk: dark red */
.board-self .cell.sunk {
  background: #7f1d1d;
  border-color: #450a0a;
  box-shadow: none;
}
.board-self .cell.sunk::after { content: "✕"; color: #fca5a5; font-weight: 700; }

/* ---- OPPONENT BOARD ---- */
/* You hit an enemy ship: orange */
.board-target .cell.hit {
  background: #f97316;
  border-color: #9a3412;
}
.board-target .cell.hit::after { content: "✕"; color: #fff7ed; font-weight: 700; }

/* You sunk the enemy's fleet: all their hit cells go red */
.board-target .cell.sunk {
  background: #ef4444;
  border-color: #7f1d1d;
}
.board-target .cell.sunk::after { content: "✕"; color: #fff; font-weight: 700; }

/* ---- SHARED ---- */
.cell.miss {
  background: var(--miss-soft);
  border-color: var(--miss);
}
.cell.miss::after { content: "·"; color: var(--miss); font-size: 1.3rem; line-height: 0; }

.cell.disabled { opacity: 0.55; cursor: not-allowed; }

.cell.droppable {
  outline: 1px dashed rgba(56, 189, 248, 0.35);
  outline-offset: -4px;
}

/* ============================================================
   SHIP / FLEET BUILDER  —  compact list, draggable SVG per ship
   ============================================================ */
.fleet-builder { gap: 0.9rem; }

.fleet-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.fleet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0.9rem;
  background: var(--surface-1);
  border: 1px solid var(--line-strong);
  border-radius: var(--r);
  min-width: 0;
  cursor: grab;
  min-height: 52px;
}

.fleet-row:active { cursor: grabbing; }

.fleet-row.placed {
  border-color: var(--ship);
  background: rgba(45, 212, 191, 0.08);
}

.ship-graphic {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
}

.ship-svg {
  display: block;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
  pointer-events: none; /* clicks/drags go through to the fleet-row */
}

.fleet-row-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.pill-tags {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  align-items: center;
}

/* ============================================================
   MOVE LOG
   ============================================================ */
.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.log {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-right: 0.3rem;
}

.log-item {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-strong);
  border-radius: var(--r-sm);
  padding: 0.55rem 0.7rem;
  font-size: 0.86rem;
}

.log-item strong { color: var(--ink-bright); }

.log::-webkit-scrollbar { width: 6px; }
.log::-webkit-scrollbar-track { background: transparent; }
.log::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 3px; }

/* ============================================================
   EMPTY STATE
   ============================================================ */
.empty-state {
  text-align: center;
  padding: 3rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.empty-state h2 {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--ink-bright);
}

.empty-state::before {
  content: "";
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, var(--sonar) 0 6%, transparent 7%),
    radial-gradient(circle at center, transparent 0 28%, var(--sonar-glow) 29% 31%, transparent 32%),
    radial-gradient(circle at center, transparent 0 58%, var(--sonar-glow) 59% 61%, transparent 62%);
  opacity: 0.7;
  margin-bottom: 0.5rem;
}

.empty-state p { color: var(--ink-muted); max-width: 42ch; }

.compact-form { padding-bottom: 0.3rem; border-bottom: 1px solid var(--line); }

/* ============================================================
   RESPONSIVE
   ============================================================ */
@media (max-width: 1000px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar,
  .game-col,
  main.stack { grid-column: auto; }
  .hero { flex-direction: column; align-items: flex-start; }
  .boards-grid { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  #app { padding: 1rem 0.9rem 2rem; }
  .cell, .axis-cell { width: 28px; height: 28px; font-size: 0.7rem; }
  .row, .info-grid, .summary-grid { grid-template-columns: 1fr 1fr; }
}

/* ============================================================
   SERVER SWITCHER
   ============================================================ */
.server-panel select {
  font-size: 0.82rem;
}

.server-status.online {
  color: var(--bg-void);
  background: var(--ok);
  border-color: var(--ok);
}

.server-status.offline {
  color: var(--ink-bright);
  background: var(--hit-soft);
  border-color: var(--hit);
}

.server-status.checking {
  color: var(--bg-void);
  background: var(--alert);
  border-color: var(--alert);
}
