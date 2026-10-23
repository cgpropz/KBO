import { useMemo, useState } from 'react'
import { buildSplits, formatAvg, formatMetric, metricSeries, metricWindows, rateWindows, seriesDayLabels, seriesLabelsVertical, seriesRange, seriesValueLabel } from './insightsCore.js'
import { STRENGTH_COLORS, STRENGTH_MIN_GAMES } from './strengthScale.js'
import { formatLineValue } from '../lineSlider'
import './playerInsights.css'

function rateText(row) {
  return row.rate == null ? '—' : `${row.rate}%`
}

function SampleNote({ splits, model }) {
  const season = splits.rows.find((row) => row.id === 'season')
  if (!season || !season.early) return null
  return (
    <p className="pi-early" data-testid="pi-early">
      Early season: {season.n} {season.n === 1 ? 'game' : 'games'} in {model.seasonLabel(model.currentSeason)}. Small samples, read with care.
    </p>
  )
}

function Skipped({ splits }) {
  if (!splits.skipped.length) return null
  return <p className="pi-skipped">Not in our logs: {splits.skipped.map((item) => item.replace(/\s*\(.*\)$/, '')).join(' · ')}</p>
}

function StrengthCue({ strength }) {
  if (!strength?.cue) return null
  return <i className={`pi-cue tone-${strength.tone}`} aria-hidden="true">{strength.cue}</i>
}

function SplitRow({ row }) {
  const strength = row.strength || { tone: 'muted', label: 'not rated' }
  const color = STRENGTH_COLORS[strength.tone]
  const width = row.rate == null ? 0 : Math.max(2, row.rate)
  const muted = strength.tone === 'muted'
  return (
    <li
      className={`pi-split tone-${strength.tone}${row.n === 0 ? ' is-empty' : ''}`}
      data-testid="pi-split-row"
      data-tone={strength.tone}
      aria-label={`${row.label}: ${rateText(row)} hit rate, ${formatAvg(row.avg)} average, ${row.shown} games, ${strength.label}`}
    >
      <span className="pi-split-label">{row.label}</span>
      <span className="pi-split-bar" aria-hidden="true"><i style={{ width: `${width}%`, background: muted ? '#52525b' : color }} /></span>
      <b className="pi-split-rate" style={{ color }}><StrengthCue strength={strength} />{rateText(row)}</b>
      <span className="pi-split-avg">{formatAvg(row.avg)}<small> avg</small></span>
      <span className={`pi-split-n${row.small ? ' is-small' : ''}`}>
        n={row.shown}
        {row.pushes > 0 && <small className="pi-split-push" data-testid="pi-split-push">+{row.pushes} push</small>}
      </span>
    </li>
  )
}

function SplitsScaleNote({ splits, line }) {
  const base = splits.baseline
  if (!base || base.value == null) return null
  const rate = base.kind === 'rate'
  const what = rate
    ? `overall over rate over ${formatLineValue(line)} (${Math.round(base.value)}%)`
    : `overall average (${formatAvg(base.value)})`
  const games = base.scope === 'logged' ? `${base.n} ${rate ? 'decided' : 'logged'} games` : `${base.n} ${rate ? 'decided ' : ''}games ${base.scope}`
  return (
    <p className="pi-sub pi-scale-note" data-testid="pi-scale-note">
      Colors: each row vs the player&apos;s {what} across {games}.{' '}
      {rate ? '▲ more overs than usual, ▼ fewer overs.' : '▲ above usual, ▼ below usual.'} Under {STRENGTH_MIN_GAMES} games: gray, not rated.
    </p>
  )
}

function SplitsPanel({ splits, model, line, statLabel }) {
  const groups = []
  splits.rows.forEach((row) => {
    let group = groups.find((entry) => entry.name === row.group)
    if (!group) { group = { name: row.group, rows: [] }; groups.push(group) }
    group.rows.push(row)
  })
  return (
    <div className="pi-splits" data-testid="pi-splits">
      <p className="pi-sub">
        {statLabel} · hit rate over {line == null ? '—' : formatLineValue(line)} · avg · n = games decided
      </p>
      {splits.rows.some((row) => row.pushes > 0) && (
        <p className="pi-sub pi-push-note" data-testid="pi-push-note">Pushes (exactly on the line) are left out of the hit rate and n.</p>
      )}
      <SplitsScaleNote splits={splits} line={line} />
      <SampleNote splits={splits} model={model} />
      {groups.map((group) => (
        <div className="pi-split-group" key={group.name}>
          <h4>{group.name}</h4>
          <ul>{group.rows.map((row) => <SplitRow key={row.id} row={row} />)}</ul>
        </div>
      ))}
      <Skipped splits={splits} />
    </div>
  )
}

function MetricPicker({ metrics, value, onChange }) {
  const [open, setOpen] = useState(false)
  const current = metrics.find((metric) => metric.id === value) || metrics[0]
  return (
    <div className={`pi-picker${open ? ' is-open' : ''}`}>
      <button type="button" className="pi-picker-button" aria-haspopup="listbox" aria-expanded={open} data-testid="pi-adv-toggle" onClick={() => setOpen((state) => !state)}>
        <span>{current?.label}</span>
        <i aria-hidden="true">▾</i>
      </button>
      {open && (
        <ul className="pi-picker-list" role="listbox" aria-label="Advanced stat">
          {metrics.map((metric) => (
            <li key={metric.id}>
              <button
                type="button"
                role="option"
                aria-selected={metric.id === current?.id}
                className={metric.id === current?.id ? 'active' : ''}
                data-testid="pi-adv-option"
                onClick={() => { onChange(metric.id); setOpen(false) }}
              >
                {metric.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MiniSeries({ series, format }) {
  const values = series.map((point) => point.value).filter((value) => value != null)
  if (!values.length) return null
  const max = Math.max(...values, 0) || 1
  const dayList = series.map((point) => point.day)
  const days = seriesDayLabels(dayList)
  const labels = series.map((point) => seriesValueLabel(point.value, format))
  const range = seriesRange(dayList)
  return (
    <>
    <p className="pi-series-cap">Last {series.length} games{format === 'pct' || format === 'pct100' ? ' (%)' : ''}{range ? ` · ${range}` : ''}</p>
    <div className={`pi-series${seriesLabelsVertical(labels) ? ' is-vertical' : ''}`} aria-label="Last 10 games" data-testid="pi-series">
      {series.map((point, index) => (
        <span className="pi-series-col" key={`${point.day}-${index}`}>
          <i style={{ height: `${point.value == null ? 0 : Math.max(4, (point.value / max) * 100)}%` }} />
          <b>{labels[index]}</b>
          <small>{days[index]}</small>
        </span>
      ))}
    </div>
    </>
  )
}

function Unavailable({ model }) {
  if (!model.unavailable?.length) return null
  return (
    <details className="pi-unavailable">
      <summary>Not available yet ({model.unavailable.length})</summary>
      <ul>{model.unavailable.map((item) => <li key={item}>{item}</li>)}</ul>
    </details>
  )
}

function AdvancedScaleNote({ rated, metric }) {
  const base = rated.baseline
  const lower = rated.lowerIsBetter ? ' Lower is better for this stat.' : ''
  if (rated.neutral) {
    return <p className="pi-sub pi-scale-note" data-testid="pi-adv-baseline">Not colored: this stat has no better or worse side.</p>
  }
  if (!base) {
    return <p className="pi-sub pi-scale-note" data-testid="pi-adv-baseline">Not colored yet: under {STRENGTH_MIN_GAMES} games to compare against.</p>
  }
  const source = base.source === 'published' ? `${base.label} (${formatMetric(base.value, metric.format)})` : `the player's ${base.label.replace(/^own /, '')} (${formatMetric(base.value, metric.format)}); no league or position baseline in our data for this stat`
  return (
    <p className="pi-sub pi-scale-note" data-testid="pi-adv-baseline">
      Colors: vs {source}. ▲ stronger, ▼ weaker; under {STRENGTH_MIN_GAMES} games gray.{lower}
    </p>
  )
}

function AdvancedPanel({ model }) {
  const [metricId, setMetricId] = useState(model.metrics[0]?.id || '')
  const metric = model.metrics.find((entry) => entry.id === metricId) || model.metrics[0]
  const rated = useMemo(() => (metric ? rateWindows(metricWindows(metric, model.games, model), metric, model) : { windows: [], baseline: null }), [metric, model])
  const windows = rated.windows
  const series = useMemo(() => (metric?.game ? metricSeries(metric, model.games, 10) : []), [metric, model])
  if (!metric) {
    return (
      <div className="pi-advanced" data-testid="pi-advanced">
        <p className="pi-empty">{model.advancedNote || 'No advanced stats for this player yet.'}</p>
        <Unavailable model={model} />
      </div>
    )
  }
  return (
    <div className="pi-advanced" data-testid="pi-advanced">
      <MetricPicker metrics={model.metrics} value={metric.id} onChange={setMetricId} />
      <div className="pi-windows">
        {windows.map((window) => (
          <div
            key={window.id}
            className={`pi-window tone-${window.strength.tone}${window.isBaseline ? ' is-baseline' : ''}`}
            data-testid="pi-window"
            data-tone={window.strength.tone}
            aria-label={`${window.label}: ${window.n ? formatMetric(window.value, metric.format) : 'no games'}, ${window.n} games, ${window.strength.label}`}
          >
            <small>{window.label}</small>
            <b style={{ color: STRENGTH_COLORS[window.strength.tone] }}><StrengthCue strength={window.strength} />{window.n ? formatMetric(window.value, metric.format) : '—'}</b>
            <span className={window.small ? 'is-small' : ''}>n={window.n}</span>
          </div>
        ))}
      </div>
      <AdvancedScaleNote rated={rated} metric={metric} />
      <MiniSeries series={series} format={metric.format} />
      <p className="pi-note">
        {metric.note} From our game logs.
        {windows.some((window) => window.playoffs) ? ' Includes playoff games.' : ''}
      </p>
      <Unavailable model={model} />
    </div>
  )
}

// Splits and Advanced stats, stacked under the page's existing hit-rate block
// (`children`, left exactly as it is). Pages pass `model` only for a viewer
// who already has that sport's paid player data, so this adds nothing for
// anyone else. A blocked model (NHL until its game feed is approved) or no
// model renders just the children.
export default function PlayerInsights({ model, line, statLabel, children }) {
  const splits = useMemo(() => (model && !model.splitsBlocked ? buildSplits(model.games, { ...model, line }) : null), [model, line])
  if (!model || model.splitsBlocked || !splits) return children
  return (
    <>
      {children}
      <section className="pi-card" aria-label="Splits" data-testid="pi-splits-card">
        <div className="pi-card-head"><h3>Splits</h3></div>
        <SplitsPanel splits={splits} model={model} line={line} statLabel={statLabel} />
      </section>
      <section className="pi-card" aria-label="Advanced stats" data-testid="pi-advanced-card">
        <div className="pi-card-head"><h3>Advanced stats</h3></div>
        <AdvancedPanel model={model} />
      </section>
    </>
  )
}
