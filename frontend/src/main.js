// ===== STATE =====
let pendingShips = [];
let placedShips = [];
let draggedShipId = null;

// ===== HELPERS =====
function getPendingShipById(id) {
  return pendingShips.find(s => String(s.id) === String(id));
}

function getShipCells(ship, orientation, row, col) {
  const cells = [];
  for (let i = 0; i < ship.length; i++) {
    cells.push({
      row: orientation === "vertical" ? row + i : row,
      col: orientation === "horizontal" ? col + i : col
    });
  }
  return cells;
}

function validatePendingShipPlacement(ship, row, col) {
  const cells = getShipCells(ship, ship.orientation, row, col);

  for (const c of cells) {
    if (c.row < 0 || c.row >= 8 || c.col < 0 || c.col >= 8) {
      throw new Error("out of bounds");
    }
  }

  for (const placed of placedShips) {
    for (const c of cells) {
      if (placed.cells.some(pc => pc.row === c.row && pc.col === c.col)) {
        throw new Error("overlap");
      }
    }
  }
}

// ===== DRAG START (FIX GHOST IMAGE) =====
function handleDragStart(e) {
  const ship = e.target.closest("[data-draggable-ship-id]");
  if (!ship) return;

  draggedShipId = ship.dataset.draggableShipId;

  // remove ugly drag ghost
  const img = new Image();
  img.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  e.dataTransfer.setDragImage(img, 0, 0);
}

// ===== DRAG OVER (PREVIEW CELLS) =====
function handleDragOver(e) {
  const cell = e.target.closest(".cell");
  if (!cell) return;

  e.preventDefault();

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);

  document.querySelectorAll(".cell.preview-valid, .cell.preview-invalid")
    .forEach(c => c.classList.remove("preview-valid", "preview-invalid"));

  const ship = getPendingShipById(draggedShipId);
  if (!ship) return;

  const cells = getShipCells(ship, ship.orientation, row, col);

  let valid = true;
  try {
    validatePendingShipPlacement(ship, row, col);
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

// ===== DROP SHIP =====
function handleDrop(e) {
  const cell = e.target.closest(".cell");
  if (!cell) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);

  const ship = getPendingShipById(draggedShipId);
  if (!ship) return;

  try {
    validatePendingShipPlacement(ship, row, col);

    const cells = getShipCells(ship, ship.orientation, row, col);

    placedShips.push({
      id: ship.id,
      cells
    });

    pendingShips = pendingShips.filter(s => s.id !== ship.id);

    renderBoard();

  } catch (err) {
    console.log("Invalid placement");
  }

  document.querySelectorAll(".cell.preview-valid, .cell.preview-invalid")
    .forEach(c => c.classList.remove("preview-valid", "preview-invalid"));
}

// ===== RENDER BOARD =====
function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;

      // ship rendering
      for (const ship of placedShips) {
        if (ship.cells.some(sc => sc.row === r && sc.col === c)) {
          cell.classList.add("ship");
        }
      }

      board.appendChild(cell);
    }
  }
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("drop", handleDrop);
});
