import React from 'react';
import './RecentGameLogChart.css';

function RecentGameLogChart({ name, prop, line, entries = [], hitRate }) {
  const validEntries = entries.filter((entry) => Number.isFinite(Number(entry?.value)));
  const chartEntries = [...validEntries].reverse();
  const hits = validEntries.filter((entry) => entry.hit === true).length;
  const displayRate = Number.isFinite(Number(hitRate))
    ? `${Number(hitRate).toFixed(0)}%`
    : validEntries.length
      ? `${Math.round((hits / validEntries.length) * 100)}%`
      : '—';

  return (
    <div className="rgl-chart" aria-label={`${name} last 10 game log`}>
      <div className="rgl-chart-header">
        <div>
          <span className="rgl-kicker">Last 10 game log</span>
          <strong>{name}</strong>
          <span className="rgl-subtitle">{prop} {line != null ? `· Line ${Number(line).toFixed(1)}` : ''}</span>
        </div>
        <div className="rgl-summary"><strong>{displayRate}</strong><span>{hits}/{validEntries.length} over</span></div>
      </div>
      {validEntries.length ? (
        <div className="rgl-bars">
          {chartEntries.map((entry, index) => {
            const value = Number(entry.value);
            const max = Math.max(Number(line) || 0, ...validEntries.map((item) => Number(item.value)), 1);
            const height = Math.max(10, Math.round((value / max) * 100));
            const isHit = entry.hit === true || (entry.hit == null && line != null && value > Number(line));
            return (
              <div className="rgl-bar-item" key={`${entry.date || index}-${index}`} title={`${entry.date || `Game ${index + 1}`}: ${value}`}>
                <span className="rgl-value">{Number.isInteger(value) ? value : value.toFixed(1)}</span>
                <div className={`rgl-bar ${isHit ? 'rgl-hit' : 'rgl-miss'}`} style={{ height: `${height}%` }} />
                <span className="rgl-date">{entry.date ? String(entry.date).slice(0, 5) : `G${index + 1}`}</span>
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
