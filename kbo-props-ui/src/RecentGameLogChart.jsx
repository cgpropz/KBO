import React from 'react';
import { lineResult, overHitRate } from './hitRateStrip';
import GameDateLogo from './GameDateLogo';
import { kboLogoUrl } from './slipBoardModel';
import './RecentGameLogChart.css';

function entryResult(entry, line) {
  if (line != null) return lineResult(entry.value, line)
  if (entry.hit === true) return 'hit'
  if (entry.hit === false) return 'miss'
  return 'miss'
}

function RecentGameLogChart({ name, prop, line, entries = [], hitRate }) {
  const validEntries = entries.filter((entry) => Number.isFinite(Number(entry?.value)));
  const chartEntries = [...validEntries].reverse();
  const rated = line != null ? overHitRate(validEntries.map((entry) => entry.value), line) : null
  const hits = rated ? rated.hits : validEntries.filter((entry) => entry.hit === true).length
  const decided = rated ? rated.games : validEntries.length
  const displayRate = line != null
    ? (rated ? `${rated.rate}%` : '—')
    : Number.isFinite(Number(hitRate))
      ? `${Number(hitRate).toFixed(0)}%`
      : validEntries.length
        ? `${Math.round((hits / validEntries.length) * 100)}%`
        : '—'

  return (
    <div className="rgl-chart" aria-label={`${name} last 10 game log`}>
      <div className="rgl-chart-header">
        <div>
          <span className="rgl-kicker">Last 10 game log</span>
          <strong>{name}</strong>
          <span className="rgl-subtitle">{prop} {line != null ? `· Line ${Number(line).toFixed(1)}` : ''}</span>
        </div>
        <div className="rgl-summary"><strong>{displayRate}</strong><span>{hits}/{decided} over</span></div>
      </div>
      {validEntries.length ? (
        <div className="rgl-bars">
          {chartEntries.map((entry, index) => {
            const value = Number(entry.value);
            const max = Math.max(Number(line) || 0, ...validEntries.map((item) => Number(item.value)), 1);
            const height = Math.max(10, Math.round((value / max) * 100));
            const kind = entryResult(entry, line) || 'miss'
            return (
              <div className="rgl-bar-item" key={`${entry.date || index}-${index}`} title={`${entry.date || `Game ${index + 1}`}: ${value}`}>
                <span className={`rgl-value${kind === 'push' ? ' is-push' : ''}`}>{Number.isInteger(value) ? value : value.toFixed(1)}</span>
                <div className={`rgl-bar rgl-${kind}`} style={{ height: `${height}%` }} />
                <span className="rgl-date">
                  {entry.date
                    ? <GameDateLogo date={entry.date} team={entry.opponent} logo={kboLogoUrl(entry.opponent)} />
                    : `G${index + 1}`}
                </span>
              </div>
            );
          })}
          {line != null && <div className="rgl-line" style={{ bottom: `${Math.max(8, Math.min(92, (Number(line) / Math.max(Number(line) || 0, ...validEntries.map((item) => Number(item.value)), 1)) * 100))}%` }}><span>line {Number(line).toFixed(1)}</span></div>}
        </div>
      ) : (
        <div className="rgl-empty">No game-log values are available for this player.</div>
      )}
    </div>
  );
}

export default RecentGameLogChart;
