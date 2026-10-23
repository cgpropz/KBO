import { useMemo, useState } from 'react'
import { buildSplits, dayLabel, formatAvg, formatMetric, metricSeries, metricWindows } from './insightsCore.js'
import { formatLineValue, rateTextColor } from '../lineSlider'
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

function SplitRow({ row }) {
  const color = rateTextColor(row.rate, row.decided)
  const width = row.rate == null ? 0 : Math.max(2, row.rate)
  return (
    <li className={`pi-split${row.n === 0 ? ' is-empty' : ''}`} data-testid="pi-split-row">
      <span className="pi-split-label">{row.label}</span>
      <span className="pi-split-bar" aria-hidden="true"><i style={{ width: `${width}%`, background: color || '#52525b' }} /></span>
      <b className="pi-split-rate" style={color ? { color } : undefined}>{rateText(row)}</b>
      <span className="pi-split-avg">{formatAvg(row.avg)}<small> avg</small></span>
      <span className={`pi-split-n${row.small ? ' is-small' : ''}`}>n={row.n}</span>
    </li>
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
        {statLabel} · hit rate over {line == null ? '—' : formatLineValue(line)} · avg · games (n)
      </p>
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

// Bar labels drop the % sign and decimals so ten of them fit across a 320px
// phone; the caption carries the unit.
const SERIES_FORMAT = { pct: 'pctInt', pct100: 'int', two: 'one' }

function MiniSeries({ series, format }) {
  const values = series.map((point) => point.value).filter((value) => value != null)
  if (!values.length) return null
  const max = Math.max(...values, 0) || 1
  return (
    <>
    <p className="pi-series-cap">Last {series.length} games{format === 'pct' || format === 'pct100' ? ' (%)' : ''}</p>
    <div className="pi-series" aria-label="Last 10 games">
      {series.map((point, index) => (
        <span className="pi-series-col" key={`${point.day}-${index}`}>
          <i style={{ height: `${point.value == null ? 0 : Math.max(4, (point.value / max) * 100)}%` }} />
          <b>{formatMetric(point.value, SERIES_FORMAT[format] || format)}</b>
          <small>{dayLabel(point.day)}</small>
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

function AdvancedPanel({ model }) {
  const [metricId, setMetricId] = useState(model.metrics[0]?.id || '')
  const metric = model.metrics.find((entry) => entry.id === metricId) || model.metrics[0]
  const windows = useMemo(() => (metric ? metricWindows(metric, model.games, model) : []), [metric, model])
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
          <div key={window.id} className="pi-window">
            <small>{window.label}</small>
            <b>{window.n ? formatMetric(window.value, metric.format) : '—'}</b>
            <span className={window.small ? 'is-small' : ''}>n={window.n}</span>
          </div>
        ))}
      </div>
      <MiniSeries series={series} format={metric.format} />
      <p className="pi-note">{metric.note} From our game logs.</p>
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
