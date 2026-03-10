import { useEffect, useMemo, useState } from 'react';
        </section>

        <section className="panel">
          <h2>4. Place ships</h2>
          <p>Select exactly three cells for your ships, then submit.</p>
          <div className="board" style={{ gridTemplateColumns: `repeat(${placementGrid.length}, 1fr)` }}>
            {placementGrid.flat().map((cell) => {
              const key = `${cell.row},${cell.col}`;
              const selected = selectedShips.some((s) => s.row === cell.row && s.col === cell.col);
              const existing = ownShipsSet.has(key);
              return (
                <button
                  key={`place-${key}`}
                  className={`cell ${selected ? 'selected' : ''} ${existing ? 'ship' : ''}`}
                  onClick={() => toggleShipCell(cell.row, cell.col)}
                  disabled={!game || game.status !== 'waiting' || !!boardData?.ships?.length}
                >
                  {existing ? 'S' : selected ? '•' : ''}
                </button>
              );
            })}
          </div>
          <div className="button-row">
            <button onClick={() => submitPlacement(selectedShips)} disabled={busy || selectedShips.length !== 3 || !gameId || !!boardData?.ships?.length}>
              Submit Ships
            </button>
            <button onClick={autoPlaceSelf} disabled={busy || !game || !!boardData?.ships?.length}>Auto Place</button>
          </div>
        </section>

        <section className="panel wide">
          <h2>5. Fire grid</h2>
          <p>
            Click a cell to fire when it is your turn. Hits are marked <strong>H</strong>, misses are marked{' '}
            <strong>M</strong>.
          </p>
          <div className="board battle" style={{ gridTemplateColumns: `repeat(${battleGrid.length}, 1fr)` }}>
            {battleGrid.flat().map((cell) => {
              const key = `${cell.row},${cell.col}`;
              const move = boardLookup.get(key);
              return (
                <button
                  key={`battle-${key}`}
                  className={`cell ${move?.result === 'hit' ? 'hit' : ''} ${move?.result === 'miss' ? 'miss' : ''}`}
                  onClick={() => fireAt(cell.row, cell.col)}
                  disabled={!game || game.status !== 'active' || currentTurnPlayer?.player_id !== playerId || !!move}
                >
                  {move ? (move.result === 'hit' ? 'H' : 'M') : ''}
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel wide">
          <h2>6. Move log</h2>
          {moves.length === 0 ? (
            <p>No moves yet.</p>
          ) : (
            <div className="log-list">
              {moves.map((move) => (
                <div key={move.move_id} className="log-item">
                  <strong>{move.username}</strong> fired at ({move.row}, {move.col}) → {move.result}
                  {move.hit_username ? ` on ${move.hit_username}` : ''}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
