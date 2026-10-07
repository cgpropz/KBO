import { propSplit, seasonSplit, withStarterHands } from './batterSplits'

const SIDES = [
  { hand: 'L', label: 'vs LHP', starter: 'left-handed starter' },
  { hand: 'R', label: 'vs RHP', starter: 'right-handed starter' },
]

function formatValue(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function formatAvg(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(3).replace(/^0\./, '.')
}

function emptyHitRate(line, season, starter) {
  if (line == null) return 'No line for this prop.'
  const year = season ? `${season} ` : ''
  return `No logged ${year}games vs a ${starter}.`
}

export default function BatterSplits({
  games,
  starters,
  getValue,
  line,
  season,
  stat,
  profile,
  projection,
  status,
}) {
  const tagged = withStarterHands(games, starters)
  const seasonLabel = profile?.splits_season || null

  return (
    <section className="kbo-splits" aria-label="Splits">
      <div className="kbo-splits-head">
        <h2>Splits</h2>
        <p>Hit rate counts games against a left-handed or right-handed starter. Season average is the official split.</p>
      </div>
      {status === 'loading' && <div className="kbo-notice">Loading splits…</div>}
      {status !== 'loading' && (
        <div className="kbo-splits-grid">
          {SIDES.map((side) => {
            const split = propSplit(tagged, getValue, line, side.hand, season)
            const official = seasonSplit(profile, projection, side.hand)
            const tone = split.pct == null ? '' : split.pct >= 50 ? 'over' : 'under'
            return (
              <article className="kbo-splits-card" key={side.hand}>
                <small>{side.label}</small>
                {split.pct == null ? (
                  <p className="kbo-splits-empty">{emptyHitRate(line, season, side.starter)}</p>
                ) : (
                  <>
                    <strong className={tone}>{split.pct}%</strong>
                    <span>{split.hits}/{split.games} over {formatValue(line)}</span>
                    <span>Avg/G {formatValue(split.avg)}</span>
                  </>
                )}
                <span className="kbo-splits-season">
                  {official
                    ? `${seasonLabel ? `${seasonLabel} season` : 'Season'} ${formatAvg(official.avg)} · ${official.ab} AB`
                    : 'Season split not on file'}
                  {stat === 'Total Bases' && official?.tb != null ? ` · ${official.tb} TB` : ''}
                </span>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
