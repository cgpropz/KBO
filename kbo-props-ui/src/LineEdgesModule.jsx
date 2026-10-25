import { formatLineGap } from './lineEdges'
import { XWEEK_PROMO_LINE } from './promoCopy'

function sideLetter(side) {
  return side === 'UNDER' ? 'U' : side === 'OVER' ? 'O' : ''
}

function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function EdgeSkeleton() {
  return (
    <div className="pl-skel" role="status" aria-label="Loading line edges">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="pl-skel-row" key={index} aria-hidden="true">
          <span className="pl-skel-bar is-wide" />
          <span className="pl-skel-bar" />
          <span className="pl-skel-bar" />
          <span className="pl-skel-bar" />
        </div>
      ))}
    </div>
  )
}

export default function LineEdgesModule({
  sports,
  sportId,
  onSport,
  rows,
  emptyText,
  loading = false,
  busy,
  onStartWeekly,
}) {
  return (
    <section className="pl-edges" id="line-edges" aria-labelledby="line-edges-title" aria-busy={loading ? 'true' : 'false'}>
      <div className="pl-edges-head">
        <p className="pl-kick">Free preview</p>
        <h2 id="line-edges-title">Biggest line edges</h2>
        <p className="pl-lead">Standard lines where our projection sits farthest from the posted number.</p>
        <p className="pl-edge-promo">{XWEEK_PROMO_LINE}</p>
      </div>
      <div className="pl-seg" role="tablist" aria-label="Line edges sport">
        {sports.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === sportId}
            className={item.id === sportId ? 'on' : ''}
            onClick={() => onSport(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="pl-edge-body">
        {rows.length ? (
          <div className="pl-edge-table" role="table">
            <div className="pl-edge-row pl-edge-head" role="row">
              <span>Player · prop</span>
              <span>Line</span>
              <span>Proj</span>
              <span>Gap</span>
            </div>
            {rows.map((row) => {
              const side = sideLetter(row.side)
              return (
                <div className="pl-edge-row" role="row" key={`${row.player}|${row.stat}|${row.line}|${row.side || ''}`}>
                  <span className="pl-player">
                    <span>
                      <b>{row.player}</b>
                      <small>{row.team ? `${row.team}${row.opponent ? ` vs ${row.opponent}` : ''}` : row.stat} · {row.stat}</small>
                    </span>
                  </span>
                  <span className="pl-num">{side}{side ? ' ' : ''}{fmt(row.line)}</span>
                  <span className="pl-num pl-proj">{fmt(row.projection)}</span>
                  <span className="pl-num pl-edge-gap">{formatLineGap(row.edge)}</span>
                </div>
              )
            })}
          </div>
        ) : loading ? (
          <EdgeSkeleton />
        ) : (
          <p className="pl-empty">{emptyText}</p>
        )}
        <ul className="pl-edge-proof">
          <li>Standard lines only</li>
          <li>Projection vs the posted number</li>
          <li>Free preview, no login</li>
        </ul>
      </div>
      <button type="button" className="pl-cta" disabled={busy} onClick={onStartWeekly}>
        {busy ? 'Opening checkout…' : 'Start weekly'}
      </button>
    </section>
  )
}
