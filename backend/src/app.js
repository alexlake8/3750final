const express = require('express');
    res.json({
      status: 'ships_set',
      player_id: resolvedPlayerId,
      game: gameState,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/test/games/:id/board/:playerId', requireTestMode, asyncHandler(async (req, res) => {
  const gameId = Number(req.params.id);
  const { playerId } = req.params;
  if (!Number.isInteger(gameId) || gameId <= 0) {
    throw badRequest('Invalid game id');
  }
  if (!isUuid(playerId)) {
    throw forbidden('Invalid player_id');
  }

  const { game, players } = await getGameWithPlayers(pool, gameId);
  const membership = players.find((p) => p.player_id === playerId);
  if (!membership) {
    throw forbidden('Player is not part of this game');
  }

  const ships = await pool.query(
    `SELECT row, col, destroyed_at
     FROM ships
     WHERE game_id = $1 AND player_id = $2
     ORDER BY row ASC, col ASC`,
    [gameId, playerId]
  );

  const moves = await pool.query(
    `SELECT row, col, result, player_id
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

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
