const { Pool } = require('pg');
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_games INTEGER NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      total_moves INTEGER NOT NULL DEFAULT 0,
      total_hits INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id BIGSERIAL PRIMARY KEY,
      creator_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
      grid_size INTEGER NOT NULL CHECK (grid_size BETWEEN 5 AND 15),
      max_players INTEGER NOT NULL CHECK (max_players >= 1),
      status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'finished')),
      current_turn_index INTEGER NOT NULL DEFAULT 0,
      winner_id UUID REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_players (
      game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      turn_order INTEGER NOT NULL,
      is_ai BOOLEAN NOT NULL DEFAULT false,
      placement_done BOOLEAN NOT NULL DEFAULT false,
      eliminated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (game_id, player_id),
      UNIQUE (game_id, turn_order)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ships (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      destroyed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game_id, row, col),
      UNIQUE (game_id, player_id, row, col)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moves (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('hit', 'miss')),
      hit_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game_id, row, col)
    );
  `);
}

module.exports = {
  pool,
  initDb,
};
