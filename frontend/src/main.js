const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STORAGE_KEY = 'battleship-phase2-state';

const state = {
  username: '',
  playerId: null,
  activeGameId: null,
  currentGame: null,
  myStats: null,
  myShips: [],
  pendingShips: [],
  pendingFleet: createDefaultFleet(),
  moveHistory: [],
  games: [],
  leaderboard: [],
  error: '',
  success: '',
  pollHandle: null,
  busy: false,
  joinGameIdDraft: '',
  currentPage: 1,
  gamesPerPage: 5,
};

loadLocalState();
bootstrap();


function createDefaultFleet() {
  return [
    { id: 'carrier', name: 'Carrier', length: 5, orientation: 'horizontal', row: null, col: null },
    { id: 'battleship', name: 'Battleship', length: 4, orientation: 'horizontal', row: null, col: null },
    { id: 'cruiser', name: 'Cruiser', length: 3, orientation: 'horizontal', row: null, col: null },
  ];
}

function normalizePendingFleet(rawFleet) {
  const defaults = createDefaultFleet();
  if (!Array.isArray(rawFleet)) {
    return defaults;
  }

  return defaults.map((baseShip) => {
    const found = rawFleet.find((ship) => ship?.id === baseShip.id) || {};
    const orientation = found.orientation === 'vertical' ? 'vertical' : 'horizontal';
    const row = Number.isInteger(found.row) ? found.row : null;
    const col = Number.isInteger(found.col) ? found.col : null;
    return {
      ...baseShip,
      orientation,
      row,
      col,
    };
  });
}

function isPendingShipPlaced(ship) {
  return Number.isInteger(ship?.row) && Number.isInteger(ship?.col);
}

function getShipCells(ship, orientation = ship?.orientation, row = ship?.row, col = ship?.col) {
  if (!ship || !Number.isInteger(row) || !Number.isInteger(col)) {
    return [];
  }

  return Array.from({ length: ship.length }, (_, index) => ({
    row: row + (orientation === 'vertical' ? index : 0),
    col: col + (orientation === 'horizontal' ? index : 0),
    shipId: ship.id,
  }));
}

function getPendingShipCells(excludeShipId = null) {
  return state.pendingFleet.flatMap((ship) => (ship.id === excludeShipId ? [] : getShipCells(ship)));
}

function syncPendingShipsFromFleet() {
  state.pendingShips = getPendingShipCells().map(({ row, col }) => ({ row, col }));
}

function fleetPlacementSummary() {
  const placed = state.pendingFleet.filter(isPendingShipPlaced).length;
  return `${placed}/${state.pendingFleet.length} ships placed`;
}

function getPendingShipById(shipId) {
  return state.pendingFleet.find((ship) => ship.id === shipId) || null;
}

function assertPlacementPhase() {
  ensurePlayerReady();
  ensureCurrentGame();

  if (!getCurrentPlayer()) {
    throw new Error('Join this game before placing ships');
  }

  if (myPlacementSubmitted()) {
    throw new Error('Your ships are already placed for this game');
  }

  if (state.currentGame?.status !== 'waiting') {
    throw new Error('Ship placement is only available before the game starts');
  }
}

function validatePendingShipPlacement(ship, row, col, orientation = ship.orientation) {
  const gridSize = state.currentGame?.grid_size || 8;
  const cells = getShipCells(ship, orientation, row, col);
  if (!cells.length) {
    throw new Error('Unable to place that ship');
  }

  if (cells.some((cell) => cell.row < 0 || cell.row >= gridSize || cell.col < 0 || cell.col >= gridSize)) {
    throw new Error(`${ship.name} does not fit there`);
  }

  const occupied = new Set(getPendingShipCells(ship.id).map((cell) => `${cell.row},${cell.col}`));
  if (cells.some((cell) => occupied.has(`${cell.row},${cell.col}`))) {
    throw new Error(`${ship.name} overlaps another ship`);
  }
}

function placePendingShip(shipId, row, col) {
  assertPlacementPhase();
  const ship = getPendingShipById(shipId);
  if (!ship) {
    throw new Error('That ship is no longer available');
  }

  validatePendingShipPlacement(ship, row, col, ship.orientation);

  state.pendingFleet = state.pendingFleet.map((entry) => (
    entry.id === shipId
      ? { ...entry, row, col }
      : entry
  ));
  syncPendingShipsFromFleet();
  persistLocalState();
  render();
}

function rotatePendingShip(shipId) {
  assertPlacementPhase();
  const ship = getPendingShipById(shipId);
  if (!ship) {
    throw new Error('That ship is no longer available');
  }

  const nextOrientation = ship.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  if (isPendingShipPlaced(ship)) {
    validatePendingShipPlacement(ship, ship.row, ship.col, nextOrientation);
  }

  state.pendingFleet = state.pendingFleet.map((entry) => (
    entry.id === shipId
      ? { ...entry, orientation: nextOrientation }
      : entry
  ));
  syncPendingShipsFromFleet();
  persistLocalState();
  render();
}

function resetPendingShip(shipId) {
  assertPlacementPhase();
  state.pendingFleet = state.pendingFleet.map((entry) => (
    entry.id === shipId
      ? { ...entry, row: null, col: null }
      : entry
  ));
  syncPendingShipsFromFleet();
  persistLocalState();
  render();
}

function clearPendingFleet() {
  assertPlacementPhase();
  state.pendingFleet = createDefaultFleet();
  syncPendingShipsFromFleet();
  persistLocalState();
  render();
}
function bootstrap() {
  attachGlobalEvents();
  render();

  Promise.allSettled([
    refreshLobby(),
    refreshLeaderboard(),
    state.playerId ? refreshStats() : Promise.resolve(),
    state.activeGameId ? refreshCurrentGame(true) : Promise.resolve(),
  ]).finally(() => {
    if (state.activeGameId) {
      startPolling();
    }
  });
}

function attachGlobalEvents() {
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleChange);
  document.addEventListener('dragstart', handleDragStart);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('drop', handleDrop);
}


function handleDragStart(event) {
  const ship = event.target.closest('[data-draggable-ship-id]');
  if (!ship || !event.dataTransfer) {
    return;
  }

  event.dataTransfer.setData('text/plain', ship.dataset.draggableShipId);
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
  const dropCell = event.target.closest('[data-drop-ship-cell="true"]');
  if (!dropCell) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function handleDrop(event) {
  const dropCell = event.target.closest('[data-drop-ship-cell="true"]');
  if (!dropCell) {
    return;
  }

  event.preventDefault();
  const shipId = event.dataTransfer?.getData('text/plain');
  if (!shipId) {
    return;
  }

  clearMessages();
  try {
    placePendingShip(shipId, Number(dropCell.dataset.row), Number(dropCell.dataset.col));
  } catch (error) {
    showError(error.message);
  }
}

function captureRenderState() {
  const active = document.activeElement;
  if (!active || !('tagName' in active)) {
    return null;
  }

  const tagName = String(active.tagName || '').toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tagName)) {
    return null;
  }

  const selector = active.id
    ? `#${active.id}`
    : active.name
      ? `${active.tagName.toLowerCase()}[name="${active.name}"]`
      : null;

  if (!selector) {
    return null;
  }

  return {
    selector,
    value: 'value' in active ? active.value : null,
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}

function restoreRenderState(snapshot) {
  if (!snapshot?.selector) {
    return;
  }

  const nextActive = document.querySelector(snapshot.selector);
  if (!nextActive) {
    return;
  }

  if ('value' in nextActive && snapshot.value !== null) {
    nextActive.value = snapshot.value;
  }

  nextActive.focus();

  if (
    typeof nextActive.setSelectionRange === 'function' &&
    typeof snapshot.selectionStart === 'number' &&
    typeof snapshot.selectionEnd === 'number'
  ) {
    nextActive.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function normalizeStatus(status) {
  if (status === 'waiting_setup' || status === 'waiting') {
    return 'waiting';
  }
  if (status === 'playing' || status === 'active') {
    return 'active';
  }
  return status || 'waiting';
}

async function copyText(text) {
  if (!text) {
    throw new Error('Nothing to copy yet');
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(String(text));
    return;
  }

  const helper = document.createElement('textarea');
  helper.value = String(text);
  helper.setAttribute('readonly', 'readonly');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  document.execCommand('copy');
  document.body.removeChild(helper);
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'username') {
    state.username = target.value;
    persistLocalState();
    return;
  }

  if (target.name === 'game_id') {
    state.joinGameIdDraft = target.value;
    persistLocalState();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessages();
  const form = event.target;

  try {
    if (form.id === 'player-form') {
      await createOrLoadPlayer(new FormData(form));
    }
    if (form.id === 'create-game-form') {
      await createGame(new FormData(form));
    }
    if (form.id === 'join-by-id-form') {
      await joinGameByForm(new FormData(form));
    }
  } catch (error) {
    showError(error.message);
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }

  clearMessages();

  try {
    const action = target.dataset.action;

    if (action === 'prev-page') {
      if (state.currentPage > 1) {
        state.currentPage -= 1;
        render();
      }
      return;
    }

    if (action === 'next-page') {
      const totalPages = Math.max(1, Math.ceil(state.games.length / (state.gamesPerPage || 5)));
      if (state.currentPage < totalPages) {
        state.currentPage += 1;
        render();
      }
      return;
    }

    if (action === 'clear-session') {
      stopPolling();
      clearState();
      render();
      await refreshLobby();
      await refreshLeaderboard();
      return;
    }

    if (action === 'refresh-all') {
      await refreshAll();
      return;
    }

    if (action === 'join-game') {
      await joinGame(Number(target.dataset.gameId));
      return;
    }

    if (action === 'copy-game-id') {
      await copyText(target.dataset.gameId || state.activeGameId);
      showSuccess(`Game ID ${target.dataset.gameId || state.activeGameId} copied`);
      return;
    }

    if (action === 'open-game') {
      const nextGameId = Number(target.dataset.gameId);
      if (state.activeGameId !== nextGameId) {
        state.myShips = [];
        state.pendingFleet = createDefaultFleet();
        syncPendingShipsFromFleet();
        state.moveHistory = [];
      }
      state.activeGameId = nextGameId;
      persistLocalState();
      await refreshCurrentGame(true);
      startPolling();
      showSuccess(`Opened game ${state.activeGameId}`);
      return;
    }

    if (action === 'leave-current-game') {
      stopPolling();
      state.activeGameId = null;
      state.currentGame = null;
      state.myShips = [];
      state.pendingFleet = createDefaultFleet();
      syncPendingShipsFromFleet();
      state.moveHistory = [];
      persistLocalState();
      render();
      return;
    }

    if (action === 'rotate-pending-ship') {
      rotatePendingShip(target.dataset.shipId);
      return;
    }

    if (action === 'reset-pending-ship') {
      resetPendingShip(target.dataset.shipId);
      return;
    }

    if (action === 'clear-pending-ships') {
      clearPendingFleet();
      return;
    }

    if (action === 'submit-ships') {
      await submitShips();
      return;
    }

    if (action === 'start-game') {
      await startCurrentGame();
      return;
    }

    if (action === 'fire-shot') {
      await fireShot(
        Number(target.dataset.row),
        Number(target.dataset.col),
        Number(target.dataset.targetPlayerId)
      );
      return;
    }
  } catch (error) {
    showError(error.message);
  }
}

async function refreshAll() {
  await refreshLobby();
  await refreshLeaderboard();
  if (state.playerId) {
    await refreshStats();
  }
  if (state.activeGameId) {
    await refreshCurrentGame(true);
  } else {
    render();
  }
}

function clearState() {
  state.username = '';
  state.playerId = null;
  state.activeGameId = null;
  state.currentGame = null;
  state.myStats = null;
  state.myShips = [];
  state.pendingFleet = createDefaultFleet();
  syncPendingShipsFromFleet();
  state.moveHistory = [];
  state.error = '';
  state.success = '';
  state.joinGameIdDraft = '';
  localStorage.removeItem(STORAGE_KEY);
}

function persistLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      username: state.username,
      playerId: state.playerId,
      activeGameId: state.activeGameId,
      pendingShips: state.pendingShips,
      pendingFleet: state.pendingFleet,
      joinGameIdDraft: state.joinGameIdDraft,
    })
  );
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    state.username = parsed.username || '';
    state.playerId = parsed.playerId || null;
    state.activeGameId = parsed.activeGameId || null;
    state.pendingFleet = normalizePendingFleet(parsed.pendingFleet);
    syncPendingShipsFromFleet();
    state.joinGameIdDraft = parsed.joinGameIdDraft || '';
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function clearMessages() {
  state.error = '';
  state.success = '';
}

function showError(message) {
  state.error = humanizeError(message);
  state.success = '';
  render();
}

function showSuccess(message) {
  state.success = message;
  state.error = '';
  render();
}

function humanizeError(message) {
  const normalized = String(message || 'Something went wrong').trim();

  if (/not this player's turn|not your turn/i.test(normalized)) {
    return 'It is not your turn yet.';
  }
  if (/already been fired upon|already fired|cell already targeted/i.test(normalized)) {
    return 'That square was already targeted.';
  }
  if (/game is not active/i.test(normalized)) {
    return 'The game has not started yet.';
  }
  if (/all players must place ships/i.test(normalized)) {
    return 'Everyone has to place ships before the game can start.';
  }

  return normalized;
}

async function api(path, options = {}) {
  if (!API_BASE_URL) {
    throw new Error('Missing VITE_API_BASE_URL in the frontend environment');
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

function normalizePlayerResponse(payload) {
  return {
    id: payload?.player_id || payload?.id || null,
    username: payload?.username || payload?.display_name || state.username || '',
  };
}

function normalizeStats(stats) {
  if (!stats) {
    return null;
  }
  const shots = Number(stats.total_shots ?? stats.shots_fired ?? 0);
  const hits = Number(stats.total_hits ?? stats.hits ?? 0);
  return {
    id: stats.player_id || stats.id || null,
    username: stats.username || stats.display_name || '',
    games_played: Number(stats.games_played || 0),
    wins: Number(stats.wins || 0),
    losses: Number(stats.losses || 0),
    total_shots: shots,
    total_hits: hits,
    accuracy: Number(stats.accuracy || 0),
  };
}

function normalizeGame(raw) {
  if (!raw) {
    return null;
  }

  const players = Array.isArray(raw.players)
    ? raw.players.map((player) => ({
        id: player.player_id || player.id,
        player_id: player.player_id || player.id,
        username: player.username || player.display_name || 'Unknown',
        display_name: player.display_name || player.username || 'Unknown',
        turn_order: Number(player.turn_order || 0),
        placement_done: Boolean(player.placement_done),
        eliminated: Boolean(player.eliminated),
        eliminated_at: player.eliminated_at || null,
      }))
    : [];

  const currentPlayerId = raw.current_player_id || raw.current_turn || raw.current_turn_player_id || null;
  const currentPlayer = players.find((player) => player.player_id === currentPlayerId) || null;
  const winnerPlayer = players.find((player) => player.player_id === raw.winner_id) || null;

  return {
    id: Number(raw.game_id || raw.id),
    game_id: Number(raw.game_id || raw.id),
    status: normalizeStatus(raw.status),
    grid_size: Number(raw.grid_size || 8),
    max_players: Number(raw.max_players || players.length || 2),
    player_count: Number(raw.player_count || players.length),
    current_turn_index: Number(raw.current_turn_index || 0),
    current_player_id: currentPlayerId,
    current_player_username:
      raw.current_player_username || currentPlayer?.username || currentPlayer?.display_name || null,
    winner_id: raw.winner_id || null,
    winner_username:
      raw.winner_username || winnerPlayer?.username || winnerPlayer?.display_name || null,
    players,
  };
}

function normalizeGameList(rawGames) {
  if (!Array.isArray(rawGames)) {
    return [];
  }

  return rawGames.map((game) => ({
    id: Number(game.game_id || game.id),
    game_id: Number(game.game_id || game.id),
    status: normalizeStatus(game.status),
    grid_size: Number(game.grid_size || 8),
    max_players: Number(game.max_players || 2),
    player_count: Number(game.player_count || 0),
    open_seats: Math.max(0, Number(game.max_players || 2) - Number(game.player_count || 0)),
    winner_id: game.winner_id || null,
    created_at: game.created_at || null,
  }));
}

function normalizeMoves(raw) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.moves) ? raw.moves : [];

  return source.map((move) => ({
    move_id: move.move_id || move.id || null,
    player_id: move.player_id,
    username: move.username || move.display_name || 'Unknown',
    target_player_id: move.target_player_id || null,
    target_username: move.target_username || null,
    row: Number(move.row),
    col: Number(move.col),
    result: move.result,
    hit_player_id: move.hit_player_id || null,
    hit_username: move.hit_username || null,
    created_at: move.created_at || move.timestamp || null,
  }));
}

async function createOrLoadPlayer(formData) {
  const username = String(formData.get('username') || '').trim();
  if (!username) {
    throw new Error('Enter a username first');
  }

  let result;
  let loadedExisting = false;

  try {
    result = normalizePlayerResponse(
      await api('/api/players', {
        method: 'POST',
        body: JSON.stringify({ username }),
      })
    );
  } catch (error) {
    if (!/username already taken|conflict/i.test(String(error?.message || ''))) {
      throw error;
    }

    const players = await api('/api/players');
    const existingPlayer = (Array.isArray(players) ? players : []).find((player) => {
      const candidate = String(player?.username || player?.display_name || '').trim();
      return candidate === username || candidate.toLowerCase() === username.toLowerCase();
    });

    if (!existingPlayer) {
      throw new Error('That username already exists, but the player could not be loaded');
    }

    result = normalizePlayerResponse(existingPlayer);
    loadedExisting = true;
  }

  state.username = result.username || username;
  state.playerId = result.id;
  persistLocalState();
  await refreshStats();
  await refreshLeaderboard();
  showSuccess(loadedExisting ? `Loaded existing player: ${state.username}` : `Player ready: ${state.username}`);
}

async function createGame(formData) {
  ensurePlayerReady();

  const gridSize = Number(formData.get('grid_size'));
  const maxPlayers = Number(formData.get('max_players'));

  const rawGame = await api('/api/games', {
    method: 'POST',
    body: JSON.stringify({
      creator_id: state.playerId,
      username: state.username,
      grid_size: gridSize,
      max_players: maxPlayers,
    }),
  });

  state.activeGameId = Number(rawGame.game_id || rawGame.id);
  state.currentGame = normalizeGame(rawGame);
  state.myShips = [];
  state.pendingFleet = createDefaultFleet();
  syncPendingShipsFromFleet();
  state.moveHistory = [];
  persistLocalState();
  startPolling();
  await refreshAll();
  showSuccess(`Game ${state.activeGameId} created — share this Game ID with other players`);
}

async function joinGameByForm(formData) {
  const gameId = Number(formData.get('game_id'));
  state.joinGameIdDraft = String(formData.get('game_id') || '').trim();
  persistLocalState();
  if (!Number.isInteger(gameId) || gameId <= 0) {
    throw new Error('Enter a valid game ID');
  }
  await joinGame(gameId);
}

async function joinGame(gameId) {
  ensurePlayerReady();

  await api(`/api/games/${gameId}/join`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      username: state.username,
    }),
  });

  state.activeGameId = gameId;
  state.myShips = [];
  state.pendingFleet = createDefaultFleet();
  syncPendingShipsFromFleet();
  state.moveHistory = [];
  persistLocalState();
  startPolling();
  await refreshAll();
  state.joinGameIdDraft = '';
  persistLocalState();
  showSuccess(`Joined game ${gameId}`);
}

async function refreshLobby() {
  state.games = normalizeGameList(await api('/api/games'));
  render();
}

async function refreshLeaderboard() {
  try {
    state.leaderboard = (await api('/api/leaderboard')).map((row) => ({
      rank: Number(row.rank || 0),
      ...normalizeStats(row),
    }));
  } catch {
    state.leaderboard = [];
  }
  render();
}

async function refreshStats() {
  if (!state.playerId) {
    return;
  }

  state.myStats = normalizeStats(await api(`/api/players/${state.playerId}/stats`));
  render();
}

async function refreshCurrentGame(includeMoves = false) {
  if (!state.activeGameId) {
    return;
  }

  state.currentGame = normalizeGame(await api(`/api/games/${state.activeGameId}`));

  if (state.playerId) {
    try {
      state.myShips = await api(`/api/games/${state.activeGameId}/ships?player_id=${encodeURIComponent(state.playerId)}`);
    } catch {
      state.myShips = [];
    }
  }

  if (includeMoves) {
    state.moveHistory = normalizeMoves(await api(`/api/games/${state.activeGameId}/moves`));
  }

  if (state.currentGame?.status === 'finished') {
    stopPolling();
  }

  persistLocalState();
  render();
}

function startPolling() {
  stopPolling();
  state.pollHandle = window.setInterval(() => {
    Promise.allSettled([
      refreshLobby(),
      refreshLeaderboard(),
      state.playerId ? refreshStats() : Promise.resolve(),
      state.activeGameId ? refreshCurrentGame(true) : Promise.resolve(),
    ]);
  }, 2500);
}

function stopPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
    state.pollHandle = null;
  }
}

function ensurePlayerReady() {
  if (!state.playerId) {
    throw new Error('Create a player first');
  }
}

function ensureCurrentGame() {
  if (!state.activeGameId || !state.currentGame) {
    throw new Error('Open or join a game first');
  }
}

function getCurrentPlayer() {
  return state.currentGame?.players?.find((player) => player.player_id === state.playerId) || null;
}

function currentPlayerNameById(playerId) {
  return state.currentGame?.players?.find((player) => player.player_id === playerId)?.username || playerId;
}

function isMyTurn() {
  return state.currentGame?.status === 'active' && state.currentGame.current_player_id === state.playerId;
}

function myPlacementSubmitted() {
  return Boolean(getCurrentPlayer()?.placement_done);
}

function canStartCurrentGame() {
  if (!state.currentGame || state.currentGame.status !== 'waiting') {
    return false;
  }
  return state.currentGame.players.length >= 2 && state.currentGame.players.every((player) => player.placement_done);
}

async function submitShips() {
  ensurePlayerReady();
  ensureCurrentGame();

  const pendingShipCells = getPendingShipCells().map(({ row, col }) => ({ row, col }));
  if (!state.pendingFleet.every(isPendingShipPlaced) || pendingShipCells.length !== 12) {
    throw new Error('Place all 3 ships (lengths 5, 4, and 3) before submitting');
  }

  await api(`/api/games/${state.activeGameId}/ships`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      ships: pendingShipCells,
    }),
  });

  state.myShips = [...pendingShipCells];
  state.pendingFleet = createDefaultFleet();
  syncPendingShipsFromFleet();
  persistLocalState();
  await refreshAll();
  showSuccess('Fleet placed successfully');
}

async function startCurrentGame() {
  ensureCurrentGame();
  await api(`/api/games/${state.activeGameId}/start`, { method: 'POST', body: JSON.stringify({}) });
  await refreshAll();
  showSuccess('Game started');
}

function boardMovesForTarget(targetPlayerId) {
  return state.moveHistory.filter((move) => move.target_player_id === targetPlayerId);
}

function moveAtForTarget(targetPlayerId, row, col) {
  return boardMovesForTarget(targetPlayerId).find((move) => move.row === row && move.col === col) || null;
}

function canFireAt(targetPlayerId, row, col) {
  const normalizedTargetPlayerId = Number(targetPlayerId);
  const opponent = state.currentGame?.players?.find((player) => player.player_id === normalizedTargetPlayerId);
  return Boolean(
    isMyTurn() &&
      opponent &&
      !opponent.eliminated &&
      !moveAtForTarget(normalizedTargetPlayerId, row, col)
  );
}

async function fireShot(row, col, targetPlayerId) {
  ensurePlayerReady();
  ensureCurrentGame();

  if (!canFireAt(targetPlayerId, row, col)) {
    throw new Error('That square cannot be targeted right now');
  }

  const result = await api(`/api/games/${state.activeGameId}/moves`, {
    method: 'POST',
    body: JSON.stringify({
      player_id: state.playerId,
      target_player_id: targetPlayerId,
      row,
      col,
    }),
  });

  await refreshAll();

  if (result.winner_id) {
    showSuccess(`Winner: ${currentPlayerNameById(result.winner_id)}`);
    return;
  }

  if (result.result === 'sunk' && result.eliminated) {
    showSuccess(`${currentPlayerNameById(result.eliminated)} has been eliminated`);
    return;
  }

  showSuccess(result.result === 'hit' ? 'Hit' : 'Miss');
}

function render() {
  const app = document.getElementById('app');
  const snapshot = captureRenderState();
  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Phase 2 client</div>
        <h1>Battleship Arena</h1>
        <p>Lobby, multi-board battle view, live polling, move timeline, and leaderboard.</p>
      </div>
      <div class="actions">
        <button class="secondary" data-action="refresh-all">Refresh</button>
        <button class="ghost" data-action="clear-session">Clear Session</button>
      </div>
    </section>

    ${renderBanner()}

    <div class="layout">
      <div class="sidebar">
      <aside class="stack identity-col">
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
            <div class="stat"><div class="label">Player ID</div><div class="value wrap">${escapeHtml(state.playerId || '—')}</div></div>
            <div class="stat"><div class="label">Active Game ID</div><div class="value">${escapeHtml(state.activeGameId || '—')}</div></div>
          </div>
        </section>

        <section class="panel stack">
          <h2>Your Stats</h2>
          ${renderMyStats()}
        </section>

        <section class="panel stack">
          <div class="section-head">
            <h2>Leaderboard</h2>
            <span class="badge">Top ${Math.min(5, state.leaderboard.length)}</span>
          </div>
          ${renderLeaderboard()}
        </section>
      </aside>

      <aside class="stack lobby-col">
        <section class="panel stack">
          <h2>Create Game</h2>
          <form id="create-game-form" class="stack">
            <div class="row">
              <label>
                Grid Size
                <select name="grid_size">
                  ${[5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} × ${n}</option>`).join('')}
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
        </section>

        <section class="panel stack">
          <div class="section-head">
            <h2>Open Games</h2>
            <span class="badge">${state.games.filter((game) => game.status === 'waiting').length} waiting</span>
          </div>
          <form id="join-by-id-form" class="stack compact-form">
            <div class="callout">
              <strong>Joining a friend?</strong>
              <div class="small">Enter the Game ID shown in their lobby card or Active Game ID box.</div>
            </div>
            <label>
              Join by Game ID
              <input name="game_id" type="number" min="1" inputmode="numeric" value="${escapeHtml(state.joinGameIdDraft)}" placeholder="Example: 42" />
            </label>
            <button type="submit" class="secondary">Join This Game</button>
          </form>
          ${renderLobbyGames()}
        </section>
      </aside>
      </div>

      <main class="stack game-col">
        <section class="panel stack">
          <div class="section-head">
            <h2>Current Game</h2>
            ${state.currentGame ? `<button class="ghost" data-action="leave-current-game">Close Game View</button>` : ''}
          </div>
          ${renderCurrentGameSummary()}
        </section>

        ${state.currentGame ? `
          <section class="panel stack">
            <div class="section-head">
              <h2>Boards</h2>
              <span class="badge ${isMyTurn() ? 'active' : ''}">${isMyTurn() ? 'Your turn' : 'Watching'}</span>
            </div>
            <div class="boards-grid">
              ${renderMyBoardCard()}
              ${renderOpponentBoards()}
            </div>
          </section>

          <section class="panel stack">
            <div class="section-head">
              <h2>Move History</h2>
              <span class="badge">${state.moveHistory.length} moves</span>
            </div>
            ${renderMoveHistory()}
          </section>
        ` : `
          <section class="panel empty-state">
            <h2>No Game Open</h2>
            <p>Create a new lobby or join one from the list on the left.</p>
          </section>
        `}
      </main>
    </div>
  `;
  restoreRenderState(snapshot);
}

function renderBanner() {
  if (state.error) {
    return `<div class="message error">${escapeHtml(state.error)}</div>`;
  }
  if (state.success) {
    return `<div class="message success">${escapeHtml(state.success)}</div>`;
  }
  if (!state.playerId) {
    return `<div class="message info">Register a player, then create or join a game.</div>`;
  }
  if (!state.activeGameId) {
    return `<div class="message info">You are signed in as <strong>${escapeHtml(state.username)}</strong>. Pick an open game or start a new one.</div>`;
  }
  if (state.currentGame?.status === 'finished') {
    return `<div class="message success">Game over${state.currentGame.winner_username ? ` — winner: <strong>${escapeHtml(state.currentGame.winner_username)}</strong>` : ''}.</div>`;
  }
  if (state.currentGame?.status === 'waiting') {
    return `<div class="message info">Waiting for all players to place ships${canStartCurrentGame() ? ' — this game can start now.' : '.'}</div>`;
  }
  return `<div class="message info">${isMyTurn() ? 'It is your turn.' : `Waiting for ${escapeHtml(state.currentGame?.current_player_username || 'the next player')}.`}</div>`;
}

function renderLobbyGames() {
  if (!state.games.length) {
    return `<div class="small">No games yet.</div>`;
  }

  const perPage = state.gamesPerPage || 5;
  const totalPages = Math.max(1, Math.ceil(state.games.length / perPage));

  // Clamp the current page in case games were removed since last render.
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const start = (state.currentPage - 1) * perPage;
  const pageGames = state.games.slice(start, start + perPage);

  const paginationControls = totalPages > 1 ? `
    <div class="actions" style="justify-content: space-between; margin-top: 0.75rem;">
      <button class="ghost" data-action="prev-page" ${state.currentPage === 1 ? 'disabled' : ''}>Prev</button>
      <span class="small">Page ${state.currentPage} of ${totalPages} • ${state.games.length} games</span>
      <button class="ghost" data-action="next-page" ${state.currentPage === totalPages ? 'disabled' : ''}>Next</button>
    </div>
  ` : '';

  return `
    <div class="game-list">
      ${pageGames.map((game) => {
        const isOpen = game.status === 'waiting';
        const isCurrent = game.id === state.activeGameId;
        return `
          <div class="game-card ${isCurrent ? 'current' : ''}">
            <div>
              <strong>Game ${game.id}</strong>
              <div class="small">Game ID: <strong>${game.id}</strong> • ${game.grid_size}×${game.grid_size} • ${game.player_count}/${game.max_players} players</div>
            </div>
            <div class="game-actions">
              <span class="badge ${game.status === 'active' ? 'active' : ''}">${escapeHtml(game.status)}</span>
              <button class="ghost" data-action="copy-game-id" data-game-id="${game.id}">Copy ID</button>
              ${isCurrent ? `<button class="ghost" data-action="open-game" data-game-id="${game.id}">Open</button>` : ''}
              ${!isCurrent ? `<button class="ghost" data-action="open-game" data-game-id="${game.id}">View</button>` : ''}
              ${isOpen ? `<button data-action="join-game" data-game-id="${game.id}" ${!state.playerId ? 'disabled' : ''}>Join</button>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${paginationControls}
  `;
}

function renderMyStats() {
  if (!state.myStats) {
    return `<div class="small">No stats yet.</div>`;
  }

  return `
    <div class="info-grid">
      <div class="stat"><div class="label">Games</div><div class="value">${state.myStats.games_played}</div></div>
      <div class="stat"><div class="label">Wins</div><div class="value">${state.myStats.wins}</div></div>
      <div class="stat"><div class="label">Losses</div><div class="value">${state.myStats.losses}</div></div>
      <div class="stat"><div class="label">Shots</div><div class="value">${state.myStats.total_shots}</div></div>
      <div class="stat"><div class="label">Hits</div><div class="value">${state.myStats.total_hits}</div></div>
      <div class="stat"><div class="label">Accuracy</div><div class="value">${(state.myStats.accuracy * 100).toFixed(1)}%</div></div>
    </div>
  `;
}

function renderLeaderboard() {
  if (!state.leaderboard.length) {
    return `<div class="small">Leaderboard will appear after players start finishing games.</div>`;
  }

  const topFive = state.leaderboard.slice(0, 5);

  return `
    <div class="leaderboard-list">
      ${topFive.map((entry) => `
        <div class="leaderboard-row ${entry.id === state.playerId ? 'me' : ''}">
          <div>
            <strong>#${entry.rank} ${escapeHtml(entry.username || 'Unknown')}</strong>
            <div class="small">${entry.wins} wins • ${(entry.accuracy * 100).toFixed(1)}% accuracy</div>
          </div>
          <div class="small">${entry.total_shots} shots</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCurrentGameSummary() {
  if (!state.currentGame) {
    return `<div class="small">Open a game to see the battle view.</div>`;
  }

  return `
    <div class="summary-grid">
      <div class="summary-card summary-card-emphasis">
        <div class="label">Game ID</div>
        <div class="value">${state.currentGame.game_id}</div>
        <div class="summary-actions">
          <button class="ghost small-button" data-action="copy-game-id" data-game-id="${state.currentGame.game_id}">Copy ID</button>
        </div>
      </div>
      <div class="summary-card">
        <div class="label">Status</div>
        <div class="value">${escapeHtml(state.currentGame.status)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Grid</div>
        <div class="value">${state.currentGame.grid_size} × ${state.currentGame.grid_size}</div>
      </div>
      <div class="summary-card">
        <div class="label">Players</div>
        <div class="value">${state.currentGame.players.length}/${state.currentGame.max_players}</div>
      </div>
      <div class="summary-card">
        <div class="label">Current Turn</div>
        <div class="value">${escapeHtml(state.currentGame.current_player_username || '—')}</div>
      </div>
    </div>

    <div class="players-strip">
      ${state.currentGame.players.map((player) => `
        <div class="player-pill ${player.player_id === state.currentGame.current_player_id ? 'turn' : ''} ${player.eliminated ? 'eliminated' : ''}">
          <div>
            <strong>${escapeHtml(player.username)}</strong>
            <div class="small">Turn ${player.turn_order + 1}</div>
          </div>
          <div class="pill-tags">
            ${player.placement_done ? '<span class="badge">Placed</span>' : '<span class="badge">Waiting</span>'}
            ${player.eliminated ? '<span class="badge">Eliminated</span>' : ''}
            ${player.player_id === state.currentGame.current_player_id ? '<span class="badge active">Current</span>' : ''}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="actions">
      <button class="secondary" data-action="start-game" ${canStartCurrentGame() ? '' : 'disabled'}>Start Game</button>
    </div>
  `;
}

function renderMyBoardCard() {
  const currentPlayer = getCurrentPlayer();
  const placementNote = !currentPlayer
    ? 'You are viewing this game, but you have not joined it.'
    : myPlacementSubmitted()
      ? 'Your fleet is locked in and incoming shots show here.'
      : `Drag the 5, 4, and 3 length ships onto your board. ${fleetPlacementSummary()}.`;

  return `
    <section class="board-card stack">
      <div class="board-head">
        <div>
          <h3>Your Board</h3>
          <div class="small">${escapeHtml(placementNote)}</div>
        </div>
        <div class="pill-tags">
          ${myPlacementSubmitted() ? '<span class="badge active">Placed</span>' : '<span class="badge">Setup</span>'}
        </div>
      </div>
      ${!myPlacementSubmitted() && currentPlayer ? renderFleetBuilder() : ''}
      ${renderBoard({
        boardType: 'self',
        playerId: state.playerId,
        title: 'Your board',
      })}
      <div class="actions">
        <button data-action="submit-ships" ${canSubmitShips() ? '' : 'disabled'}>Submit Fleet</button>
        <button class="secondary" data-action="clear-pending-ships" ${canClearPendingShips() ? '' : 'disabled'}>Reset Fleet</button>
      </div>
    </section>
  `;
}


function renderFleetBuilder() {
  return `
    <div class="fleet-builder stack">
      <div class="callout">
        <strong>Place your fleet</strong>
        <div class="small">Drag a ship row onto your board. Use Rotate to switch orientation.</div>
      </div>
      <div class="fleet-list">
        ${state.pendingFleet.map((ship) => {
          const placed = isPendingShipPlaced(ship);
          const status = placed ? `at (${ship.row}, ${ship.col})` : 'not placed';
          return `
            <div class="fleet-row ${placed ? 'placed' : ''}" draggable="true" data-draggable-ship-id="${ship.id}">
              <div class="fleet-row-info">
                <strong>${escapeHtml(ship.name)}</strong>
                <div class="small">Length ${ship.length} • ${escapeHtml(ship.orientation)} • ${escapeHtml(status)}</div>
              </div>
              <div class="fleet-row-actions">
                <button type="button" class="ghost small-button" data-action="rotate-pending-ship" data-ship-id="${ship.id}">Rotate</button>
                <button type="button" class="ghost small-button" data-action="reset-pending-ship" data-ship-id="${ship.id}" ${placed ? '' : 'disabled'}>Remove</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderOpponentBoards() {
  const opponents = state.currentGame.players.filter((player) => player.player_id !== state.playerId);
  if (!opponents.length) {
    return `<div class="board-card"><div class="small">Waiting for opponents to join.</div></div>`;
  }

  return opponents.map((player) => `
    <section class="board-card stack">
      <div class="board-head">
        <div>
          <h3>${escapeHtml(player.username)}</h3>
          <div class="small">${player.eliminated ? 'Eliminated' : 'Fire on this board when it is your turn.'}</div>
        </div>
        <div class="pill-tags">
          ${player.eliminated ? '<span class="badge">Eliminated</span>' : ''}
          ${player.player_id === state.currentGame.current_player_id ? '<span class="badge active">Current</span>' : ''}
        </div>
      </div>
      ${renderBoard({
        boardType: 'target',
        playerId: player.player_id,
        title: player.username,
      })}
    </section>
  `).join('');
}

function renderBoard({ boardType, playerId }) {
  const gridSize = state.currentGame?.grid_size || 8;
  const header = `
    <div class="board-row">
      <div class="axis-cell"></div>
      ${Array.from({ length: gridSize }, (_, index) => `<div class="axis-cell">${index}</div>`).join('')}
    </div>
  `;

  const rows = Array.from({ length: gridSize }, (_, row) => {
    const cells = Array.from({ length: gridSize }, (_, col) => renderCell({ boardType, playerId, row, col })).join('');
    return `<div class="board-row"><div class="axis-cell">${row}</div>${cells}</div>`;
  }).join('');

  return `<div class="board">${header}${rows}</div>`;
}

function renderCell({ boardType, playerId, row, col }) {
  const classes = ['cell'];
  let label = '';
  let attrs = '';

  if (boardType === 'self') {
    const liveShipCells = myPlacementSubmitted() ? state.myShips : state.pendingShips;
    const hasShip = liveShipCells.some((ship) => ship.row === row && ship.col === col);
    const incomingMove = moveAtForTarget(playerId, row, col);

    if (hasShip) {
      classes.push('ship');
      label = 'S';
    }

    if (incomingMove) {
      const impactClass = incomingMove.result === 'sunk' ? 'sunk' : incomingMove.result === 'hit' ? 'hit' : 'miss';
      classes.push(impactClass);
      label = impactClass === 'miss' ? '•' : 'X';
    }

    if (getCurrentPlayer() && !myPlacementSubmitted() && state.currentGame?.status === 'waiting') {
      classes.push('interactive', 'droppable');
      attrs = `data-drop-ship-cell="true" data-row="${row}" data-col="${col}"`;
    } else {
      classes.push('disabled');
    }
  }

  if (boardType === 'target') {
    const move = moveAtForTarget(playerId, row, col);

    if (move) {
      const impactClass = move.result === 'sunk' ? 'sunk' : move.result === 'hit' ? 'hit' : 'miss';
      classes.push(impactClass);
      label = impactClass === 'miss' ? '•' : 'X';
    }

    if (canFireAt(playerId, row, col)) {
      classes.push('interactive');
      attrs = `data-action="fire-shot" data-row="${row}" data-col="${col}" data-target-player-id="${playerId}"`;
    } else {
      classes.push('disabled');
    }
  }

  return `<button class="${classes.join(' ')}" ${attrs} ${attrs ? '' : 'disabled'}>${label}</button>`;
}

function renderMoveHistory() {
  if (!state.moveHistory.length) {
    return `<div class="small">No shots fired yet.</div>`;
  }

  return `
    <div class="log">
      ${[...state.moveHistory].reverse().map((move) => {
        const stamp = formatTimestamp(move.created_at);
        const targetName = move.target_username || currentPlayerNameById(move.target_player_id);
        const result = move.result === 'hit' ? 'HIT' : move.result === 'sunk' ? 'SUNK' : 'MISS';
        return `
          <div class="log-item">
            <div class="log-head">
              <strong>${escapeHtml(move.username)}</strong>
              <span class="small">${escapeHtml(stamp)}</span>
            </div>
            <div>
              Fired at <strong>${escapeHtml(targetName)}</strong> on (${move.row}, ${move.col}) — <strong>${result}</strong>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function formatTimestamp(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function canSubmitShips() {
  return Boolean(getCurrentPlayer())
    && state.currentGame.status === 'waiting'
    && !myPlacementSubmitted()
    && state.pendingFleet.every(isPendingShipPlaced)
    && getPendingShipCells().length === 12;
}

function canClearPendingShips() {
  return Boolean(getCurrentPlayer())
    && state.currentGame.status === 'waiting'
    && !myPlacementSubmitted()
    && state.pendingFleet.some(isPendingShipPlaced);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
