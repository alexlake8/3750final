console.log('ENV CHECK:', !!process.env.DATABASE_URL, process.env.PORT);
require('dotenv').config();
const app = require('./app');
const { initDb } = require('./db');

const PORT = Number(process.env.PORT || 10000);

// Start listening immediately so Render detects the port
app.listen(PORT, () => {
  console.log(`Battleship API listening on port ${PORT}`);
});

// Then init the DB in the background
initDb().catch((error) => {
  console.error('Failed to initialize database', error);
  process.exit(1);
});
