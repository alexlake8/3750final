const state = {
  pendingFleet: [
    { id: "carrier", length: 5, orientation: "horizontal", row: null, col: null },
    { id: "battleship", length: 4, orientation: "horizontal", row: null, col: null },
    { id: "cruiser", length: 3, orientation: "horizontal", row: null, col: null }
  ],
  placedShips: [],
  draggedShipId: null
};

function getPendingShipById(id) {
  return state.pendingFleet.find(s => s.id === id);
}

function getShipCells(ship, orientation, row, col) {
  return Array.from({ length: ship.length }, (_, i) => ({
    row: row + (orientation === "vertical" ? i : 0),
    col: col + (orientation === "horizontal" ? i : 0)
  }));
}

function validatePlacement(ship, row, col) {
  const cells = getShipCells(ship, ship.orientation, row, col);

  for (const c of cells) {
    if (c.row < 0 || c.row >= 8 || c.col < 0 || c.col >= 8) {
      throw new Error("out of bounds");
    }
  }

  for (const placed of state.placedShips) {
    for (const c of cells) {
      if (placed.cells.some(pc => pc.row === c.row && pc.col === c.col)) {
        throw new Error("overlap");
      }
    }
  }
}

// ===== DRAG FIX =====
function handleDragStart(e) {
  const ship = e.target.closest("[data-draggable-ship-id]");
  if (!ship || !e.dataTransfer) return;

  state.draggedShipId = ship.dataset.draggableShipId;

  // remove ghost image
  const img = document.createElement("canvas");
  img.width = 1;
  img.height = 1;
  e.dataTransfer.setDragImage(img, 0, 0);
}

// ===== PREVIEW =====
function clearPreview() {
  document.querySelectorAll(".cell.preview-valid, .cell.preview-invalid")
    .forEach(c => c.classList.remove("preview-valid", "preview-invalid"));
}

function handleDragOver(e) {
  const cell = e.target.closest(".cell");
  if (!cell) {
    clearPreview();
    return;
  }

  e.preventDefault();

  const ship = getPendingShipById(state.draggedShipId);
  if (!ship) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);

  clearPreview();

  const cells = getShipCells(ship, ship.orientation, row, col);

  let valid = true;
  try {
    validatePlacement(ship, row, col);
  } catch {
    valid = false;
  }

  cells.forEach(c => {
    const el = document.querySelector(
      `.cell[data-row="${c.row}"][data-col="${c.col}"]`
    );
    if (el) {
      el.classList.add(valid ? "preview-valid" : "preview-invalid");
    }
  });
}

// ===== DROP =====
function handleDrop(e) {
  const cell = e.target.closest(".cell");
  if (!cell) {
    clearPreview();
    return;
  }

  e.preventDefault();

  const ship = getPendingShipById(state.draggedShipId);
  if (!ship) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);

  try {
    validatePlacement(ship, row, col);

    const cells = getShipCells(ship, ship.orientation, row, col);

    state.placedShips.push({ id: ship.id, cells });
    state.pendingFleet = state.pendingFleet.filter(s => s.id !== ship.id);

    renderBoard();
  } catch {
    console.log("invalid placement");
  }

  clearPreview();
}

// ===== BOARD RENDER =====
function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;

      // ships
      for (const ship of state.placedShips) {
        if (ship.cells.some(sc => sc.row === r && sc.col === c)) {
          cell.classList.add("ship");
        }
      }

      // 🔥 NO TEXT CONTENT (fix double markers)

      board.appendChild(cell);
    }
  }
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("drop", handleDrop);

  renderBoard();
});
