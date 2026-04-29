const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'clemson-test-2026';

const app = express();

const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://alexlake.site',
  'https://www.alexlake.site',
  'https://battleshipfinal.xyz',
  'https://www.battleshipfinal.xyz',
  'https://portfolio-fpvj.onrender.com',
  'https://three750final-1.onrender.com',
];

const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins = new Set([...defaultCorsOrigins, ...configuredCorsOrigins]);
const allowAnyCorsOrigin = !process.env.CORS_ORIGIN || configuredCorsOrigins.includes('*');

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients such as curl, Postman, and the autograder usually do not send an Origin header.
    if (!origin) {
      return callback(null, true);
    }

    if (allowAnyCorsOrigin || allowedCorsOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Test-Password'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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
    return res.status(415).json({ error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
  }
  next();
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

const badRequest = (message = 'Bad request') => makeError(400, 'bad_request', message);
const forbidden = (message = 'Forbidden') => makeError(403, 'forbidden', message);
const notFound = (message = 'Not found') => makeError(404, 'not_found', message);
const conflict = (message = 'Conflict') => makeError(409, 'conflict', message);

function toPositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function toBodyPositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
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

function validateUsername(username) {
  if (typeof username !== 'string') {
    throw badRequest('username is required');
  }
  const normalized = username.trim();
  if (!normalized) {
    throw badRequest('username is required');
  }
  if (normalized.length > 30) {
    throw badRequest('username must be 1-30 characters');
  }
  if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
    throw badRequest('username must contain only letters, numbers, and underscores');
  }
  return normalized;
}

function toPublicStatus(dbStatus) {
  if (dbStatus === 'waiting') return 'waiting_setup';
  if (dbStatus === 'active') return 'playing';
  return dbStatus;
}

async function getPlayerIdMap(client) {
  const result = await client.query(
    `SELECT id,
            ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)::int AS external_id
     FROM players`
  );
  return new Map(result.rows.map((row) => [row.id, row.external_id]));
}

async function getPlayerByUuid(client, uuid) {
  const result = await client.query('SELECT * FROM players WHERE id = $1', [uuid]);
  return result.rows[0] || null;
}

async function getPlayerByExternalId(client, externalId) {
  const result = await client.query(
    `SELECT *
     FROM (
       SELECT p.*, ROW_NUMBER() OVER (ORDER BY p.created_at ASC, p.id ASC)::int AS external_id
       FROM players p
     ) ranked
     WHERE external_id = $1`,
    [externalId]
  );
  return result.rows[0] || null;
}

async function resolvePlayerReference(client, rawValue, options = {}) {
  const {
    allowNumericString = false,
    allowUuid = true,
  } = options;

  if (typeof rawValue === 'number') {
    if (!Number.isInteger(rawValue) || rawValue <= 0) {
      return { malformed: true, player: null };
    }
    return { malformed: false, player: await getPlayerByExternalId(client, rawValue) };
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return { malformed: true, player: null };
    }

    if (allowNumericString && /^[1-9]\d*$/.test(trimmed)) {
      return { malformed: false, player: await getPlayerByExternalId(client, Number(trimmed)) };
    }

    const uuid = allowUuid ? toUuid(trimmed) : null;
    if (uuid) {
      return { malformed: false, player: await getPlayerByUuid(client, uuid) };
    }

    return { malformed: true, player: null };
  }

  return { malformed: true, player: null };
}

function serializePlayerSummary(player, idMap) {
  const publicId = idMap.get(player.id) ?? null;
  return {
    id: publicId,
    player_id: publicId,
    username: player.display_name,
  };
}

function serializeStats(player, idMap) {
  const totalHits = Number(player.total_hits || 0);
  const totalShots = Number(player.total_moves || 0);
  const accuracy = totalShots === 0 ? 0.0 : Number((totalHits / totalShots).toFixed(3));
  const publicId = idMap.get(player.id) ?? null;

  return {
    id: publicId,
    player_id: publicId,
    username: player.display_name,
    games_played: Number(player.total_games || 0),
    wins: Number(player.total_wins || 0),
    losses: Number(player.total_losses || 0),
    total_shots: totalShots,
    shots_fired: totalShots,
    total_hits: totalHits,
    hits: totalHits,
    accuracy,
  };
}

function serializeGame(game, players, idMap) {
  const publicStatus = toPublicStatus(game.status);
  const alivePlayers = players.filter((player) => !player.eliminated_at);
  const currentPlayer =
    publicStatus === 'playing'
      ? alivePlayers.find((player) => player.turn_order === game.current_turn_index) || null
      : null;

  return {
    id: Number(game.id),
    game_id: Number(game.id),
    grid_size: Number(game.grid_size),
    max_players: Number(game.max_players),
    status: publicStatus,
    player_count: Number(players.length),
    current_turn_player_id: currentPlayer ? (idMap.get(currentPlayer.player_id) ?? null) : null,
    current_turn: currentPlayer ? (idMap.get(currentPlayer.player_id) ?? null) : null,
    total_moves: Number(game.total_moves || 0),
    winner_id: game.winner_id ? (idMap.get(game.winner_id) ?? null) : null,
    players: players.map((player) => ({
      id: idMap.get(player.player_id) ?? null,
      player_id: idMap.get(player.player_id) ?? null,
      username: player.display_name,
      turn_order: Number(player.turn_order),
      placement_done: Boolean(player.placement_done),
      ships_remaining: Number(player.remaining_ships || 0),
      eliminated: Boolean(player.eliminated_at),
    })),
  };
}

function serializeGameListItem(row) {
  return {
    id: Number(row.id),
    game_id: Number(row.id),
    status: toPublicStatus(row.status),
    grid_size: Number(row.grid_size),
    max_players: Number(row.max_players),
    player_count: Number(row.player_count),
  };
}

function serializeShipRow(row) {
  return {
    row: Number(row.row),
    col: Number(row.col),
    sunk: Boolean(row.destroyed_at),
  };
}

function serializeMoveRow(row, idMap) {
  const timestamp = row.created_at || row.timestamp;
  return {
    move_id: Number(row.move_id ?? row.id),
    player_id: idMap.get(row.player_id) ?? null,
    username: row.shooter_name || null,
    target_player_id: idMap.get(row.target_player_id) ?? null,
    target_username: row.target_name || null,
    hit_player_id: row.hit_player_id ? (idMap.get(row.hit_player_id) ?? null) : null,
    hit_username: row.hit_name || null,
    row: Number(row.row),
    col: Number(row.col),
    result: row.result,
    timestamp,
    created_at: timestamp,
  };
}

function validateCoordinates(ships, gridSize) {
  const validFleetSizes = new Set([3, 12]);
  if (!Array.isArray(ships) || !validFleetSizes.has(ships.length)) {
    throw badRequest('Ships must contain either 3 legacy cells or a 12-cell fleet');
  }

  const seen = new Set();
  for (const ship of ships) {
    if (!ship || typeof ship !== 'object' || !Number.isInteger(ship.row) || !Number.isInteger(ship.col)) {
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

async function getGameWithPlayers(client, gameId) {
  const gameResult = await client.query(
    `SELECT g.*,
            COUNT(gp.player_id)::int AS player_count,
            COALESCE((SELECT COUNT(*)::int FROM moves m WHERE m.game_id = g.id), 0)::int AS total_moves
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
    `SELECT gp.game_id,
            gp.player_id,
            gp.turn_order,
            gp.placement_done,
            gp.is_ai,
            gp.eliminated_at,
            p.display_name,
            COALESCE(ship_counts.remaining_ships, 0)::int AS remaining_ships
     FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     LEFT JOIN (
       SELECT game_id, player_id, COUNT(*) FILTER (WHERE destroyed_at IS NULL)::int AS remaining_ships
       FROM ships
       WHERE game_id = $1
       GROUP BY game_id, player_id
     ) ship_counts ON ship_counts.game_id = gp.game_id AND ship_counts.player_id = gp.player_id
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
  const [result, idMap] = await Promise.all([
    client.query('SELECT * FROM players ORDER BY created_at ASC, id ASC'),
    getPlayerIdMap(client),
  ]);

  return result.rows.map((player) => serializePlayerSummary(player, idMap));
}

async function getStats(client, rawPlayerId) {
  const { malformed, player } = await resolvePlayerReference(client, rawPlayerId, {
    allowNumericString: true,
    allowUuid: true,
  });

  if (malformed || !player) {
    throw notFound('Player not found');
  }

  const idMap = await getPlayerIdMap(client);
  return serializeStats(player, idMap);
}

async function getShipsForPlayer(client, gameId, playerUuid) {
  const result = await client.query(
    `SELECT row, col, destroyed_at
     FROM ships
     WHERE game_id = $1 AND player_id = $2
     ORDER BY row ASC, col ASC`,
    [gameId, playerUuid]
  );

  return result.rows.map(serializeShipRow);
}

async function getMovesForGame(client, gameId) {
  const [result, idMap] = await Promise.all([
    client.query(
      `SELECT m.id AS move_id, m.row, m.col, m.result, m.created_at,
              m.player_id, m.target_player_id, m.hit_player_id,
              shooter.display_name AS shooter_name,
              target.display_name AS target_name,
              hit.display_name AS hit_name
       FROM moves m
       JOIN players shooter ON shooter.id = m.player_id
       LEFT JOIN players target ON target.id = m.target_player_id
       LEFT JOIN players hit ON hit.id = m.hit_player_id
       WHERE m.game_id = $1
       ORDER BY m.id ASC`,
      [gameId]
    ),
    getPlayerIdMap(client),
  ]);

  return result.rows.map((row) => serializeMoveRow(row, idMap));
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
  }

  const refreshed = await getGameWithPlayers(client, gameId);
  const idMap = await getPlayerIdMap(client);
  return serializeGame(refreshed.game, refreshed.players, idMap);
}

function requireTestMode(req, res, next) {
  if (req.get('X-Test-Password') !== TEST_PASSWORD) {
    return res.status(403).json({ error: 'forbidden', message: 'Invalid test password' });
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

async function placeShips(client, gameId, playerUuid, ships) {
  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status !== 'waiting') {
    throw conflict('Ships can only be placed while the game is in setup');
  }

  const membership = players.find((player) => player.player_id === playerUuid);
  if (!membership) {
    throw badRequest('Player is not part of this game');
  }
  if (membership.placement_done) {
    throw conflict('Ships have already been placed for this player');
  }

  validateCoordinates(ships, game.grid_size);

  const existingOwnShips = await client.query(
    `SELECT row, col
     FROM ships
     WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerUuid]
  );

  if (existingOwnShips.rowCount > 0) {
    throw conflict('Ships have already been placed for this player');
  }

  for (const ship of ships) {
    await client.query(
      `INSERT INTO ships (game_id, player_id, row, col)
       VALUES ($1, $2, $3, $4)`,
      [gameId, playerUuid, ship.row, ship.col]
    );
  }

  await client.query(
    `UPDATE game_players
     SET placement_done = true
     WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerUuid]
  );

  return maybeActivateGame(client, gameId);
}

async function startGameNow(client, gameId) {
  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status === 'finished') {
    throw badRequest('Game is already finished');
  }
  if (game.status === 'active') {
    const idMap = await getPlayerIdMap(client);
    return serializeGame(game, players, idMap);
  }
  if (players.length < 2) {
    throw badRequest('At least 2 players are required to start');
  }
  if (!players.every((player) => player.placement_done)) {
    throw badRequest('All players must place ships before the game can start');
  }

  await client.query(
    `UPDATE games
     SET status = 'active', current_turn_index = 0
     WHERE id = $1`,
    [gameId]
  );

  const refreshed = await getGameWithPlayers(client, gameId);
  const idMap = await getPlayerIdMap(client);
  return serializeGame(refreshed.game, refreshed.players, idMap);
}

async function performMove(client, gameId, body = {}) {
  const { row, col } = body;
  const playerRef = body.player_id ?? body.playerId;
  const targetRef = body.target_player_id ?? body.targetPlayerId;

  if (playerRef === undefined) {
    throw badRequest('player_id is required');
  }

  const playerResolution = await resolvePlayerReference(client, playerRef, {
    allowNumericString: false,
    allowUuid: true,
  });
  if (playerResolution.malformed || !playerResolution.player) {
    throw badRequest('Invalid player_id');
  }

  let requestedTargetPlayerId = null;
  if (targetRef !== undefined && targetRef !== null && targetRef !== '' && targetRef !== 'all') {
    const targetResolution = await resolvePlayerReference(client, targetRef, {
      allowNumericString: false,
      allowUuid: true,
    });
    if (targetResolution.malformed || !targetResolution.player) {
      throw badRequest('Invalid target_player_id');
    }
    requestedTargetPlayerId = targetResolution.player.id;
  }

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw badRequest('row and col must be integers');
  }

  const resolvedPlayerId = playerResolution.player.id;
  const { game, players } = await getGameWithPlayers(client, gameId);

  if (game.status === 'finished') {
    throw badRequest('Game is already finished');
  }
  if (game.status !== 'active') {
    throw badRequest('Game is not playing');
  }

  const membership = players.find((player) => player.player_id === resolvedPlayerId);
  if (!membership) {
    throw forbidden('Player is not part of this game');
  }
  if (membership.eliminated_at) {
    throw forbidden('Eliminated players cannot move');
  }
  if (membership.turn_order !== game.current_turn_index) {
    throw forbidden('not your turn');
  }
  if (row < 0 || row >= game.grid_size || col < 0 || col >= game.grid_size) {
    throw badRequest('Shot is out of bounds');
  }

  const aliveOpponents = players.filter((player) => player.player_id !== resolvedPlayerId && !player.eliminated_at);
  if (aliveOpponents.length === 0) {
    throw badRequest('No valid target player remains');
  }

  const targets = requestedTargetPlayerId
    ? aliveOpponents.filter((player) => player.player_id === requestedTargetPlayerId)
    : aliveOpponents;

  if (targets.length === 0) {
    throw badRequest('Invalid target_player_id');
  }

  const targetIds = targets.map((player) => player.player_id);
  const duplicateMove = await client.query(
    `SELECT target_player_id
     FROM moves
     WHERE game_id = $1 AND target_player_id = ANY($2::uuid[]) AND row = $3 AND col = $4`,
    [gameId, targetIds, row, col]
  );
  if (duplicateMove.rowCount > 0) {
    throw conflict('cell already targeted');
  }

  const idMap = await getPlayerIdMap(client);
  const perTargetResults = [];
  const eliminatedPlayerIds = [];
  let hitCount = 0;
  let firstMoveId = null;

  for (const target of targets) {
    const shipResult = await client.query(
      `SELECT *
       FROM ships
       WHERE game_id = $1 AND player_id = $2 AND row = $3 AND col = $4 AND destroyed_at IS NULL
       LIMIT 1`,
      [gameId, target.player_id, row, col]
    );

    let result = 'miss';
    let hitPlayerId = null;
    let eliminatedPlayerId = null;

    if (shipResult.rowCount > 0) {
      result = 'hit';
      hitCount += 1;
      hitPlayerId = shipResult.rows[0].player_id;

      await client.query('UPDATE ships SET destroyed_at = NOW() WHERE id = $1', [shipResult.rows[0].id]);

      const remainingShips = await client.query(
        `SELECT COUNT(*)::int AS remaining
         FROM ships
         WHERE game_id = $1 AND player_id = $2 AND destroyed_at IS NULL`,
        [gameId, hitPlayerId]
      );

      if (remainingShips.rows[0].remaining === 0) {
        eliminatedPlayerId = hitPlayerId;
        eliminatedPlayerIds.push(hitPlayerId);
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
      [gameId, resolvedPlayerId, target.player_id, row, col, result, hitPlayerId]
    );

    if (firstMoveId === null) {
      firstMoveId = Number(moveResult.rows[0].id);
    }

    perTargetResults.push({
      target_player_id: idMap.get(target.player_id) ?? null,
      target_username: target.display_name,
      result,
      hit: Boolean(hitPlayerId),
      eliminated: eliminatedPlayerId ? (idMap.get(eliminatedPlayerId) ?? null) : null,
    });
  }

  await client.query(
    `UPDATE players
     SET total_moves = total_moves + 1,
         total_hits = total_hits + $2
     WHERE id = $1`,
    [resolvedPlayerId, hitCount]
  );

  const refreshed = await getGameWithPlayers(client, gameId);
  const updatedPlayers = refreshed.players;
  const alivePlayers = updatedPlayers.filter((player) => !player.eliminated_at);

  let gameStatus = 'playing';
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
      : idMap.get(updatedPlayers.find((player) => player.turn_order === nextTurn && !player.eliminated_at)?.player_id) || null;

  return {
    move_id: firstMoveId,
    result: hitCount > 0 ? 'hit' : 'miss',
    hit_count: hitCount,
    targets_checked: targets.length,
    target_results: perTargetResults,
    eliminated: eliminatedPlayerIds[0] ? (idMap.get(eliminatedPlayerIds[0]) ?? null) : null,
    eliminated_players: eliminatedPlayerIds.map((playerId) => idMap.get(playerId) ?? null),
    winner_id: winnerId ? (idMap.get(winnerId) ?? null) : null,
    next_player_id: nextPlayerId,
    game_status: gameStatus,
  };
}

async function resetAllState(client) {
  await client.query('TRUNCATE TABLE moves, ships, game_players, games, players RESTART IDENTITY CASCADE');
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

  const idMap = await getPlayerIdMap(client);
  return {
    game_id: Number(gameResult.rows[0].id),
    player_ids: players.map((player) => idMap.get(player.id) ?? null),
  };
}

async function getFullStateSnapshot(client) {
  const [players, games, gamePlayers, ships, moves, idMap] = await Promise.all([
    client.query('SELECT * FROM players ORDER BY created_at ASC, id ASC'),
    client.query('SELECT * FROM games ORDER BY id ASC'),
    client.query('SELECT * FROM game_players ORDER BY game_id ASC, turn_order ASC'),
    client.query('SELECT * FROM ships ORDER BY game_id ASC, player_id ASC, row ASC, col ASC'),
    client.query('SELECT * FROM moves ORDER BY game_id ASC, id ASC'),
    getPlayerIdMap(client),
  ]);

  return {
    players: players.rows.map((player) => ({ ...player, player_id: idMap.get(player.id) ?? null })),
    games: games.rows.map((game) => ({ ...game, status: toPublicStatus(game.status) })),
    game_players: gamePlayers.rows.map((row) => ({ ...row, player_id: idMap.get(row.player_id) ?? null })),
    ships: ships.rows.map((row) => ({ ...row, player_id: idMap.get(row.player_id) ?? null })),
    moves: moves.rows.map((row) => ({
      ...row,
      player_id: idMap.get(row.player_id) ?? null,
      target_player_id: idMap.get(row.target_player_id) ?? null,
      hit_player_id: row.hit_player_id ? (idMap.get(row.hit_player_id) ?? null) : null,
    })),
  };
}

const placeShipsHandler = asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (req.body?.player_id === undefined && req.body?.playerId === undefined) {
    throw badRequest('player_id is required');
  }

  const client = await pool.connect();
  try {
    const playerResolution = await resolvePlayerReference(client, req.body?.player_id ?? req.body?.playerId, {
      allowNumericString: false,
      allowUuid: true,
    });
    if (playerResolution.malformed || !playerResolution.player) {
      throw badRequest('Invalid player_id');
    }

    await client.query('BEGIN');
    const game = await placeShips(client, gameId, playerResolution.player.id, req.body?.ships);
    await client.query('COMMIT');
    const idMap = await getPlayerIdMap(client);
    res.status(200).json({
      status: 'placed',
      ships_placed: Array.isArray(req.body?.ships) ? req.body.ships.length : 0,
      game_id: gameId,
      player_id: idMap.get(playerResolution.player.id) ?? null,
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
      throw conflict('cell already targeted')
    }
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/health', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT NOW() AS now');
  res.json({ status: 'ok', now: result.rows[0].now });
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
  const username = validateUsername(req.body?.username);

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT 1 FROM players WHERE display_name = $1', [username]);
    if (existing.rowCount > 0) {
      throw conflict('Username already taken');
    }

    const inserted = await client.query(
      `INSERT INTO players (id, display_name)
       VALUES ($1, $2)
       RETURNING *`,
      [crypto.randomUUID(), username]
    );

    const idMap = await getPlayerIdMap(client);
    res.status(201).json(serializePlayerSummary(inserted.rows[0], idMap));
  } finally {
    client.release();
  }
}));

app.get('/api/players', asyncHandler(async (req, res) => {
  res.json(await listPlayers(pool));
}));

app.get('/api/players/:id', asyncHandler(async (req, res) => {
  const { malformed, player } = await resolvePlayerReference(pool, req.params.id, {
    allowNumericString: true,
    allowUuid: true,
  });
  if (malformed || !player) {
    throw notFound('Player not found');
  }

  const idMap = await getPlayerIdMap(pool);
  res.json(serializePlayerSummary(player, idMap));
}));

app.get('/api/players/:id/stats', asyncHandler(async (req, res) => {
  const stats = await getStats(pool, req.params.id);
  res.json(stats);
}));

app.get('/api/leaderboard', asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    const [result, idMap] = await Promise.all([
      client.query(
        `SELECT *
         FROM players
         ORDER BY total_wins DESC, total_hits DESC, total_moves ASC, display_name ASC
         LIMIT 25`
      ),
      getPlayerIdMap(client),
    ]);

    res.json(result.rows.map((player, index) => ({ rank: index + 1, ...serializeStats(player, idMap) })));
  } finally {
    client.release();
  }
}));

app.post('/api/games', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const hasRequiredFields = Object.prototype.hasOwnProperty.call(body, 'creator_id')
    && Object.prototype.hasOwnProperty.call(body, 'grid_size')
    && Object.prototype.hasOwnProperty.call(body, 'max_players');

  if (!hasRequiredFields) {
    throw badRequest('missing required fields');
  }

  const gridSize = toBodyPositiveInteger(body.grid_size);
  const maxPlayers = toBodyPositiveInteger(body.max_players);

  if (!gridSize || gridSize < 5 || gridSize > 15) {
    throw badRequest('grid_size must be between 5 and 15');
  }
  if (!maxPlayers || maxPlayers < 2 || maxPlayers > 10) {
    throw badRequest('max_players must be between 2 and 10');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const creatorResolution = await resolvePlayerReference(client, body.creator_id, {
      allowNumericString: false,
      allowUuid: true,
    });
    if (creatorResolution.malformed || !creatorResolution.player) {
      throw badRequest('creator_id is invalid');
    }

    const gameResult = await client.query(
      `INSERT INTO games (creator_id, grid_size, max_players, status, current_turn_index)
       VALUES ($1, $2, $3, 'waiting', 0)
       RETURNING *`,
      [creatorResolution.player.id, gridSize, maxPlayers]
    );

    await client.query(
      `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
       VALUES ($1, $2, 0, false)`,
      [gameResult.rows[0].id, creatorResolution.player.id]
    );

    const { game, players } = await getGameWithPlayers(client, Number(gameResult.rows[0].id));
    const idMap = await getPlayerIdMap(client);
    await client.query('COMMIT');
    res.status(201).json(serializeGame(game, players, idMap));
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
    throw notFound('Game not found');
  }
  if (req.body?.player_id === undefined && req.body?.playerId === undefined) {
    throw badRequest('player_id is required');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);

    const playerResolution = await resolvePlayerReference(client, req.body?.player_id ?? req.body?.playerId, {
      allowNumericString: false,
      allowUuid: true,
    });
    if (playerResolution.malformed) {
      throw badRequest('Invalid player_id');
    }
    if (!playerResolution.player) {
      throw notFound('player does not exist');
    }

    if (players.some((member) => member.player_id === playerResolution.player.id)) {
      throw badRequest('Player already joined this game');
    }
    if (game.status !== 'waiting') {
      throw badRequest('Game already started');
    }
    if (players.length >= game.max_players) {
      throw badRequest('Game is full');
    }

    await client.query(
      `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
       VALUES ($1, $2, $3, $4)`,
      [gameId, playerResolution.player.id, players.length, Boolean(req.body?.is_ai)]
    );

    const gameState = await maybeActivateGame(client, gameId);
    const idMap = await getPlayerIdMap(client);
    await client.query('COMMIT');
    res.status(200).json({
      game_id: gameId,
      player_id: idMap.get(playerResolution.player.id) ?? null,
      status: 'joined',
      game_status: gameState.status,
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
    throw notFound('Game not found');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  const idMap = await getPlayerIdMap(pool);
  res.json(serializeGame(game, players, idMap));
}));

app.post('/api/games/:id/start', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
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
  if (!gameId) {
    throw notFound('Game not found');
  }
  if (req.query.player_id === undefined && req.query.playerId === undefined) {
    throw badRequest('player_id query parameter is required');
  }

  const client = await pool.connect();
  try {
    const playerResolution = await resolvePlayerReference(client, req.query.player_id ?? req.query.playerId, {
      allowNumericString: true,
      allowUuid: true,
    });
    if (playerResolution.malformed || !playerResolution.player) {
      throw badRequest('Invalid player_id');
    }

    const { players } = await getGameWithPlayers(client, gameId);
    if (!players.some((player) => player.player_id === playerResolution.player.id)) {
      throw forbidden('Player is not part of this game');
    }

    res.json(await getShipsForPlayer(client, gameId, playerResolution.player.id));
  } finally {
    client.release();
  }
}));

app.post('/api/games/:id/fire', performMoveHandler);

app.post('/api/games/:id/moves', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await performMove(client, gameId, req.body || {});
    await client.query('COMMIT');
    res.json({
      result: outcome.result,
      eliminated: outcome.eliminated,
      eliminated_players: outcome.eliminated_players,
      winner_id: outcome.winner_id,
      next_player_id: outcome.next_player_id,
      game_status: outcome.game_status,
      move_id: outcome.move_id,
      hit_count: outcome.hit_count,
      targets_checked: outcome.targets_checked,
      target_results: outcome.target_results,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint === 'moves_game_id_target_player_id_row_col_key') {
      throw conflict('cell already targeted')
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/games/:id/moves', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
  }

  await getGameWithPlayers(pool, gameId);
  res.json(await getMovesForGame(pool, gameId));
}));

app.get('/api/games/:id/replay', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
  }

  const client = await pool.connect();
  try {
    const { game, players } = await getGameWithPlayers(client, gameId);
    const idMap = await getPlayerIdMap(client);
    const [moves, shipsByPlayer] = await Promise.all([
      getMovesForGame(client, gameId),
      Promise.all(players.map(async (player) => ({
        player_id: idMap.get(player.player_id) ?? null,
        username: player.display_name,
        ships: await getShipsForPlayer(client, gameId, player.player_id),
      }))),
    ]);

    res.json({
      game: serializeGame(game, players, idMap),
      players: shipsByPlayer,
      moves,
    });
  } finally {
    client.release();
  }
}));

app.post('/api/test/games/:id/restart', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
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
    res.json({ status: 'reset', game_id: gameId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/test/games/:id/ships', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
  }
  if (req.body?.player_id === undefined && req.body?.playerId === undefined) {
    throw badRequest('player_id is required');
  }

  const client = await pool.connect();
  try {
    const playerResolution = await resolvePlayerReference(client, req.body?.player_id ?? req.body?.playerId, {
      allowNumericString: false,
      allowUuid: true,
    });
    if (playerResolution.malformed || !playerResolution.player) {
      throw badRequest('Invalid player_id');
    }

    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);
    const membership = players.find((player) => player.player_id === playerResolution.player.id);

    if (!membership) {
      throw badRequest('Player is not part of this game');
    }

    validateCoordinates(req.body?.ships, game.grid_size);

    await client.query('DELETE FROM ships WHERE game_id = $1 AND player_id = $2', [gameId, playerResolution.player.id]);

    for (const ship of req.body.ships) {
      await client.query(
        `INSERT INTO ships (game_id, player_id, row, col)
         VALUES ($1, $2, $3, $4)`,
        [gameId, playerResolution.player.id, ship.row, ship.col]
      );
    }

    await client.query(
      `UPDATE game_players
       SET placement_done = true,
           eliminated_at = NULL
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerResolution.player.id]
    );

    const gameState = await maybeActivateGame(client, gameId);
    const idMap = await getPlayerIdMap(client);
    await client.query('COMMIT');

    res.json({ status: 'ships_set', player_id: idMap.get(playerResolution.player.id) ?? null, game: gameState });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/test/games/:id/board/:playerId', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  if (!gameId) {
    throw notFound('Game not found');
  }

  const client = await pool.connect();
  try {
    const playerResolution = await resolvePlayerReference(client, req.params.playerId, {
      allowNumericString: true,
      allowUuid: true,
    });
    if (playerResolution.malformed || !playerResolution.player) {
      throw badRequest('Invalid player_id');
    }

    const { game, players } = await getGameWithPlayers(client, gameId);
    const membership = players.find((player) => player.player_id === playerResolution.player.id);
    if (!membership) {
      throw badRequest('Player is not part of this game');
    }

    const [ships, moves, idMap] = await Promise.all([
      client.query(
        `SELECT row, col, destroyed_at
         FROM ships
         WHERE game_id = $1 AND player_id = $2
         ORDER BY row ASC, col ASC`,
        [gameId, playerResolution.player.id]
      ),
      client.query(
        `SELECT row, col, result, player_id, target_player_id, hit_player_id
         FROM moves
         WHERE game_id = $1
         ORDER BY id ASC`,
        [gameId]
      ),
      getPlayerIdMap(client),
    ]);

    res.json({
      game_id: gameId,
      grid_size: Number(game.grid_size),
      player_id: idMap.get(playerResolution.player.id) ?? null,
      ships: ships.rows.map((ship) => ({
        row: ship.row,
        col: ship.col,
        destroyed: Boolean(ship.destroyed_at),
      })),
      moves: moves.rows.map((row) => ({
        ...row,
        player_id: idMap.get(row.player_id) ?? null,
        target_player_id: idMap.get(row.target_player_id) ?? null,
        hit_player_id: row.hit_player_id ? (idMap.get(row.hit_player_id) ?? null) : null,
      })),
    });
  } finally {
    client.release();
  }
}));

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Not found' });
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }

  const errorCode = err.code || (status === 400
    ? 'bad_request'
    : status === 403
      ? 'forbidden'
      : status === 404
        ? 'not_found'
        : status === 409
          ? 'conflict'
          : 'internal_server_error');

  res.status(status).json({
    error: errorCode,
    message: err.message || 'Internal server error',
  });
});

module.exports = app;
