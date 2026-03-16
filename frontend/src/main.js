const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STORAGE_KEY = 'battleship-vanilla-state';

const state = {
  username: '',
  playerId: null,
  gameId: null,
  game: null,
  stats: null,
  moves: [],
  myShips: [],
  placingShips: [],
  loading: false,
  error: '',
  success: '',
  pollHandle: null,
};

loadLocalState();
bootstrap();

function bootstrap() {
  render();
  attachGlobalEvents();

  if (state.playerId) {
    refreshStats().catch(() => {});
  }
  if (state.gameId) {
    refreshGame(true).catch(() => {});
    startPolling();
  }
}
function attachGlobalEvents() {
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'username') {
    state.username = target.value;
    persistLocalState();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessages();
  const form = event.target;

  try {
    if (form.id === 'player-form') {
      await createPlayer(new FormData(form));
    }
    if (form.id === 'create-game-form') {
      await createGame(new FormData(form));
    }
    if (form.id === 'join-game-form') {
      await joinGame(new FormData(form));
    }
  } catch (error) {
    showError(error.message);
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  clearMessages();

  try {
    if (action === 'clear-session') {
      stopPolling();
      clearState();
      render();
      return;
    }

    if (action === 'refresh-game') {
      await refreshGame(true);
      return;
    }

    if (action === 'cell-place') {
      const row = Number(target.dataset.row);
      const col = Number(target.dataset.col);
      toggleShipPlacement(row, col);
      return;
    }

    if (action === 'submit-placement') {
      await submitPlacement();
      return;
    }

    if (action === 'clear-placement') {
      state.placingShips = [];
      render();
      return;
    }

    if (action === 'cell-fire') {
      const row = Number(target.dataset.row);
      const col = Number(target.dataset.col);
      await fireShot(row, col);
      return;
    }
  } catch (error) {
    showError(error.message);
  }
}

function clearState() {
  state.username = '';
  state.playerId = null;
  state.gameId = null;
  state.game = null;
  state.stats = null;
  state.moves = [];
  state.myShips = [];
  state.placingShips = [];
  state.error = '';
  state.success = '';
  localStorage.removeItem(STORAGE_KEY);
}

function persistLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      username: state.username,
      playerId: state.playerId,
      gameId: state.gameId,
      myShips: state.myShips,
    })
  );
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.username = parsed.username || '';
    state.playerId = parsed.playerId || null;
    state.gameId = parsed.gameId || null;
    state.myShips = Array.isArray(parsed.myShips) ? parsed.myShips : [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function clearMessages() {
  state.error = '';
  state.success = '';
}

function showError(message) {
  state.error = message;
  state.success = '';
  render();
}

function showSuccess(message) {
  state.success = message;
  state.error = '';
  render();
}

async function api(path, options = {}) {
  if (!API_BASE_URL) {
    throw new Error('Missing VITE_API_BASE_URL in your frontend environment');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

async function createPlayer(formData) {
  const username = String(formData.get('username') || '').trim();
  if (!username) {
    throw new Error('Enter a username first');
  }

  const result = await api('/api/players', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });

  state.username = username;
  state.playerId = result.player_id;
  persistLocalState();
  await refreshStats();
  showSuccess(`Player ready: ${username} (ID ${result.player_id})`);
}

async function createGame(formData) {
  ensurePlayerReady();

  const gridSize = Number(formData.get('grid_size'));
  const maxPlayers = Number(formData.get('max_players'));

  const game = await api('/api/games', {
    method: 'POST',
    body: JSON.stringify({
      creator_id: state.playerId,
      grid_size: gridSize,
      max_players: maxPlayers,
    }),
  });

  state.gameId = game.game_id;
  state.game = game;
  state.moves = [];
  state.myShips = [];
  state.placingShips = [];
  persistLocalState();
  startPolling();
  await refreshGame(true);
  showSuccess(`Game ${game.game_id} created`);
}

async function joinGame(formData) {
  ensurePlayerReady();

  const gameId = Number(formData.get('game_id'));
  if (!Number.isInteger(gameId) || gameId <= 0) {
    throw new Error('Enter a valid game ID');
  }

  const result = await api(`/api/games/${gameId}/join`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      username: state.username,
    }),
  });

  state.gameId = gameId;
  state.game = result.game;
  state.moves = [];
  state.myShips = [];
  state.placingShips = [];
  persistLocalState();
  startPolling();
  await refreshGame(true);
  showSuccess(`Joined game ${gameId}`);
}

async function refreshStats() {
  if (!state.playerId) return;
  state.stats = await api(`/api/players/${state.playerId}/stats`);
  render();
}

async function refreshGame(fetchMoves = false) {
  if (!state.gameId) return;

  const game = await api(`/api/games/${state.gameId}`);
  state.game = game;

  const me = game.players.find((player) => player.player_id === state.playerId);
  const placementDone = Boolean(me?.placement_done);
  if (placementDone && state.myShips.length === 0 && state.placingShips.length === 3) {
    state.myShips = [...state.placingShips];
    persistLocalState();
  }

  if (fetchMoves) {
    const movesResult = await api(`/api/games/${state.gameId}/moves`);
    state.moves = movesResult.moves || [];
  }

  render();
}

function startPolling() {
  stopPolling();
  state.pollHandle = window.setInterval(() => {
    refreshGame(true).catch(() => {});
    refreshStats().catch(() => {});
  }, 2000);
}

function stopPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
}

function toggleShipPlacement(row, col) {
  ensurePlayerReady();
  ensureGameSelected();

  if (placementAlreadySubmitted()) {
    throw new Error('You already placed your ships for this game');
  }

  const existingIndex = state.placingShips.findIndex((ship) => ship.row === row && ship.col === col);
  if (existingIndex >= 0) {
    state.placingShips.splice(existingIndex, 1);
    render();
    return;
  }

  if (state.placingShips.length >= 3) {
    throw new Error('You can only choose exactly 3 ship cells');
  }

  state.placingShips.push({ row, col });
  render();
}

async function submitPlacement() {
  ensurePlayerReady();
  ensureGameSelected();

  if (state.placingShips.length !== 3) {
    throw new Error('Pick exactly 3 cells for your ships');
  }

  await api(`/api/games/${state.gameId}/place`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      ships: state.placingShips,
    }),
  });

  state.myShips = [...state.placingShips];
  persistLocalState();
  await refreshGame(true);
  showSuccess('Ships placed successfully');
}

async function fireShot(row, col) {
  ensurePlayerReady();
  ensureGameSelected();

  if (!canFireAt(row, col)) {
    throw new Error('That cell cannot be fired on right now');
  }

  const result = await api(`/api/games/${state.gameId}/fire`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      row,
      col,
    }),
  });

  await refreshGame(true);
  await refreshStats();

  if (result.game_status === 'finished') {
    if (result.winner_id === state.playerId) {
      showSuccess('You won the game');
    } else {
      showSuccess(`Game over. Winner ID: ${result.winner_id}`);
    }
  } else if (result.result === 'hit') {
    showSuccess('Hit');
  } else {
    showSuccess('Miss');
  }
}

function ensurePlayerReady() {
  if (!state.playerId) {
    throw new Error('Create a player first');
  }
}

function ensureGameSelected() {
  if (!state.gameId) {
    throw new Error('Create or join a game first');
  }
}

function getCurrentPlayer() {
  return state.game?.players?.find((player) => player.player_id === state.playerId) || null;
}

function placementAlreadySubmitted() {
  return Boolean(getCurrentPlayer()?.placement_done);
}

function isMyTurn() {
  return state.game?.current_player_id === state.playerId && state.game?.status === 'active';
}

function wasShotAt(row, col) {
  return state.moves.some((move) => move.row === row && move.col === col);
}

function moveAt(row, col) {
  return state.moves.find((move) => move.row === row && move.col === col) || null;
}

function canFireAt(row, col) {
  return isMyTurn() && !wasShotAt(row, col);
}

function getGridSize() {
  return state.game?.grid_size || 8;
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Battleship Arena</h1>
        <p>Plain JavaScript frontend for your Render backend.</p>
      </div>
      <div class="actions">
        <button class="secondary" data-action="refresh-game" ${state.gameId ? '' : 'disabled'}>Refresh</button>
        <button class="ghost" data-action="clear-session">Clear Session</button>
      </div>
    </section>

    ${renderMessages()}

    <div class="layout">
      <aside class="stack">
        <section class="panel stack">
          <h2>Player</h2>
          <form id="player-form" class="stack">
            <label>
              Username
              <input id="username" name="username" value="${escapeHtml(state.username)}" placeholder="Enter username" />
            </label>
            <button type="submit">Create / Load Player</button>
          </form>

          <div class="info-grid">
            <div class="stat"><div class="label">Player ID</div><div class="value">${state.playerId ?? '—'}</div></div>
            <div class="stat"><div class="label">Current Game</div><div class="value">${state.gameId ?? '—'}</div></div>
          </div>
        </section>

        <section class="panel stack">
          <h2>Game Setup</h2>
          <form id="create-game-form" class="stack">
            <div class="row">
              <label>
                Grid Size
                <select name="grid_size">
                  ${[5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} x ${n}</option>`).join('')}
                </select>
              </label>
              <label>
                Max Players
                <select name="max_players">
                  ${[2, 3, 4].map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
              </label>
            </div>
            <button type="submit">Create Game</button>
          </form>

          <form id="join-game-form" class="stack">
            <label>
              Join Existing Game ID
              <input name="game_id" type="number" min="1" placeholder="Game ID" />
            </label>
            <button type="submit" class="secondary">Join Game</button>
          </form>
        </section>

        <section class="panel stack">
          <h2>Stats</h2>
          ${renderStats()}
        </section>

        <section class="panel stack">
          <h2>Players</h2>
          ${renderPlayers()}
        </section>
      </aside>

      <main class="stack">
        <section class="panel stack">
          <div class="main-grid">
            ${renderPlacementBoard()}
            ${renderTargetBoard()}
          </div>
        </section>

        <section class="panel stack">
          <div class="board-head">
            <h2>Move Log</h2>
            <span class="badge">${state.moves.length} moves</span>
          </div>
          ${renderMoves()}
        </section>
      </main>
    </div>
  `;
}

function renderMessages() {
  if (state.error) {
    return `<div class="message error">${escapeHtml(state.error)}</div>`;
  }
  if (state.success) {
    return `<div class="message success">${escapeHtml(state.success)}</div>`;
  }
  if (!state.playerId) {
    return `<div class="message info">Create a player first, then create or join a game.</div>`;
  }
  if (!state.gameId) {
    return `<div class="message info">You are signed in as <strong>${escapeHtml(state.username)}</strong>. Create or join a game.</div>`;
  }
  return '';
}

function renderStats() {
  const stats = state.stats;
  if (!stats) {
    return `<div class="small">No stats yet.</div>`;
  }

  return `
    <div class="info-grid">
      <div class="stat"><div class="label">Games</div><div class="value">${stats.games_played}</div></div>
      <div class="stat"><div class="label">Wins</div><div class="value">${stats.wins}</div></div>
      <div class="stat"><div class="label">Losses</div><div class="value">${stats.losses}</div></div>
      <div class="stat"><div class="label">Shots</div><div class="value">${stats.total_shots}</div></div>
      <div class="stat"><div class="label">Hits</div><div class="value">${stats.total_hits}</div></div>
      <div class="stat"><div class="label">Accuracy</div><div class="value">${Number(stats.accuracy * 100).toFixed(1)}%</div></div>
    </div>
  `;
}

function renderPlayers() {
  if (!state.game?.players?.length) {
    return `<div class="small">No game loaded yet.</div>`;
  }

  return `
    <div class="player-list">
      ${state.game.players.map((player) => `
        <div class="player-pill">
          <div>
            <strong>${escapeHtml(player.username)}</strong>
            <div class="small">ID ${player.player_id} • Turn ${player.turn_order + 1}</div>
          </div>
          <div>
            ${player.player_id === state.game.current_player_id ? '<span class="badge active">Current Turn</span>' : ''}
            ${player.placement_done ? '<span class="badge">Placed</span>' : '<span class="badge">Not Placed</span>'}
            ${player.eliminated ? '<span class="badge">Eliminated</span>' : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPlacementBoard() {
  const currentPlayer = getCurrentPlayer();
  const gridSize = getGridSize();
  const shipCells = placementAlreadySubmitted() ? state.myShips : state.placingShips;
  const placementNote = !state.game
    ? 'Create or join a game to place ships.'
    : placementAlreadySubmitted()
      ? 'Your ships are locked in.'
      : `Choose exactly 3 cells. Selected: ${shipCells.length}/3`;

  return `
    <section class="board-card stack">
      <div class="board-head">
        <div>
          <h2>Your Ships</h2>
          <div class="small">${escapeHtml(placementNote)}</div>
        </div>
        <div>
          ${currentPlayer?.placement_done ? '<span class="badge active">Placed</span>' : '<span class="badge">Waiting</span>'}
        </div>
      </div>
      ${renderBoard({
        gridSize,
        type: 'placement',
        selectedShips: shipCells,
      })}
      <div class="actions">
        <button data-action="submit-placement" ${canSubmitPlacement() ? '' : 'disabled'}>Submit Ships</button>
        <button class="secondary" data-action="clear-placement" ${canClearPlacement() ? '' : 'disabled'}>Clear Selection</button>
      </div>
    </section>
  `;
}

function renderTargetBoard() {
  const gridSize = getGridSize();
  const turnText = !state.game
    ? 'No game selected.'
    : state.game.status === 'waiting'
      ? 'Waiting for all players to place ships.'
      : state.game.status === 'finished'
        ? `Game finished${state.game.winner_id ? `. Winner ID: ${state.game.winner_id}` : ''}`
        : isMyTurn()
          ? 'It is your turn. Click a cell to fire.'
          : `Waiting for player ${state.game.current_player_id}`;

  return `
    <section class="board-card stack">
      <div class="board-head">
        <div>
          <h2>Target Board</h2>
          <div class="small">${escapeHtml(turnText)}</div>
        </div>
        <div>
          <span class="badge ${isMyTurn() ? 'active' : ''}">${isMyTurn() ? 'Your Turn' : 'Stand By'}</span>
        </div>
      </div>
      ${renderBoard({
        gridSize,
        type: 'target',
        selectedShips: [],
      })}
    </section>
  `;
}

function renderBoard({ gridSize, type, selectedShips }) {
  const header = `
    <div class="board-row">
      <div class="axis-cell"></div>
      ${Array.from({ length: gridSize }, (_, index) => `<div class="axis-cell">${index}</div>`).join('')}
    </div>
  `;

  const rows = Array.from({ length: gridSize }, (_, row) => {
    const cells = Array.from({ length: gridSize }, (_, col) => renderCell({ row, col, type, selectedShips })).join('');
    return `<div class="board-row"><div class="axis-cell">${row}</div>${cells}</div>`;
  }).join('');

  return `<div class="board">${header}${rows}</div>`;
}

function renderCell({ row, col, type, selectedShips }) {
  const classes = ['cell'];
  let label = '';
  let attrs = '';

  const selected = selectedShips.some((ship) => ship.row === row && ship.col === col);
  const move = moveAt(row, col);

  if (type === 'placement') {
    if (selected) {
      classes.push('ship');
      label = 'S';
    }
    if (!placementAlreadySubmitted() && state.gameId) {
      classes.push('interactive');
      attrs = `data-action="cell-place" data-row="${row}" data-col="${col}"`;
    } else {
      classes.push('disabled');
    }
    if (move) {
      classes.push(move.result === 'hit' ? 'hit' : 'miss');
      label = move.result === 'hit' ? 'X' : '•';
    }
  }

  if (type === 'target') {
    if (move) {
      classes.push(move.result === 'hit' ? 'hit' : 'miss');
      label = move.result === 'hit' ? 'X' : '•';
    }
    if (canFireAt(row, col)) {
      classes.push('interactive');
      attrs = `data-action="cell-fire" data-row="${row}" data-col="${col}"`;
    } else {
      classes.push('disabled');
    }
  }

  return `<button class="${classes.join(' ')}" ${attrs} ${attrs ? '' : 'disabled'}>${label}</button>`;
}

function renderMoves() {
  if (!state.moves.length) {
    return `<div class="small">No shots fired yet.</div>`;
  }

  return `
    <div class="log">
      ${[...state.moves].reverse().map((move) => {
        const target = move.result === 'hit' && move.hit_username ? ` on ${move.hit_username}` : '';
        return `
          <div class="log-item">
            <strong>${escapeHtml(move.username)}</strong> fired at (${move.row}, ${move.col}) — ${move.result.toUpperCase()}${escapeHtml(target)}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function canSubmitPlacement() {
  return Boolean(state.gameId) && !placementAlreadySubmitted() && state.placingShips.length === 3;
}

function canClearPlacement() {
  return !placementAlreadySubmitted() && state.placingShips.length > 0;
}
