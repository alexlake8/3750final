require('dotenv').config();
const app = require('./app');
const { initDb } = require('./db');

const PORT = Number(process.env.PORT || 10000);

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Battleship API listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
