import { useEffect, useRef, useState } from 'react';
import { observeVisibleOnce, trackFreeTop3View } from './analytics';
import { fetchApiDataset } from './apiData';
import { kboRawRating, scoreFor } from './kboBoardScore';
import { buildCgScoreExplainer } from './cgScoreExplainer';
import { WhyThisScore } from './CgScoreExplainer';
import { kboHitPills, l10Display, nflHitPills, nhlHitPills, wnbaHitPills, wnbaLoggedValues } from './hitRateStrip';
import { wnbaCgScore } from './wnba/wnbaScore';
import { nflCgScore, nflHasProjection, nflRawScore } from './nfl/nflLineFloors';
import { cgScore as plainCgScore } from './cgScore';
import { freeTop3SectionState } from './freePreviewCopy';
import { selectFreeTop3 } from './freeTopPicks';
import './FreeFunnel.css';
import './bootScreen.css';
import { lineWord } from './lineCount';

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

function kboRows(data) {
  const rows = [];
  (data?.cards || []).forEach((card) => (card?.props || []).forEach((prop) => {
    // Standard lines only, ranked by the KBO CG Score (same as the board and
    // the ledger), not by the cg_projection confidence number.
    const type = prop?.odds_type;
    if (type != null && String(type).toLowerCase() !== 'standard') return;
    const cg = scoreFor(prop);
    rows.push({
      player: card.name,
      matchup: [card.team, card.opponent].filter(Boolean).join(' vs '),
      stat: prop.stat,
      line: prop.line,
      projection: prop.projection ?? prop.avg,
      l10: l10Display(kboHitPills({ games: card.games, stat: prop.stat, line: prop.line, opponent: card.opponent })),
      tag: prop.odds_type && prop.odds_type !== 'standard' ? prop.odds_type : null,
      score: cg == null ? -Infinity : cg,
      rawScore: kboRawRating(prop.projection, prop.line, prop.stat),
      start_time: prop.start_time || card.start_time,
      game_date: prop.game_date || card.game_date,
      started: prop.started === true || card.started === true,
      locked: prop.locked === true || card.locked === true,
      removed: prop.removed === true || card.removed === true,
      rankEligible: prop.rankEligible,
      note: {
        player: card.name,
        projection: prop.projection,
        line: prop.line,
        stat: prop.stat,
        score: scoreFor(prop),
        recentValues: prop.recent_values,
        newestFirst: true,
      },
    });
  }));
  return rows;
}

// NFL uses the floored, bounded score; exactly 50 is no pick and takes no
// free slot. A blank, null or <= 0 projection is Pending and takes no free
// slot either. NHL keeps its plain line ratio.
function nflFreeScore(row) {
  if (!nflHasProjection(row.projection)) return -Infinity;
  const score = nflCgScore(row.projection, row.line, row.prop ?? row.stat);
  return score == null || score === 50 ? -Infinity : score;
}

function nhlFreeScore(row) {
  return plainCgScore(row.projection, row.line, row.prop ?? row.stat) ?? -Infinity;
}

function projectionRows(data, pillsFor, scoreFn = nflFreeScore, noteScore = (row) => nflCgScore(row.projection, row.line, row.prop ?? row.stat)) {
  return (Array.isArray(data) ? data : []).map((row) => ({
    player: row.player,
    matchup: [row.team, row.opponent].filter(Boolean).join(' vs '),
    stat: row.prop,
    line: row.line,
    projection: row.projection,
    l10: l10Display(pillsFor(row)),
    tag: null,
    score: scoreFn(row),
    rawScore: scoreFn === nflFreeScore ? nflRawScore(row.projection, row.line, row.prop ?? row.stat) : null,
    // NFL pilot rank inputs (src/sideRank.js). Not rendered.
    gamesPlayed: row.gamesPlayed,
    wagerTypes: row.wagerTypes ?? null,
    line_type: row.line_type,
    start_time: row.start_time || row.start_time_utc || row.kickoff_at,
    game_date: row.gameday || row.game_date || row.gameDate || row.game_date_iso,
    started: row.started === true,
    locked: row.locked === true,
    removed: row.removed === true,
    rankEligible: row.rankEligible,
    note: {
      player: row.player,
      projection: row.projection,
      line: row.line,
      stat: row.prop ?? row.stat,
      score: noteScore(row),
      recentValues: row.recent,
    },
  }));
}

function nflRows(data) {
  return projectionRows(data, nflHitPills);
}

function nhlRows(data) {
  return projectionRows(data, nhlHitPills, nhlFreeScore, (row) => plainCgScore(row.projection, row.line, row.prop ?? row.stat));
}

function wnbaRows(data) {
  const rows = [];
  (Array.isArray(data) ? data : []).forEach((player) => (player?.ppAllProps || []).forEach((prop) => {
    const line = prop.line;
    rows.push({
      player: player.name,
      matchup: [player.team, prop.opponent || prop.versus].filter(Boolean).join(' vs '),
      stat: prop.stat,
      line,
      projection: prop.projection,
      l10: l10Display(wnbaHitPills({
        games: player.recentGames,
        stat: prop.stat,
        line,
        opponent: prop.opponent || prop.versus,
      })),
      tag: null,
      score: wnbaCgScore(prop.projection, prop) ?? -Infinity,
      start_time: prop.start_time || player.start_time,
      game_date: prop.gameDate || prop.game_date || player.gameDate,
      started: prop.started === true || player.started === true,
      locked: prop.locked === true || player.locked === true,
      removed: prop.removed === true,
      rankEligible: prop.rankEligible,
      note: {
        player: player.name,
        projection: prop.projection,
        line,
        stat: prop.stat,
        score: wnbaCgScore(prop.projection, prop),
        recentValues: wnbaLoggedValues(player.recentGames, prop.stat),
        newestFirst: true,
      },
    });
  }));
  return rows;
}

const DEV_STATIC = {
  prizepicks_props: 'prizepicks_props.json',
  nfl_projections: 'nfl/projections.json',
  wnba_projections_standard: 'wnba/projections_standard.json',
  nhl_projections: 'nhl/projections.json',
};

const BOARDS = [
  { id: 'kbo', emoji: '⚾', label: 'KBO', ds: 'prizepicks_props', toRows: kboRows },
  { id: 'nfl', emoji: '🏈', label: 'NFL', ds: 'nfl_projections', toRows: nflRows },
  { id: 'wnba', emoji: '🏀', label: 'WNBA', ds: 'wnba_projections_standard', toRows: wnbaRows },
  { id: 'nhl', emoji: '🏒', label: 'NHL', ds: 'nhl_projections', toRows: nhlRows },
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
      fetchApiDataset(board.ds, { devStaticPath: DEV_STATIC[board.ds] })
        .then((snap) => {
          if (!active) return;
          const rows = selectFreeTop3(board.toRows(snap.data), board.id);
          setBoards((prev) => ({ ...prev, [board.id]: { status: rows.length ? 'ready' : 'empty', rows, lockedCount: snap.lockedCount || 0, updatedAt: snap.updatedAt } }));
        })
        .catch(() => {
          if (active) setBoards((prev) => ({ ...prev, [board.id]: { status: 'error', rows: [], lockedCount: 0 } }));
        });
    });
    return () => { active = false; };
  }, []);

  const available = BOARDS.filter((b) => boards[b.id]?.status === 'ready');
  const { settled, showingRows, anchorId } = freeTop3SectionState(boards);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash !== 'free-top-3' && hash !== 'free-picks') return;
    document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, [settled, showingRows, available.length]);

  // free_top3_view once per sport per page load, when the picks are on screen.
  const sectionRef = useRef(null);
  const viewSport = (available.find((b) => b.id === selected) || available[0])?.id || null;
  useEffect(() => {
    if (!showingRows || !viewSport) return undefined;
    return observeVisibleOnce(sectionRef.current, () => trackFreeTop3View(viewSport));
  }, [showingRows, viewSport]);

  if (!showingRows) {
    return (
      <section id={anchorId} aria-label="Today's free top 3">
        <h2 id="free-picks" className="ff-picks-anchor">Today's free top 3</h2>
      </section>
    );
  }

  const activeBoard = available.find((b) => b.id === selected) || available[0] || null;
  const state = activeBoard ? boards[activeBoard.id] : null;

  return (
    <section className="ff-picks" id={anchorId} aria-labelledby="free-picks" ref={sectionRef}>
      <div className="ff-picks-head">
        <div>
          <span className="ff-kicker"><span className="ff-live-dot" aria-hidden="true" /> Today's free picks</span>
          <h2 id="free-picks">Top 3 plays on the board right now</h2>
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
          <div className="ff-picks-loading" aria-live="polite" aria-busy="true">
            <span className="cg-sr">Loading today’s free picks</span>
            {[0, 1, 2].map((i) => (
              <div className="cg-pick" key={i} aria-hidden="true">
                <span className="cg-rank cg-shimmer" />
                <span className="cg-lines">
                  <i className="cg-shimmer" />
                  <i className="cg-shimmer" />
                </span>
                <span className="cg-stat cg-shimmer" />
              </div>
            ))}
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
                const note = buildCgScoreExplainer(row.note);
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
                      {note && <span><b>{note.score}</b> CG Score</span>}
                      {row.l10 && <span><b>{row.l10.text}</b> L10{row.l10.games ? ` · ${row.l10.games}` : ''}</span>}
                    </div>
                    {note && <WhyThisScore className="ff-pick-why" note={note} />}
                  </li>
                );
              })}
            </ol>
            {state.lockedCount > 0 && (
              <button className="ff-unlock" onClick={onSeePlans}>
                <span aria-hidden="true">🔒</span>
                <span>
                  <strong>Unlock the other {state.lockedCount} {activeBoard.label} {lineWord(state.lockedCount)}</strong>
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
