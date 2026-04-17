const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const STORAGE_KEY = 'battleship-phase2-state';

const state = {
  username: '',
  playerId: null,
  activeGameId: null,
  currentGame: null,
  myStats: null,
  myShips: [],
  pendingShips: [],
  pendingFleet: createDefaultFleet(),
  moveHistory: [],
  games: [],
  leaderboard: [],
  error: '',
  success: '',
  pollHandle: null,
  busy: false,
  joinGameIdDraft: '',
  currentPage: 1,
  gamesPerPage: 5,
};

loadLocalState();
bootstrap();

function renderLobbyGames() {
  if (!state.games.length) {
    return `<div class="small">No games yet.</div>`;
  }

  const totalPages = Math.ceil(state.games.length / state.gamesPerPage) || 1;

  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }

  const start = (state.currentPage - 1) * state.gamesPerPage;
  const paginatedGames = state.games.slice(start, start + state.gamesPerPage);

  return `
    <div class="game-list">
      ${paginatedGames.map((game) => {
        const isOpen = game.status === 'waiting';
        const isCurrent = game.id === state.activeGameId;
        return `
          <div class="game-card ${isCurrent ? 'current' : ''}">
            <div>
              <strong>Game ${game.id}</strong>
              <div class="small">
                Game ID: <strong>${game.id}</strong> • 
                ${game.grid_size}×${game.grid_size} • 
                ${game.player_count}/${game.max_players} players
              </div>
            </div>
            <div class="game-actions">
              <span class="badge ${game.status === 'active' ? 'active' : ''}">
                ${game.status}
              </span>
              <button class="ghost" data-action="copy-game-id" data-game-id="${game.id}">
                Copy ID
              </button>
              <button class="ghost" data-action="open-game" data-game-id="${game.id}">
                ${isCurrent ? 'Open' : 'View'}
              </button>
              ${isOpen ? `
                <button data-action="join-game" data-game-id="${game.id}" ${!state.playerId ? 'disabled' : ''}>
                  Join
                </button>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="pagination-controls">
      <button class="ghost" data-action="prev-page" ${state.currentPage === 1 ? 'disabled' : ''}>
        Prev
      </button>
      <span class="small">Page ${state.currentPage} of ${totalPages}</span>
      <button class="ghost" data-action="next-page" ${state.currentPage === totalPages ? 'disabled' : ''}>
        Next
      </button>
    </div>
  `;
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  try {
    const action = target.dataset.action;

    if (action === 'prev-page') {
      state.currentPage = Math.max(1, state.currentPage - 1);
      render();
      return;
    }

    if (action === 'next-page') {
      const totalPages = Math.ceil(state.games.length / state.gamesPerPage) || 1;
      state.currentPage = Math.min(totalPages, state.currentPage + 1);
      render();
      return;
    }
  } catch (err) {
    console.error(err);
  }
}
