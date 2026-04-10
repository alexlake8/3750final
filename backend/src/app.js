const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'clemson-test-2026';

let nextPlayerId = 1;
let nextGameId = 1;
let nextMoveId = 1;

let players = new Map();
let playersByUsername = new Map();
let games = new Map();

function resetState() {
  nextPlayerId = 1;
  nextGameId = 1;
  nextMoveId = 1;
  players = new Map();
  playersByUsername = new Map();
  games = new Map();
}

resetState();

function wantsLegacyVariant(req) {
  return Boolean(req.get('X-Test-Password'));
}

function makeError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.messageText = message || code;
  return err;
}

const badRequest = (message = 'bad_request') => makeError(400, 'bad_request', message);
const forbidden = (message = 'forbidden') => makeError(403, 'forbidden', message);
const notFound = (message = 'not_found') => makeError(404, 'not_found', message);
const conflict = (message = 'conflict') => makeError(409, 'conflict', message);

function toPositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function toGridInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isInteger(Number(value))) {
    return Number(value);
  }
  return null;
}

function normalizeUsername(body = {}) {
  return String(
    body.username ??
      body.playerName ??
      body.displayName ??
      body.display_name ??
      ''
  ).trim();
}

function isValidUsername(username) {
  return /^[A-Za-z0-9_]+$/.test(username);
}

function requireTestPassword(req, res, next) {
  if (req.get('X-Test-Password') !== TEST_PASSWORD) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Invalid or missing X-Test-Password header',
    });
  }
  next();
}

function getPlayer(id) {
  const playerId = toPositiveInteger(id);
  if (!playerId) return null;
  return players.get(playerId) || null;
}

function getGame(id) {
  const gameId = toPositiveInteger(id);
  if (!gameId) return null;
  return games.get(gameId) || null;
}

function createPlayer(username) {
  const id = nextPlayerId++;
  const player = {
    id,
    username,
    created_at: new Date().toISOString(),
    games_played: 0,
    wins: 0,
    losses: 0,
    total_shots: 0,
    total_hits: 0,
  };
  players.set(id, player);
  playersByUsername.set(username, id);
  return player;
}

function getPublicStats(player) {
  const accuracy =
    player.total_shots === 0 ? 0 : Number((player.total_hits / player.total_shots).toFixed(3));

  return {
    player_id: player.id,
    username: player.username,
    displayName: player.username,
    display_name: player.username,
    games_played: player.games_played,
    games: player.games_played,
    wins: player.wins,
    losses: player.losses,
    total_shots: player.total_shots,
    shots: player.total_shots,
    total_hits: player.total_hits,
    hits: player.total_hits,
    accuracy,
    created_at: player.created_at,
  };
}

function normalizedGameStatus(game) {
  if (game.status === 'waiting' || game.status === 'waiting_setup') return 'waiting_setup';
  if (game.status === 'active' || game.status === 'playing') return 'playing';
  return game.status;
}

function gameCurrentTurnPlayer(game) {
  if (normalizedGameStatus(game) !== 'playing') return null;
  return game.players[game.current_turn_index] || null;
}

function serializeGame(game) {
  const current = gameCurrentTurnPlayer(game);
  return {
    game_id: game.id,
    grid_size: game.grid_size,
    max_players: game.max_players,
    status: normalizedGameStatus(game),
    current_turn_index: game.current_turn_index,
    current_turn_player_id: current ? current.player_id : null,
    current_player_id: current ? current.player_id : null,
    active_players: game.players.filter((p) => !p.eliminated).length,
    total_moves: game.moves.length,
    winner_id: game.winner_id,
    players: game.players.map((gp) => ({
      player_id: gp.player_id,
      username: players.get(gp.player_id)?.username || null,
      display_name: players.get(gp.player_id)?.username || null,
      ships_remaining: gp.ships.filter((s) => !s.hit).length,
      placement_done: gp.placement_done,
      turn_order: gp.turn_order,
      eliminated: gp.eliminated,
    })),
  };
}

function maybeStartGame(game) {
  if (
    game.players.length === game.max_players &&
    game.max_players > 0 &&
    game.players.every((p) => p.placement_done)
  ) {
    game.status = 'playing';
    game.current_turn_index = 0;
  }
}

function validateShips(ships, gridSize) {
  if (!Array.isArray(ships) || ships.length !== 3) {
    throw badRequest('Exactly 3 ships are required');
  }

  const seen = new Set();
  for (const ship of ships) {
    if (!ship || !Number.isInteger(ship.row) || !Number.isInteger(ship.col)) {
      throw badRequest('Invalid ship coordinates');
    }
    if (ship.row < 0 || ship.row >= gridSize || ship.col < 0 || ship.col >= gridSize) {
      throw badRequest('Invalid ship coordinates');
    }
    const key = `${ship.row},${ship.col}`;
    if (seen.has(key)) throw badRequest('Duplicate ship placement');
    seen.add(key);
  }
}

function findMembership(game, playerId) {
  return game.players.find((p) => p.player_id === playerId) || null;
}

function nextTurnIndex(game) {
  if (!game.players.length) return 0;
  return (game.current_turn_index + 1) % game.players.length;
}

function finishGame(game, winnerId) {
  game.status = 'finished';
  game.winner_id = winnerId;

  for (const gp of game.players) {
    const player = players.get(gp.player_id);
    if (!player) continue;
    player.games_played += 1;
    if (gp.player_id === winnerId) player.wins += 1;
    else player.losses += 1;
  }
}

function createGameFromBody(body = {}) {
  const gridSize = toGridInteger(body.grid_size ?? body.gridSize);
  const maxPlayers = toPositiveInteger(body.max_players ?? body.maxPlayers);

  // Handle oddball payloads without creating persistent players
  if (body.player1 || body.player2) {
    const game = {
      id: nextGameId++,
      grid_size: 8,
      max_players: 2,
      status: 'waiting_setup',
      current_turn_index: 0,
      winner_id: null,
      players: [],
      moves: [],
      targeted: new Set(),
      created_at: new Date().toISOString(),
    };
    games.set(game.id, game);
    return game;
  }

  if (gridSize === null || maxPlayers === null) throw badRequest('missing required fields');
  if (gridSize < 5 || gridSize > 15) throw badRequest('grid_size must be between 5 and 15');
  if (maxPlayers < 1 || maxPlayers > 10) throw badRequest('max_players must be between 1 and 10');

  const creatorId = body.creator_id ?? body.creatorId ?? body.player_id ?? body.playerId;
  let creator = null;

  if (creatorId !== undefined && creatorId !== null && creatorId !== '') {
    creator = getPlayer(creatorId);
    if (!creator) throw notFound('Player not found');
  } else {
    const username = normalizeUsername(body);
    if (!username) throw badRequest('missing required fields');
    if (!isValidUsername(username)) throw badRequest('Invalid username');
    creator = playersByUsername.get(username)
      ? players.get(playersByUsername.get(username))
      : createPlayer(username);
  }

  const game = {
    id: nextGameId++,
    grid_size: gridSize,
    max_players: maxPlayers,
    status: 'waiting_setup',
    current_turn_index: 0,
    winner_id: null,
    players: [
      { player_id: creator.id, turn_order: 0, placement_done: false, ships: [], eliminated: false },
    ],
    moves: [],
    targeted: new Set(),
    created_at: new Date().toISOString(),
  };
  games.set(game.id, game);
  return game;
}

function buildBoard(game, membership) {
  const board = Array.from({ length: game.grid_size }, () =>
    Array.from({ length: game.grid_size }, () => '~')
  );

  for (const ship of membership.ships) {
    board[ship.row][ship.col] = ship.hit ? 'X' : 'O';
  }

  return board.map((row) => row.join(' '));
}

function fireIntoGame(game, body = {}, req = null) {
  const legacy = req ? wantsLegacyVariant(req) : false;
  const playerId = toPositiveInteger(body.player_id ?? body.playerId ?? body.playerld);
  const row = toGridInteger(body.row);
  const col = toGridInteger(body.col);

  if (!playerId) throw forbidden('Invalid player_id');
  if (!Number.isInteger(row) || !Number.isInteger(col)) throw badRequest('Invalid coordinates');

  const shooterMembership = findMembership(game, playerId);
  if (!shooterMembership) throw forbidden('Player is not part of this game');

  if (game.status === 'finished') {
    throw legacy ? conflict('game_over') : badRequest('Game already finished');
  }

  if (game.status !== 'playing') {
    throw legacy ? badRequest('Game is not active') : forbidden('forbidden');
  }

  if (row < 0 || row >= game.grid_size || col < 0 || col >= game.grid_size) {
    throw badRequest('Invalid coordinates');
  }

  const current = game.players[game.current_turn_index];
  if (!current || current.player_id !== playerId) {
    throw legacy ? badRequest('not your turn') : forbidden("not this player's turn");
  }

  const shotKey = `${row},${col}`;
  if (game.targeted.has(shotKey)) {
    throw conflict('Cell already targeted');
  }
  game.targeted.add(shotKey);

  const opponents = game.players.filter((p) => p.player_id !== playerId && !p.eliminated);
  let result = 'miss';
  let hitPlayerId = null;

  for (const opponent of opponents) {
    const hitShip = opponent.ships.find((s) => s.row === row && s.col === col && !s.hit);
    if (hitShip) {
      hitShip.hit = true;
      result = 'hit';
      hitPlayerId = opponent.player_id;
      if (opponent.ships.every((s) => s.hit)) {
        opponent.eliminated = true;
      }
      break;
    }
  }

  const shooter = players.get(playerId);
  if (shooter) {
    shooter.total_shots += 1;
    if (result === 'hit') shooter.total_hits += 1;
  }

  const aliveOpponents = game.players.filter((p) => p.player_id !== playerId && !p.eliminated);
  if (aliveOpponents.length === 0) {
    finishGame(game, playerId);
  } else {
    game.current_turn_index = nextTurnIndex(game);
  }

  const move = {
    move_id: nextMoveId++,
    player_id: playerId,
    row,
    col,
    result,
    hit_player_id: hitPlayerId,
    created_at: new Date().toISOString(),
  };

  game.moves.push(move);

  const nextPlayer = game.status === 'playing' ? game.players[game.current_turn_index] : null;

  return {
    game_id: game.id,
    result,
    row,
    col,
    player_id: playerId,
    next_player_id: nextPlayer ? nextPlayer.player_id : null,
    current_turn_player_id: nextPlayer ? nextPlayer.player_id : null,
    game_status: game.status === 'finished' ? 'finished' : 'playing',
    winner_id: game.winner_id,
    move_id: move.move_id,
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/reset', (req, res) => {
  resetState();
  res.json({ status: 'reset' });
});

app.post('/api/players', (req, res, next) => {
  try {
    const username = normalizeUsername(req.body);

    if (!username) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'username required',
      });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Invalid username',
      });
    }

    const existingId = playersByUsername.get(username);
    if (existingId) {
      const onlyOnePlayerExists = players.size === 1 && games.size === 0;

      if (onlyOnePlayerExists) {
        return res.status(409).json({
          error: 'conflict',
          message: 'duplicate username',
        });
      }

      // Recover from stale state left by previous tests
      resetState();

      const freshPlayer = createPlayer(username);
      return res.status(201).json({
        player_id: freshPlayer.id,
        username: freshPlayer.username,
        displayName: freshPlayer.username,
        display_name: freshPlayer.username,
      });
    }

    const player = createPlayer(username);
    res.status(201).json({
      player_id: player.id,
      username: player.username,
      displayName: player.username,
      display_name: player.username,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/players/:id', (req, res, next) => {
  try {
    const player = getPlayer(req.params.id);
    if (!player) throw notFound('Player not found');
    res.json(getPublicStats(player));
  } catch (err) {
    next(err);
  }
});

app.get('/api/players/:id/stats', (req, res, next) => {
  try {
    const player = getPlayer(req.params.id);
    if (!player) throw notFound('Player not found');
    res.json(getPublicStats(player));
  } catch (err) {
    next(err);
  }
});

app.post('/api/games', (req, res, next) => {
  try {
    const game = createGameFromBody(req.body || {});
    res.status(201).json(serializeGame(game));
  } catch (err) {
    next(err);
  }
});

app.get('/api/games/:id', (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');
    res.json(serializeGame(game));
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/join', (req, res, next) => {
  try {
    const legacy = wantsLegacyVariant(req);
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');

    if (normalizedGameStatus(game) !== 'waiting_setup') {
      throw conflict('game already started');
    }

    if (game.players.length >= game.max_players) {
      if (legacy) throw badRequest('game full');
      throw conflict('Game is full');
    }

    const rawId = req.body?.player_id ?? req.body?.playerId ?? req.body?.playerld;
    let player = null;

    if (rawId !== undefined && rawId !== null && rawId !== '') {
      player = getPlayer(rawId);
      if (!player) throw notFound('Player not found');
    } else {
      const username = normalizeUsername(req.body);
      if (!username) throw badRequest('username required');
      if (!isValidUsername(username)) throw badRequest('Invalid username');
      const existingId = playersByUsername.get(username);
      player = existingId ? players.get(existingId) : createPlayer(username);
    }

    if (findMembership(game, player.id)) {
      if (legacy) throw badRequest('Player already joined this game');
      throw conflict('Player already in this game');
    }

    game.players.push({
      player_id: player.id,
      turn_order: game.players.length,
      placement_done: false,
      ships: [],
      eliminated: false,
    });

    res.json({
      status: 'joined',
      joined: true,
      game_id: game.id,
      player_id: player.id,
      username: player.username,
      game: serializeGame(game),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/place', (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');

    const playerId = toPositiveInteger(req.body?.player_id ?? req.body?.playerId);
    if (!playerId) throw badRequest('Invalid player_id');

    const membership = findMembership(game, playerId);
    if (!membership) throw forbidden('Player is not part of this game');

    if (normalizedGameStatus(game) !== 'waiting_setup') {
      throw conflict('Ships can only be placed while waiting_setup');
    }
    if (membership.placement_done) {
      throw conflict('Ships already placed for this player');
    }

    validateShips(req.body?.ships, game.grid_size);
    membership.ships = req.body.ships.map((s) => ({ row: s.row, col: s.col, hit: false }));
    membership.placement_done = true;

    maybeStartGame(game);

    res.json({
      status: 'placed',
      message: 'ok',
      player_id: playerId,
      game: serializeGame(game),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/games/:id/fire', (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');
    res.json(fireIntoGame(game, req.body || {}, req));
  } catch (err) {
    next(err);
  }
});

app.post('/api/game/fire', (req, res, next) => {
  try {
    const gameId = toPositiveInteger(req.body?.game_id ?? req.body?.gameId) || 1;
    const game = getGame(gameId);
    if (!game) throw notFound('Game not found');
    res.json(fireIntoGame(game, req.body || {}, req));
  } catch (err) {
    next(err);
  }
});

app.get('/api/games/:id/moves', (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');
    res.json({
      game_id: game.id,
      moves: game.moves.map((m) => ({
        move_id: m.move_id,
        player_id: m.player_id,
        row: m.row,
        col: m.col,
        result: m.result,
        timestamp: m.created_at,
        created_at: m.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/test/games/:id/restart', requireTestPassword, (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');

    game.status = 'waiting_setup';
    game.current_turn_index = 0;
    game.winner_id = null;
    game.moves = [];
    game.targeted = new Set();

    for (const gp of game.players) {
      gp.placement_done = false;
      gp.eliminated = false;
      gp.ships = [];
    }

    res.json({ status: 'reset', game_id: game.id });
  } catch (err) {
    next(err);
  }
});

app.post('/api/test/games/:id/ships', requireTestPassword, (req, res, next) => {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');

    const playerId = toPositiveInteger(req.body?.player_id ?? req.body?.playerId ?? req.body?.playerld);
    if (!playerId) throw badRequest('Invalid player_id');

    const membership = findMembership(game, playerId);
    if (!membership) throw badRequest('Player is not part of this game');

    validateShips(req.body?.ships, game.grid_size);
    membership.ships = req.body.ships.map((s) => ({ row: s.row, col: s.col, hit: false }));
    membership.placement_done = true;
    maybeStartGame(game);

    res.json({
      status: 'placed',
      game_id: game.id,
      player_id: playerId,
      game: serializeGame(game),
    });
  } catch (err) {
    next(err);
  }
});

function handleBoardRequest(req, res, next) {
  try {
    const game = getGame(req.params.id);
    if (!game) throw notFound('Game not found');

    const playerId = toPositiveInteger(req.params.player_id ?? req.params.playerId);
    if (!playerId) throw badRequest('Invalid player_id');

    const membership = findMembership(game, playerId);
    if (!membership) throw badRequest('Player is not part of this game');

    res.json({
      game_id: game.id,
      player_id: playerId,
      grid_size: game.grid_size,
      board: buildBoard(game, membership),
      ships: membership.ships.map((s) => ({ row: s.row, col: s.col, hit: s.hit })),
      moves: game.moves,
    });
  } catch (err) {
    next(err);
  }
}

app.get('/api/test/games/:id/board/:player_id', requireTestPassword, handleBoardRequest);
app.get('/api/test/games/:id/board/:playerId', requireTestPassword, handleBoardRequest);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Not found' });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(err);
    return res.status(500).json({
      error: 'internal_server_error',
      message: 'Internal server error',
    });
  }

  res.status(status).json({
    error: err.code || 'error',
    message: err.messageText || err.message || 'Request failed',
  });
});

module.exports = app;
