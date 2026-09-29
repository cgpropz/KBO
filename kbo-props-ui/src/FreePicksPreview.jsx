import { useEffect, useState } from 'react';
import { fetchApiDataset } from './apiData';
import './FreeFunnel.css';

/*
 * Landing-page "today's free picks" card for logged-out visitors.
 * Renders exactly what the public /api/data preview already returns (the top 3
 * lines per board + lockedCount); nothing extra is requested or exposed.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (v, digits = 1) => {
  const n = num(v);
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
};
const ratio = (projection, line) => (num(line) > 0 && Number.isFinite(num(projection)) ? (num(projection) / num(line)) * 50 : -Infinity);

function kboRows(data) {
  const rows = [];
  (data?.cards || []).forEach((card) => (card?.props || []).forEach((prop) => {
    const cg = num(prop?.cg_projection ?? prop?.rating);
    rows.push({
      player: card.name,
      matchup: [card.team, card.opponent].filter(Boolean).join(' vs '),
      stat: prop.stat,
      line: prop.line,
      projection: prop.projection ?? prop.avg,
      hitRate: prop.hit_rate_l10,
      tag: prop.odds_type && prop.odds_type !== 'standard' ? prop.odds_type : null,
      score: Number.isFinite(cg) ? cg : ratio(prop.projection ?? prop.avg, prop.line),
    });
  }));
  return rows;
}

function nflRows(data) {
  return (Array.isArray(data) ? data : []).map((row) => ({
    player: row.player,
    matchup: [row.team, row.opponent].filter(Boolean).join(' vs '),
    stat: row.prop,
    line: row.line,
    projection: row.projection,
    hitRate: row.hitRate,
    tag: null,
    score: ratio(row.projection, row.line),
  }));
}

function wnbaRows(data) {
  const rows = [];
  (Array.isArray(data) ? data : []).forEach((player) => (player?.ppAllProps || []).forEach((prop) => {
    const line = prop.standardLine ?? prop.line;
    rows.push({
      player: player.name,
      matchup: [player.team, prop.opponent || prop.versus].filter(Boolean).join(' vs '),
      stat: prop.stat,
      line,
      projection: prop.projection,
      hitRate: null,
      tag: null,
      score: ratio(prop.projection, line),
    });
  }));
  return rows;
}

const BOARDS = [
  { id: 'kbo', emoji: '⚾', label: 'KBO', ds: 'prizepicks_props', toRows: kboRows },
  { id: 'nfl', emoji: '🏈', label: 'NFL', ds: 'nfl_projections', toRows: nflRows },
  { id: 'wnba', emoji: '🏀', label: 'WNBA', ds: 'wnba_projections_standard', toRows: wnbaRows },
];

function updatedLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function FreePicksPreview({ onSignUp, onOpenBoard, onSeePlans }) {
  const [boards, setBoards] = useState({});
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    BOARDS.forEach((board) => {
      fetchApiDataset(board.ds)
        .then((snap) => {
          if (!active) return;
          const rows = board.toRows(snap.data)
            .filter((r) => r.player && r.stat)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
          setBoards((prev) => ({ ...prev, [board.id]: { status: rows.length ? 'ready' : 'empty', rows, lockedCount: snap.lockedCount || 0, updatedAt: snap.updatedAt } }));
        })
        .catch(() => {
          if (active) setBoards((prev) => ({ ...prev, [board.id]: { status: 'error', rows: [], lockedCount: 0 } }));
        });
    });
    return () => { active = false; };
  }, []);

  const available = BOARDS.filter((b) => boards[b.id]?.status === 'ready');
  const settled = BOARDS.every((b) => boards[b.id] && boards[b.id].status !== 'loading');
  if (settled && !available.length) return null; // nothing live to show

  const activeBoard = available.find((b) => b.id === selected) || available[0] || null;
  const state = activeBoard ? boards[activeBoard.id] : null;

  return (
    <section className="ff-picks" id="free-picks" aria-labelledby="ff-picks-title">
      <div className="ff-picks-head">
        <div>
          <span className="ff-kicker"><span className="ff-live-dot" aria-hidden="true" /> Today's free picks</span>
          <h2 id="ff-picks-title">Top 3 plays on the board right now</h2>
          <p>Straight from the CGPropz model. No account needed.</p>
        </div>
        {available.length > 1 && (
          <div className="ff-tabs" role="tablist" aria-label="Sport">
            {available.map((b) => (
              <button
                key={b.id}
                role="tab"
                aria-selected={activeBoard?.id === b.id}
                className={`ff-tab${activeBoard?.id === b.id ? ' active' : ''}`}
                onClick={() => setSelected(b.id)}
              >
                {b.emoji} {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ff-picks-card">
        {!activeBoard ? (
          <div className="ff-picks-loading" aria-live="polite">
            {[0, 1, 2].map((i) => <div key={i} className="ff-skeleton" />)}
          </div>
        ) : (
          <>
            <div className="ff-picks-meta">
              <span>{activeBoard.emoji} {activeBoard.label} · PrizePicks board</span>
              {updatedLabel(state.updatedAt) && <span>{updatedLabel(state.updatedAt)}</span>}
            </div>
            <ol className="ff-pick-list">
              {state.rows.map((row, i) => {
                const over = num(row.projection) >= num(row.line);
                return (
                  <li key={`${row.player}-${row.stat}-${row.line}-${i}`} className="ff-pick">
                    <span className="ff-pick-rank">{i + 1}</span>
                    <div className="ff-pick-main">
                      <strong>{row.player}</strong>
                      <small>{row.matchup}</small>
                    </div>
                    <div className="ff-pick-line">
                      <span className={`ff-dir ${over ? 'over' : 'under'}`}>{over ? 'OVER' : 'UNDER'}</span>
                      <span>{fmt(row.line)} {row.stat}</span>
                      {row.tag && <em className="ff-tag">{row.tag}</em>}
                    </div>
                    <div className="ff-pick-stats">
                      <span><b>{fmt(row.projection)}</b> proj</span>
                      {Number.isFinite(num(row.hitRate)) && <span><b>{fmt(row.hitRate, 0)}%</b> L10</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
            {state.lockedCount > 0 && (
              <button className="ff-unlock" onClick={onSeePlans}>
                <span aria-hidden="true">🔒</span>
                <span>
                  <strong>Unlock the other {state.lockedCount} {activeBoard.label} lines</strong>
                  <small>Full model boards from $9.99/week</small>
                </span>
                <span className="ff-unlock-arrow" aria-hidden="true">→</span>
              </button>
            )}
            <div className="ff-picks-actions">
              <button className="ff-btn ff-btn-primary" onClick={onSignUp}>Sign up free</button>
              <button className="ff-btn ff-btn-ghost" onClick={() => onOpenBoard?.(activeBoard.id)}>Open the free {activeBoard.label} board →</button>
            </div>
          </>
        )}
      </div>
      <p className="ff-disclaimer">For entertainment purposes only. Lines move; always check the current line before you play.</p>
    </section>
  );
}
