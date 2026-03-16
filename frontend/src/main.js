const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STORAGE_KEY = 'battleship-vanilla-state';

const state = {
  username: '',
  playerId: null,
  gameId: null,
  game: null,
  stats: null,
  moves: [],
  myShips: [],
  placingShips: [],
  loading: false,
  error: '',
  success: '',
  pollHandle: null,
};

loadLocalState();
bootstrap();

function bootstrap() {
  render();
  attachGlobalEvents();

  if (state.playerId) {
    refreshStats().catch(() => {});
  }
  if (state.gameId) {
    refreshGame(true).catch(() => {});
    startPolling();
  }
}
