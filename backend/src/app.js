const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const TEST_MODE = String(process.env.TEST_MODE || 'false').toLowerCase() === 'true';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'clemson-test-2026';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*' }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.use((req, res, next) => {
  const contentType = req.get('Content-Type');
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && contentType && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const badRequest = (message) => makeError(400, message);
const forbidden = (message) => makeError(403, message);
const notFound = (message) => makeError(404, message);
const conflict = (message) => makeError(409, message);

function toPositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function toUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function normalizeName(body = {}) {
  return String(body.username || body.playerName || body.displayName || '').trim();
}

function serializePlayerSummary(player) {
  return {
    id: player.id,
    player_id: player.id,
    username: player.display_name,
    display_name: player.display_name,
    created_at: player.created_at,
  };
}

function serializeStats(player) {
  const totalHits = player.total_hits || 0;
  const totalShots = player.total_moves || 0;
  const accuracy = totalShots === 0 ? 0 : Number((totalHits / totalShots).toFixed(3));

  return {
    id: player.id,
    player_id: player.id,
    username: player.display_name,
    display_name: player.display_name,
    created_at: player.created_at,
    games_played: player.total_games,
    wins: player.total_wins,
    losses: player.total_losses,
    total_shots: totalShots,
    shots_fired: totalShots,
    total_hits: totalHits,
    hits: totalHits,
    accuracy,
  };
}

function serializeGame(game, players) {
  const alivePlayers = players.filter((player) => !player.eliminated_at);
  const currentPlayer = alivePlayers.find((player) => player.turn_order === game.current_turn_index) || null;

  return {
    id: Number(game.id),
    game_id: Number(game.id),
    grid_size: game.grid_size,
    max_players: game.max_players,
    status: game.status,
    player_count: players.length,
    current_turn_index: game.current_turn_index,
    current_turn: currentPlayer ? currentPlayer.player_id : null,
    current_player_id: currentPlayer ? currentPlayer.player_id : null,
    current_player_username: currentPlayer ? currentPlayer.display_name : null,
    active_players: alivePlayers.length,
    winner_id: game.winner_id,
    winner_username:
      players.find((player) => player.player_id === game.winner_id)?.display_name || null,
    created_at: game.created_at,
    finished_at: game.finished_at,
    players: players.map((player) => ({
      id: player.player_id,
      player_id: player.player_id,
      username: player.display_name,
      display_name: player.display_name,
      turn_order: player.turn_order,
      placement_done: player.placement_done,
      is_ai: player.is_ai,
      eliminated: Boolean(player.eliminated_at),
      eliminated_at: player.eliminated_at,
    })),
  };
}

function serializeGameListItem(row) {
  return {
    id: Number(row.id),
    game_id: Number(row.id),
    status: row.status,
    grid_size: row.grid_size,
    max_players: row.max_players,
    player_count: Number(row.player_count),
    open_seats: Math.max(0, Number(row.max_players) - Number(row.player_count)),
    current_turn_index: row.current_turn_index,
    winner_id: row.winner_id,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

function serializeShipRow(row) {
  return {
    row: row.row,
    col: row.col,
    sunk: Boolean(row.destroyed_at),
  };
}

function serializeMoveRow(row) {
  const timestamp = row.created_at || row.timestamp;
  return {
    move_id: row.move_id ?? row.id,
    player_id: row.player_id,
    username: row.display_name || row.username,
    target_player_id: row.target_player_id,
    target_username: row.target_display_name || row.target_username,
    row: row.row,
    col: row.col,
    result: row.result,
    hit_player_id: row.hit_player_id,
    hit_username: row.hit_display_name || row.hit_username,
    created_at: timestamp,
    timestamp,
  };
}

function validateCoordinates(ships, gridSize) {
  if (!Array.isArray(ships) || ships.length !== 3) {
    throw badRequest('Exactly 3 single-cell ships are required');
  }

  const seen = new Set();
  for (const ship of ships) {
    if (!ship || !Number.isInteger(ship.row) || !Number.isInteger(ship.col)) {
      throw badRequest('Ship coordinates must use integer row and col values');
    }
    if (ship.row < 0 || ship.row >= gridSize || ship.col < 0 || ship.col >= gridSize) {
      throw badRequest('Ship coordinates are out of bounds');
    }
    const key = `${ship.row},${ship.col}`;
    if (seen.has(key)) {
      throw badRequest('Duplicate ship coordinates are not allowed');
    }
    seen.add(key);
  }
}

async function getPlayerById(client, playerId) {
  const result = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
  return result.rows[0] || null;
}

async function getGameWithPlayers(client, gameId) {
  const gameResult = await client.query(
    `SELECT g.*, COUNT(gp.player_id)::int AS player_count
     FROM games g
     LEFT JOIN game_players gp ON gp.game_id = g.id
     WHERE g.id = $1
     GROUP BY g.id`,
    [gameId]
  );

  if (gameResult.rowCount === 0) {
    throw notFound('Game not found');
  }

  const playersResult = await client.query(
    `SELECT gp.game_id, gp.player_id, gp.turn_order, gp.placement_done, gp.is_ai, gp.eliminated_at,
            p.display_name
     FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = $1
     ORDER BY gp.turn_order ASC`,
    [gameId]
  );

  return {
    game: gameResult.rows[0],
    players: playersResult.rows,
  };
}

async function listGames(client) {
  const result = await client.query(
    `SELECT g.*, COUNT(gp.player_id)::int AS player_count
     FROM games g
     LEFT JOIN game_players gp ON gp.game_id = g.id
     GROUP BY g.id
     ORDER BY
       CASE g.status WHEN 'waiting' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
       g.id DESC`
  );

  return result.rows.map(serializeGameListItem);
}

async function listPlayers(client) {
  const result = await client.query(
    `SELECT *
     FROM players
     ORDER BY display_name ASC`
  );

  return result.rows.map(serializePlayerSummary);
}

async function upsertPlayerByName(client, displayName) {
  const normalized = String(displayName || '').trim();
  if (!normalized) {
    return null;
  }

  const existing = await client.query('SELECT * FROM players WHERE display_name = $1', [normalized]);
  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO players (id, display_name)
     VALUES ($1, $2)
     RETURNING *`,
    [crypto.randomUUID(), normalized]
  );

  return inserted.rows[0];
}

async function resolvePlayerIdentity(client, body = {}, options = {}) {
  const {
    allowCreationFromName = true,
    requireIdentity = true,
    rejectClientSuppliedPlayerId = false,
    createErrorMessage = 'player identity is required',
  } = options;

  const rawPlayerId = body.player_id ?? body.playerId ?? body.creator_id ?? body.creatorId;
  const rawName = normalizeName(body);

  if (rejectClientSuppliedPlayerId && rawPlayerId !== undefined) {
    throw badRequest('Client-supplied playerId is not allowed');
  }

  if (rawPlayerId !== undefined && rawPlayerId !== null && rawPlayerId !== '') {
    const playerId = toUuid(rawPlayerId);
    if (!playerId) {
      throw forbidden('Invalid player_id');
    }

    const player = await getPlayerById(client, playerId);
    if (!player) {
      throw forbidden('Invalid player_id');
    }

    if (rawName && rawName !== player.display_name) {
      throw badRequest('player_id does not match provided username');
    }

    return player;
  }

  if (!rawName) {
    if (requireIdentity) {
      throw badRequest(createErrorMessage);
    }
    return null;
  }

  if (!allowCreationFromName) {
    throw badRequest(createErrorMessage);
  }

  return upsertPlayerByName(client, rawName);
}

async function getStats(client, playerId) {
  const normalizedPlayerId = toUuid(playerId);
  if (!normalizedPlayerId) {
    throw notFound('Player not found');
  }

  const player = await getPlayerById(client, normalizedPlayerId);
  if (!player) {
    throw notFound('Player not found');
  }

  return serializeStats(player);
}

async function getShipsForPlayer(client, gameId, playerId) {
  const result = await client.query(
    `SELECT row, col, destroyed_at
     FROM ships
     WHERE game_id = $1 AND player_id = $2
     ORDER BY row ASC, col ASC`,
    [gameId, playerId]
  );

  return result.rows.map(serializeShipRow);
}

async function getMovesForGame(client, gameId) {
  const result = await client.query(
    `SELECT m.id AS move_id, m.row, m.col, m.result, m.created_at,
            m.player_id, p.display_name,
            m.target_player_id, tp.display_name AS target_display_name,
            m.hit_player_id, hp.display_name AS hit_display_name
     FROM moves m
     JOIN players p ON p.id = m.player_id
     JOIN players tp ON tp.id = m.target_player_id
     LEFT JOIN players hp ON hp.id = m.hit_player_id
     WHERE m.game_id = $1
     ORDER BY m.id ASC`,
    [gameId]
  );

  return result.rows.map(serializeMoveRow);
}

function nextAliveTurnOrder(players, currentTurnOrder) {
  const alive = players.filter((player) => !player.eliminated_at).sort((a, b) => a.turn_order - b.turn_order);
  if (alive.length <= 1) {
    return null;
  }

  const currentIndex = alive.findIndex((player) => player.turn_order === currentTurnOrder);
  if (currentIndex === -1) {
    return alive[0].turn_order;
  }

  return alive[(currentIndex + 1) % alive.length].turn_order;
}

async function finalizeGameStats(client, gameId, winnerId) {
  const participantsResult = await client.query(
    'SELECT player_id FROM game_players WHERE game_id = $1',
    [gameId]
  );
  const playerIds = participantsResult.rows.map((row) => row.player_id);

  if (playerIds.length === 0) {
    return;
  }

  await client.query(
    `UPDATE players
     SET total_games = total_games + 1,
         total_wins = total_wins + CASE WHEN id = $2 THEN 1 ELSE 0 END,
         total_losses = total_losses + CASE WHEN id <> $2 THEN 1 ELSE 0 END
     WHERE id = ANY($1::uuid[])`,
    [playerIds, winnerId]
  );
}

async function maybeActivateGame(client, gameId) {
  const { game, players } = await getGameWithPlayers(client, gameId);
  const enoughPlayers = players.length === game.max_players;
  const allPlaced = players.length > 0 && players.every((player) => player.placement_done);

  if (game.status === 'waiting' && enoughPlayers && allPlaced) {
    await client.query(
      `UPDATE games
       SET status = 'active', current_turn_index = 0
       WHERE id = $1`,
      [gameId]
    );

    const refreshed = await getGameWithPlayers(client, gameId);
    return serializeGame(refreshed.game, refreshed.players);
  }

  return serializeGame(game, players);
}

function requireTestMode(req, res, next) {
  if (!TEST_MODE) {
    return res.status(403).json({ error: 'Test mode is disabled' });
  }
  if (req.get('X-Test-Password') !== TEST_PASSWORD) {
    return res.status(403).json({ error: 'Invalid test password' });
  }
  next();
}

function resolveTargetPlayer(players, shooterId, requestedTargetId = null) {
  const aliveOpponents = players.filter((player) => player.player_id !== shooterId && !player.eliminated_at);
  if (aliveOpponents.length === 0) {
    return null;
  }
  if (requestedTargetId) {
    const target = aliveOpponents.find((player) => player.player_id === requestedTargetId);
    if (!target) {
      throw badRequest('Invalid target_player_id');
    }
    return target.player_id;
  }
  return aliveOpponents[0].player_id;
}

async function placeShips(client, gameId, playerId, ships) {
  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status !== 'waiting') {
    throw conflict('Ships can only be placed while the game is waiting');
  }

  const membership = players.find((player) => player.player_id === playerId);
  if (!membership) {
    throw forbidden('Player is not part of this game');
  }
  if (membership.placement_done) {
    throw conflict('Ships have already been placed for this player');
  }

  validateCoordinates(ships, game.grid_size);

  const existingOwnShips = await client.query(
    `SELECT row, col
     FROM ships
     WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerId]
  );

  if (existingOwnShips.rowCount > 0) {
    throw conflict('Ships have already been placed for this player');
  }

  for (const ship of ships) {
    await client.query(
      `INSERT INTO ships (game_id, player_id, row, col)
       VALUES ($1, $2, $3, $4)`,
      [gameId, playerId, ship.row, ship.col]
    );
  }

  await client.query(
    `UPDATE game_players
     SET placement_done = true
     WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerId]
  );

  return maybeActivateGame(client, gameId);
}

async function startGameNow(client, gameId) {
  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status === 'finished') {
    throw conflict('Game is already finished');
  }
  if (game.status === 'active') {
    return serializeGame(game, players);
  }
  if (players.length < 2) {
    throw conflict('At least 2 players are required to start');
  }
  if (!players.every((player) => player.placement_done)) {
    throw conflict('All players must place ships before the game can start');
  }

  await client.query(
    `UPDATE games
     SET status = 'active', current_turn_index = 0
     WHERE id = $1`,
    [gameId]
  );

  const refreshed = await getGameWithPlayers(client, gameId);
  return serializeGame(refreshed.game, refreshed.players);
}

async function performMove(client, gameId, body = {}) {
  const resolvedPlayerId = toUuid(body.player_id ?? body.playerId);
  const targetPlayerIdParam = toUuid(body.target_player_id ?? body.targetPlayerId);
  const { row, col } = body;

  if (!resolvedPlayerId) {
    throw forbidden('Invalid player_id');
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw badRequest('row and col must be integers');
  }

  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status === 'finished') {
    throw conflict('Game is already finished');
  }
  if (game.status !== 'active') {
    throw forbidden('Game is not active');
  }

  const membership = players.find((player) => player.player_id === resolvedPlayerId);
  if (!membership) {
    throw forbidden('Player is not part of this game');
  }
  if (membership.eliminated_at) {
    throw forbidden('Eliminated players cannot move');
  }
  if (membership.turn_order !== game.current_turn_index) {
    throw forbidden('It is not this player\'s turn');
  }
  if (row < 0 || row >= game.grid_size || col < 0 || col >= game.grid_size) {
    throw badRequest('Shot is out of bounds');
  }

  const targetPlayerId = resolveTargetPlayer(players, resolvedPlayerId, targetPlayerIdParam);
  if (!targetPlayerId) {
    throw forbidden('No valid target player remains');
  }

  const duplicateMove = await client.query(
    `SELECT id
     FROM moves
     WHERE game_id = $1 AND target_player_id = $2 AND row = $3 AND col = $4`,
    [gameId, targetPlayerId, row, col]
  );
  if (duplicateMove.rowCount > 0) {
    throw conflict('That coordinate has already been fired upon');
  }

  const shipResult = await client.query(
    `SELECT *
     FROM ships
     WHERE game_id = $1 AND player_id = $2 AND row = $3 AND col = $4 AND destroyed_at IS NULL
     LIMIT 1`,
    [gameId, targetPlayerId, row, col]
  );

  let result = 'miss';
  let hitPlayerId = null;
  let sunkPlayerId = null;

  if (shipResult.rowCount > 0) {
    result = 'hit';
    hitPlayerId = shipResult.rows[0].player_id;

    await client.query('UPDATE ships SET destroyed_at = NOW() WHERE id = $1', [shipResult.rows[0].id]);

    const remainingShips = await client.query(
      `SELECT COUNT(*)::int AS remaining
       FROM ships
       WHERE game_id = $1 AND player_id = $2 AND destroyed_at IS NULL`,
      [gameId, hitPlayerId]
    );

    if (remainingShips.rows[0].remaining === 0) {
      sunkPlayerId = hitPlayerId;
      await client.query(
        `UPDATE game_players
         SET eliminated_at = NOW()
         WHERE game_id = $1 AND player_id = $2 AND eliminated_at IS NULL`,
        [gameId, hitPlayerId]
      );
    }
  }

  const moveResult = await client.query(
    `INSERT INTO moves (game_id, player_id, target_player_id, row, col, result, hit_player_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [gameId, resolvedPlayerId, targetPlayerId, row, col, result, hitPlayerId]
  );

  await client.query(
    `UPDATE players
     SET total_moves = total_moves + 1,
         total_hits = total_hits + CASE WHEN $2 = 'hit' THEN 1 ELSE 0 END
     WHERE id = $1`,
    [resolvedPlayerId, result]
  );

  const refreshed = await getGameWithPlayers(client, gameId);
  const updatedPlayers = refreshed.players;
  const alivePlayers = updatedPlayers.filter((player) => !player.eliminated_at);

  let gameStatus = 'active';
  let winnerId = null;
  let nextTurn = nextAliveTurnOrder(updatedPlayers, membership.turn_order);

  if (alivePlayers.length <= 1) {
    gameStatus = 'finished';
    winnerId = alivePlayers[0]?.player_id || resolvedPlayerId;
    nextTurn = null;

    await client.query(
      `UPDATE games
       SET status = 'finished', winner_id = $2, current_turn_index = 0, finished_at = NOW()
       WHERE id = $1`,
      [gameId, winnerId]
    );

    await finalizeGameStats(client, gameId, winnerId);
  } else {
    await client.query(
      `UPDATE games
       SET current_turn_index = $2
       WHERE id = $1`,
      [gameId, nextTurn]
    );
  }

  const nextPlayerId =
    nextTurn === null
      ? null
      : updatedPlayers.find((player) => player.turn_order === nextTurn && !player.eliminated_at)?.player_id || null;

  const nextPlayerUsername =
    nextPlayerId === null
      ? null
      : updatedPlayers.find((player) => player.player_id === nextPlayerId)?.display_name || null;

  return {
    move_id: moveResult.rows[0].id,
    result,
    sunk_player_id: sunkPlayerId,
    eliminated: sunkPlayerId,
    next_player_id: nextPlayerId,
    next_player_username: nextPlayerUsername,
    game_status: gameStatus,
    winner_id: winnerId,
    winner_username:
      updatedPlayers.find((player) => player.player_id === winnerId)?.display_name || null,
  };
}

async function resetAllState(client) {
  await client.query('TRUNCATE TABLE moves, ships, game_players, games, players CASCADE');
}

async function seedTestState(client) {
  await resetAllState(client);

  const playerNames = ['Alpha', 'Bravo'];
  const players = [];
  for (const name of playerNames) {
    const inserted = await client.query(
      `INSERT INTO players (id, display_name)
       VALUES ($1, $2)
       RETURNING *`,
      [crypto.randomUUID(), name]
    );
    players.push(inserted.rows[0]);
  }

  const gameResult = await client.query(
    `INSERT INTO games (creator_id, grid_size, max_players, status, current_turn_index)
     VALUES ($1, 5, 2, 'waiting', 0)
     RETURNING *`,
    [players[0].id]
  );

  await client.query(
    `INSERT INTO game_players (game_id, player_id, turn_order)
     VALUES ($1, $2, 0), ($1, $3, 1)`,
    [gameResult.rows[0].id, players[0].id, players[1].id]
  );

  return {
    game_id: Number(gameResult.rows[0].id),
    player_ids: players.map((player) => player.id),
  };
}

async function getFullStateSnapshot(client) {
  const [players, games, gamePlayers, ships, moves] = await Promise.all([
    client.query('SELECT * FROM players ORDER BY created_at ASC, display_name ASC'),
    client.query('SELECT * FROM games ORDER BY id ASC'),
    client.query('SELECT * FROM game_players ORDER BY game_id ASC, turn_order ASC'),
    client.query('SELECT * FROM ships ORDER BY game_id ASC, player_id ASC, row ASC, col ASC'),
    client.query('SELECT * FROM moves ORDER BY game_id ASC, id ASC'),
  ]);

  return {
    players: players.rows,
    games: games.rows,
    game_players: gamePlayers.rows,
    ships: ships.rows,
    moves: moves.rows,
  };
}

const placeShipsHandler = asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const playerId = toUuid(req.body?.player_id ?? req.body?.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!playerId) {
    throw badRequest('Invalid player_id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const game = await placeShips(client, gameId, playerId, req.body?.ships);
    await client.query('COMMIT');
    res.status(200).json({
      status: 'ships_placed',
      ships_placed: Array.isArray(req.body?.ships) ? req.body.ships.length : 0,
      game_id: gameId,
      player_id: playerId,
      game,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw badRequest('Duplicate ship coordinates are not allowed');
    }
    throw error;
  } finally {
    client.release();
  }
});

const performMoveHandler = asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await performMove(client, gameId, req.body || {});
    await client.query('COMMIT');
    res.json(outcome);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint === 'moves_game_id_target_player_id_row_col_key') {
      throw conflict('That coordinate has already been fired upon');
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/health', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT NOW() AS now');
  res.json({ status: 'ok', now: result.rows[0].now, test_mode: TEST_MODE });
}));

app.post('/api/reset', asyncHandler(async (req, res) => {
  await resetAllState(pool);
  res.json({ status: 'reset' });
}));

app.get('/api/test/reset', requireTestMode, asyncHandler(async (req, res) => {
  await resetAllState(pool);
  res.json({ status: 'ok' });
}));

app.post('/api/test/seed', requireTestMode, asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payload = await seedTestState(client);
    await client.query('COMMIT');
    res.json(payload);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/test/state', requireTestMode, asyncHandler(async (req, res) => {
  const snapshot = await getFullStateSnapshot(pool);
  res.json(snapshot);
}));

app.post('/api/players', asyncHandler(async (req, res) => {
  const normalized = normalizeName(req.body);
  if (!normalized) {
    throw badRequest('username is required');
  }

  const client = await pool.connect();
  try {
    const player = await resolvePlayerIdentity(client, req.body || {}, {
      rejectClientSuppliedPlayerId: true,
      allowCreationFromName: true,
      requireIdentity: true,
      createErrorMessage: 'username is required',
    });

    res.status(201).json(serializePlayerSummary(player));
  } finally {
    client.release();
  }
}));

app.get('/api/players', asyncHandler(async (req, res) => {
  res.json(await listPlayers(pool));
}));

app.get('/api/players/:id', asyncHandler(async (req, res) => {
  const playerId = toUuid(req.params.id);
  if (!playerId) {
    throw notFound('Player not found');
  }

  const player = await getPlayerById(pool, playerId);
  if (!player) {
    throw notFound('Player not found');
  }

  res.json(serializePlayerSummary(player));
}));

app.get('/api/players/:id/stats', asyncHandler(async (req, res) => {
  const stats = await getStats(pool, req.params.id);
  res.json(stats);
}));

app.get('/api/leaderboard', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT *
     FROM players
     ORDER BY total_wins DESC, total_hits DESC, total_moves ASC, display_name ASC
     LIMIT 25`
  );

  res.json(result.rows.map((player, index) => ({
    rank: index + 1,
    ...serializeStats(player),
  })));
}));

app.post('/api/games', asyncHandler(async (req, res) => {
  const { grid_size, max_players, is_ai } = req.body || {};
  const gridSize = Number.isInteger(grid_size) ? grid_size : null;
  const maxPlayers = max_players === undefined ? null : toPositiveInteger(max_players);

  if (!Number.isInteger(gridSize) || gridSize < 5 || gridSize > 15) {
    throw badRequest('grid_size must be an integer between 5 and 15');
  }
  if (!maxPlayers || maxPlayers < 1 || maxPlayers > 50) {
    throw badRequest('max_players must be an integer between 1 and 50');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const creator = await resolvePlayerIdentity(client, req.body || {}, {
      allowCreationFromName: true,
      requireIdentity: true,
      createErrorMessage: 'creator identity is required',
    });

    const gameResult = await client.query(
      `INSERT INTO games (creator_id, grid_size, max_players, status, current_turn_index)
       VALUES ($1, $2, $3, 'waiting', 0)
       RETURNING *`,
      [creator.id, gridSize, maxPlayers]
    );

    await client.query(
      `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
       VALUES ($1, $2, 0, $3)`,
      [gameResult.rows[0].id, creator.id, Boolean(is_ai)]
    );

    const game = await maybeActivateGame(client, gameResult.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(game);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/games', asyncHandler(async (req, res) => {
  res.json(await listGames(pool));
}));

app.post('/api/games/:id/join', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);

    const player = await resolvePlayerIdentity(client, req.body || {}, {
      allowCreationFromName: true,
      requireIdentity: true,
      createErrorMessage: 'player identity is required',
    });

    if (players.some((member) => member.player_id === player.id)) {
      throw badRequest('Player already joined this game');
    }
    if (game.status !== 'waiting') {
      throw conflict('Game already started');
    }
    if (players.length >= game.max_players) {
      throw conflict('Game is full');
    }

    await client.query(
      `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
       VALUES ($1, $2, $3, $4)`,
      [gameId, player.id, players.length, Boolean(req.body?.is_ai)]
    );

    const gameState = await maybeActivateGame(client, gameId);
    await client.query('COMMIT');
    res.status(200).json({
      joined: true,
      game_id: gameId,
      player_id: player.id,
      username: player.display_name,
      status: gameState.status,
      game: gameState,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw badRequest('Player already joined this game');
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/games/:id', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  res.json(serializeGame(game, players));
}));

app.post('/api/games/:id/start', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const game = await startGameNow(client, gameId);
    await client.query('COMMIT');
    res.json({ status: game.status, game });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/games/:id/place', placeShipsHandler);
app.post('/api/games/:id/ships', placeShipsHandler);

app.get('/api/games/:id/ships', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const playerId = toUuid(req.query.player_id || req.query.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!playerId) {
    throw badRequest('player_id query parameter is required');
  }

  const { players } = await getGameWithPlayers(pool, gameId);
  if (!players.some((player) => player.player_id === playerId)) {
    throw forbidden('Player is not part of this game');
  }

  res.json(await getShipsForPlayer(pool, gameId, playerId));
}));

app.post('/api/games/:id/fire', performMoveHandler);

app.post('/api/games/:id/moves', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await performMove(client, gameId, req.body || {});
    await client.query('COMMIT');
    res.json({
      result: outcome.sunk_player_id ? 'sunk' : outcome.result,
      eliminated: outcome.sunk_player_id,
      winner_id: outcome.winner_id,
      next_player_id: outcome.next_player_id,
      game_status: outcome.game_status,
      move_id: outcome.move_id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint === 'moves_game_id_target_player_id_row_col_key') {
      throw conflict('That coordinate has already been fired upon');
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/games/:id/moves', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  await getGameWithPlayers(pool, gameId);
  res.json(await getMovesForGame(pool, gameId));
}));

app.get('/api/games/:id/replay', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  const [moves, shipsByPlayer] = await Promise.all([
    getMovesForGame(pool, gameId),
    Promise.all(players.map(async (player) => ({
      player_id: player.player_id,
      username: player.display_name,
      ships: await getShipsForPlayer(pool, gameId, player.player_id),
    }))),
  ]);

  res.json({
    game: serializeGame(game, players),
    players: shipsByPlayer,
    moves,
  });
}));

app.post('/api/test/games/:id/restart', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await getGameWithPlayers(client, gameId);

    await client.query('DELETE FROM moves WHERE game_id = $1', [gameId]);
    await client.query('DELETE FROM ships WHERE game_id = $1', [gameId]);
    await client.query(
      `UPDATE game_players
       SET placement_done = false,
           eliminated_at = NULL
       WHERE game_id = $1`,
      [gameId]
    );
    await client.query(
      `UPDATE games
       SET status = 'waiting', winner_id = NULL, finished_at = NULL, current_turn_index = 0
       WHERE id = $1`,
      [gameId]
    );

    await client.query('COMMIT');
    res.json({ status: 'restarted', game_id: gameId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/test/games/:id/ships', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const playerId = toUuid(req.body?.player_id ?? req.body?.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!playerId) {
    throw badRequest('Invalid player_id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);
    const membership = players.find((player) => player.player_id === playerId);

    if (!membership) {
      throw badRequest('Player is not part of this game');
    }

    validateCoordinates(req.body?.ships, game.grid_size);

    await client.query('DELETE FROM ships WHERE game_id = $1 AND player_id = $2', [gameId, playerId]);

    for (const ship of req.body.ships) {
      await client.query(
        `INSERT INTO ships (game_id, player_id, row, col)
         VALUES ($1, $2, $3, $4)`,
        [gameId, playerId, ship.row, ship.col]
      );
    }

    await client.query(
      `UPDATE game_players
       SET placement_done = true,
           eliminated_at = NULL
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    const gameState = await maybeActivateGame(client, gameId);
    await client.query('COMMIT');

    res.json({ status: 'ships_set', player_id: playerId, game: gameState });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/test/games/:id/board/:playerId', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const playerId = toUuid(req.params.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!playerId) {
    throw badRequest('Invalid player_id');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  const membership = players.find((player) => player.player_id === playerId);

  if (!membership) {
    throw badRequest('Player is not part of this game');
  }

  const ships = await pool.query(
    `SELECT row, col, destroyed_at
     FROM ships
     WHERE game_id = $1 AND player_id = $2
     ORDER BY row ASC, col ASC`,
    [gameId, playerId]
  );

  const moves = await pool.query(
    `SELECT row, col, result, player_id, target_player_id, hit_player_id
     FROM moves
     WHERE game_id = $1
     ORDER BY id ASC`,
    [gameId]
  );

  res.json({
    game_id: gameId,
    grid_size: game.grid_size,
    player_id: playerId,
    ships: ships.rows.map((ship) => ({
      row: ship.row,
      col: ship.col,
      destroyed: Boolean(ship.destroyed_at),
    })),
    moves: moves.rows,
  });
}));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
