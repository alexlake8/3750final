const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,  // ← add this line
  idleTimeoutMillis: 30000,       // ← and this
});



async function resetSchemaIfNeeded() {
  const result = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'players' AND column_name = 'id') OR
        (table_name = 'games' AND column_name = 'creator_id') OR
        (table_name = 'games' AND column_name = 'winner_id') OR
        (table_name = 'game_players' AND column_name = 'player_id') OR
        (table_name = 'ships' AND column_name = 'player_id') OR
        (table_name = 'moves' AND column_name = 'player_id') OR
        (table_name = 'moves' AND column_name = 'target_player_id') OR
        (table_name = 'moves' AND column_name = 'hit_player_id')
      )
  `);

  if (result.rowCount === 0) {
    return;
  }

  const expected = new Map([
    ['players.id', 'uuid'],
    ['games.creator_id', 'uuid'],
    ['games.winner_id', 'uuid'],
    ['game_players.player_id', 'uuid'],
    ['ships.player_id', 'uuid'],
    ['moves.player_id', 'uuid'],
    ['moves.target_player_id', 'uuid'],
    ['moves.hit_player_id', 'uuid'],
  ]);

  const actual = new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));

  const schemaMismatch =
    result.rowCount !== expected.size ||
    [...expected.entries()].some(([key, value]) => actual.get(key) !== value);

  if (!schemaMismatch) {
    return;
  }

  await pool.query(`
    DROP TABLE IF EXISTS moves CASCADE;
    DROP TABLE IF EXISTS ships CASCADE;
    DROP TABLE IF EXISTS game_players CASCADE;
    DROP TABLE IF EXISTS games CASCADE;
    DROP TABLE IF EXISTS players CASCADE;
  `);
}

async function initDb() {
  await resetSchemaIfNeeded();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY,
      display_name TEXT NOT NULL UNIQUE,
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
      creator_id UUID REFERENCES players(id) ON DELETE SET NULL,
      grid_size INTEGER NOT NULL CHECK (grid_size BETWEEN 5 AND 15),
      max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 10),
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
      UNIQUE (game_id, player_id, row, col)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moves (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      target_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('hit', 'miss')),
      hit_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game_id, target_player_id, row, col)
    );
  `);
}

module.exports = {
  pool,
  initDb,
};

