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
const gone = (message) => makeError(410, message);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

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

function normalizeName(body = {}) {
  return String(body.username || body.playerName || body.displayName || '').trim();
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

async function getPlayerById(client, playerId) {
  const result = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
  return result.rows[0] || null;
}

async function getOrCreatePlayer(client, body = {}) {
  const providedPlayerId = toPositiveInteger(body.player_id ?? body.playerId ?? body.creator_id ?? body.creatorId);
  const name = normalizeName(body);

  if (providedPlayerId) {
    const player = await getPlayerById(client, providedPlayerId);
    if (!player) {
      throw badRequest('Invalid player_id');
    }
    return player;
  }

  if (!name) {
    return null;
  }

  const result = await client.query(
    `INSERT INTO players (display_name)
     VALUES ($1)
     ON CONFLICT (display_name)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [name]
  );
  return result.rows[0];
}

async function getStats(client, playerId) {
  if (!isPositiveInteger(playerId)) {
    throw notFound('Player not found');
  }

  const player = await getPlayerById(client, playerId);
  if (!player) {
    throw notFound('Player not found');
  }

  const totalHits = player.total_hits || 0;
  const totalShots = player.total_moves || 0;

  return {
    games_played: player.total_games,
    wins: player.total_wins,
    losses: player.total_losses,
    total_shots: totalShots,
    total_hits: totalHits,
    accuracy: totalShots === 0 ? 0 : Number((totalHits / totalShots).toFixed(3)),
  };
}

function serializeGame(game, players) {
  const alivePlayers = players.filter((p) => !p.eliminated_at);
  return {
    game_id: Number(game.id),
    grid_size: game.grid_size,
    max_players: game.max_players,
    status: game.status,
    current_turn_index: game.current_turn_index,
    current_player_id:
      alivePlayers.find((p) => p.turn_order === game.current_turn_index)?.player_id || null,
    active_players: alivePlayers.length,
    winner_id: game.winner_id,
    created_at: game.created_at,
    finished_at: game.finished_at,
    players: players.map((p) => ({
      player_id: p.player_id,
      username: p.display_name,
      turn_order: p.turn_order,
      placement_done: p.placement_done,
      is_ai: p.is_ai,
      eliminated: Boolean(p.eliminated_at),
    })),
  };
}

async function maybeActivateGame(client, gameId) {
  const { game, players } = await getGameWithPlayers(client, gameId);
  const enoughPlayers = players.length >= 2;
  const allPlaced = players.length > 0 && players.every((p) => p.placement_done);

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

function nextAliveTurnOrder(players, currentTurnOrder) {
  const alive = players.filter((p) => !p.eliminated_at).sort((a, b) => a.turn_order - b.turn_order);
  if (alive.length <= 1) return null;
  const currentIndex = alive.findIndex((p) => p.turn_order === currentTurnOrder);
  if (currentIndex === -1) return alive[0].turn_order;
  return alive[(currentIndex + 1) % alive.length].turn_order;
}

async function finalizeGameStats(client, gameId, winnerId) {
  const participantsResult = await client.query(
    'SELECT player_id FROM game_players WHERE game_id = $1',
    [gameId]
  );
  const playerIds = participantsResult.rows.map((r) => r.player_id);
  if (playerIds.length === 0) return;

  await client.query(
    `UPDATE players
     SET total_games = total_games + 1,
         total_wins = total_wins + CASE WHEN id = $2 THEN 1 ELSE 0 END,
         total_losses = total_losses + CASE WHEN id <> $2 THEN 1 ELSE 0 END
     WHERE id = ANY($1::bigint[])`,
    [playerIds, winnerId]
  );
}

function requireTestMode(req, res, next) {
  if (req.get('X-Test-Password') !== TEST_PASSWORD) {
    return res.status(403).json({ error: 'Invalid test password' });
  }
  next();
}

function resolveTargetPlayer(players, shooterId, requestedTargetId = null) {
  const aliveOpponents = players.filter((p) => p.player_id !== shooterId && !p.eliminated_at);
  if (aliveOpponents.length === 0) {
    return null;
  }
  if (requestedTargetId) {
    const target = aliveOpponents.find((p) => p.player_id === requestedTargetId);
    if (!target) {
      throw badRequest('Invalid target_player_id');
    }
    return target.player_id;
  }
  if (aliveOpponents.length === 1) {
    return aliveOpponents[0].player_id;
  }
  return aliveOpponents[0].player_id;
}

app.get('/api/health', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT NOW() AS now');
  res.json({ status: 'ok', now: result.rows[0].now, test_mode: TEST_MODE });
}));

app.post('/api/reset', asyncHandler(async (req, res) => {
  await pool.query('TRUNCATE TABLE moves, ships, game_players, games, players RESTART IDENTITY CASCADE');
  res.json({ status: 'reset' });
}));

app.post('/api/players', asyncHandler(async (req, res) => {
  const { player_id, playerId } = req.body || {};
  if (player_id !== undefined || playerId !== undefined) {
    throw badRequest('Client-supplied playerId is not allowed');
  }

  const normalized = normalizeName(req.body);
  if (!normalized) {
    throw badRequest('username is required');
  }

  const result = await pool.query(
    `INSERT INTO players (display_name)
     VALUES ($1)
     ON CONFLICT (display_name)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [normalized]
  );

  res.status(201).json({ player_id: result.rows[0].id });
}));

app.get('/api/players/:id', asyncHandler(async (req, res) => {
  const playerId = toPositiveInteger(req.params.id);
  const stats = await getStats(pool, playerId);
  res.json(stats);
}));

app.get('/api/players/:id/stats', asyncHandler(async (req, res) => {
  const playerId = toPositiveInteger(req.params.id);
  const stats = await getStats(pool, playerId);
  res.json(stats);
}));

app.post('/api/games', asyncHandler(async (req, res) => {
  const { grid_size, max_players, is_ai } = req.body || {};
  const gridSize = Number.isInteger(grid_size) ? grid_size : null;
  const maxPlayers = max_players === undefined ? 3 : toPositiveInteger(max_players);

  if (!Number.isInteger(gridSize) || gridSize < 5 || gridSize > 15) {
    throw badRequest('grid_size must be an integer between 5 and 15');
  }
  if (!maxPlayers || maxPlayers < 2 || maxPlayers > 50) {
    throw badRequest('max_players must be an integer between 2 and 50');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const creator = await getOrCreatePlayer(client, req.body || {});
    const gameResult = await client.query(
      `INSERT INTO games (creator_id, grid_size, max_players, status, current_turn_index)
       VALUES ($1, $2, $3, 'waiting', 0)
       RETURNING *`,
      [creator?.id || null, gridSize, maxPlayers]
    );

    if (creator) {
      await client.query(
        `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
         VALUES ($1, $2, 0, $3)`,
        [gameResult.rows[0].id, creator.id, Boolean(is_ai)]
      );
    }

    await client.query('COMMIT');
    const gameState = await maybeActivateGame(pool, gameResult.rows[0].id);
    res.status(201).json(gameState);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

    if (game.status === 'finished') {
      throw conflict('Game already finished');
    }
    if (players.length >= game.max_players) {
      throw conflict('Game is full');
    }

    const player = await getOrCreatePlayer(client, req.body || {});
    if (!player) {
      throw badRequest('player_id or username is required');
    }

    const alreadyInGame = players.some((p) => p.player_id === player.id);
    if (alreadyInGame) {
      throw conflict('Player already joined this game');
    }

    const nextTurn = players.length;
    await client.query(
      `INSERT INTO game_players (game_id, player_id, turn_order, is_ai)
       VALUES ($1, $2, $3, $4)`,
      [gameId, player.id, nextTurn, Boolean(req.body?.is_ai)]
    );

    await client.query('COMMIT');
    const gameState = await maybeActivateGame(pool, gameId);
    res.status(201).json({
      joined: true,
      player_id: player.id,
      username: player.display_name,
      game: gameState,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw conflict('Player already joined this game');
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

app.post('/api/games/:id/place', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const resolvedPlayerId = toPositiveInteger(req.body?.player_id ?? req.body?.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!resolvedPlayerId) {
    throw badRequest('Invalid player_id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);

    if (game.status !== 'waiting') {
      throw conflict('Ships can only be placed while the game is waiting');
    }

    const membership = players.find((p) => p.player_id === resolvedPlayerId);
    if (!membership) {
      throw badRequest('Player is not part of this game');
    }
    if (membership.placement_done) {
      throw conflict('Ships have already been placed for this player');
    }

    validateCoordinates(req.body?.ships, game.grid_size);

    const ships = req.body.ships;
    const existingOwnShips = await client.query(
      `SELECT row, col
       FROM ships
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, resolvedPlayerId]
    );

    if (existingOwnShips.rowCount > 0) {
      throw conflict('Ships have already been placed for this player');
    }

    for (const ship of ships) {
      await client.query(
        `INSERT INTO ships (game_id, player_id, row, col)
         VALUES ($1, $2, $3, $4)`,
        [gameId, resolvedPlayerId, ship.row, ship.col]
      );
    }

    await client.query(
      `UPDATE game_players
       SET placement_done = true
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, resolvedPlayerId]
    );

    await client.query('COMMIT');
    const gameState = await maybeActivateGame(pool, gameId);
    res.status(200).json({ status: 'ships_placed', game: gameState });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw badRequest('Duplicate ship coordinates are not allowed');
    }
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/games/:id/fire', asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const resolvedPlayerId = toPositiveInteger(req.body?.player_id ?? req.body?.playerId);
  const targetPlayerIdParam = toPositiveInteger(req.body?.target_player_id ?? req.body?.targetPlayerId);
  const { row, col } = req.body || {};

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!resolvedPlayerId) {
    throw badRequest('Invalid player_id');
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw badRequest('row and col must be integers');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);

    if (game.status === 'waiting') {
      throw conflict('Firing is not allowed until all players have placed ships');
    }
    if (game.status === 'finished') {
      throw gone('Game is finished');
    }

    const membership = players.find((p) => p.player_id === resolvedPlayerId);
    if (!membership) {
      throw badRequest('Player is not part of this game');
    }
    if (membership.eliminated_at) {
      throw conflict('Eliminated players cannot move');
    }
    if (row < 0 || row >= game.grid_size || col < 0 || col >= game.grid_size) {
      throw badRequest('Shot is out of bounds');
    }
    if (membership.turn_order !== game.current_turn_index) {
      throw conflict('It is not this player\'s turn');
    }

    const targetPlayerId = resolveTargetPlayer(players, resolvedPlayerId, targetPlayerIdParam);
    if (!targetPlayerId) {
      throw conflict('No valid target player remains');
    }

    const duplicateMove = await client.query(
      'SELECT id FROM moves WHERE game_id = $1 AND target_player_id = $2 AND row = $3 AND col = $4',
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
    let sunkPlayer = null;

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
        sunkPlayer = hitPlayerId;
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
    const alivePlayers = updatedPlayers.filter((p) => !p.eliminated_at);

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

    await client.query('COMMIT');

    const nextPlayerId =
      nextTurn === null
        ? null
        : updatedPlayers.find((p) => p.turn_order === nextTurn && !p.eliminated_at)?.player_id || null;

    res.json({
      move_id: moveResult.rows[0].id,
      result,
      sunk_player_id: sunkPlayer,
      next_player_id: nextPlayerId,
      game_status: gameStatus,
      winner_id: winnerId,
    });
  } catch (error) {
    await client.query('ROLLBACK');
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

  const result = await pool.query(
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

  res.json({
    game_id: gameId,
    moves: result.rows.map((row) => ({
      move_id: row.move_id,
      player_id: row.player_id,
      username: row.display_name,
      target_player_id: row.target_player_id,
      target_username: row.target_display_name,
      row: row.row,
      col: row.col,
      result: row.result,
      hit_player_id: row.hit_player_id,
      hit_username: row.hit_display_name,
      created_at: row.created_at,
    })),
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
  const resolvedPlayerId = toPositiveInteger(req.body?.player_id ?? req.body?.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!resolvedPlayerId) {
    throw badRequest('Invalid player_id');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { game, players } = await getGameWithPlayers(client, gameId);
    const membership = players.find((p) => p.player_id === resolvedPlayerId);

    if (!membership) {
      throw badRequest('Player is not part of this game');
    }

    validateCoordinates(req.body?.ships, game.grid_size);

    await client.query('DELETE FROM ships WHERE game_id = $1 AND player_id = $2', [gameId, resolvedPlayerId]);

    for (const ship of req.body.ships) {
      await client.query(
        `INSERT INTO ships (game_id, player_id, row, col)
         VALUES ($1, $2, $3, $4)`,
        [gameId, resolvedPlayerId, ship.row, ship.col]
      );
    }

    await client.query(
      `UPDATE game_players
       SET placement_done = true,
           eliminated_at = NULL
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, resolvedPlayerId]
    );

    await client.query('COMMIT');
    const gameState = await maybeActivateGame(pool, gameId);

    res.json({ status: 'ships_set', player_id: resolvedPlayerId, game: gameState });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/test/games/:id/board/:playerId', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = toPositiveInteger(req.params.id);
  const playerId = toPositiveInteger(req.params.playerId);

  if (!gameId) {
    throw badRequest('Invalid game id');
  }
  if (!playerId) {
    throw badRequest('Invalid player_id');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  const membership = players.find((p) => p.player_id === playerId);

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
