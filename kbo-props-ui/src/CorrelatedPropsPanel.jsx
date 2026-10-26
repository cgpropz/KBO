import './CorrelatedPropsPanel.css'
import { BARS_SHORT_NOTE } from './correlatedProps'

const STUB_BARS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function BarTrack({ bars, stub = false }) {
  const marks = stub ? STUB_BARS : bars
  return (
    <span
      className={`corr-bars${stub ? ' is-stub' : ''}`}
      role={stub ? undefined : 'img'}
      aria-hidden={stub ? 'true' : undefined}
      aria-label={stub ? undefined : 'Oldest to newest, only games where the selected prop hit'}
    >
      {marks.map((mark, index) => (
        <i
          key={stub ? mark : index}
          className={stub ? 'corr-bar' : `corr-bar is-${mark}`}
        />
      ))}
    </span>
  )
}

export default function CorrelatedPropsPanel({ model, onFocus, onNavigatePricing }) {
  if (!model) return null
  return (
    <section
      className="corr-panel"
      data-testid="nba-correlated-panel"
      data-status={model.status}
      aria-label={model.title}
    >
      <p className="corr-banner" data-testid="nba-corr-draft" role="note">{model.banner}</p>
      <h3 className="corr-title">{model.title}</h3>
      <p className="corr-historical">{model.historical}</p>
      <p className="corr-note">{model.scopeNote}</p>
      {model.oversNote ? <p className="corr-note">{model.oversNote}</p> : null}

      {model.status === 'ready' && model.showNumbers ? (
        <ul className="corr-list">
          {model.rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="corr-row"
                data-testid="nba-corr-row"
                onClick={() => onFocus?.(row.id)}
              >
                <span className="corr-who">
                  <span className="corr-name">{row.name}</span>
                  <span className="corr-meta">
                    {row.team ? `${row.team} · ` : ''}{row.stat}
                    {row.smallSample ? <span className="corr-badge">Small sample</span> : null}
                  </span>
                </span>
                <span className="corr-figures">
                  <span className="corr-rate">{row.rateLabel}</span>
                  <span className="corr-sample">n={row.n}</span>
                </span>
                {row.barsMode === 'real' && row.bars ? <BarTrack bars={row.bars} /> : null}
                {row.barsMode === 'short' ? <span className="corr-bar-short">{BARS_SHORT_NOTE}</span> : null}
                {row.barsMode === 'stub' && !model.barsStub ? <span className="corr-bar-short">Bars not published for this pair.</span> : null}
                <span className="corr-focus">Show on board</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="corr-empty" data-testid="nba-corr-message">{model.message}</p>
      )}

      {model.showPlans ? (
        <button type="button" className="corr-plans" onClick={() => onNavigatePricing?.()}>View plans</button>
      ) : null}

      {model.barsStub ? <BarTrack stub /> : null}
      {model.barsNote ? <p className="corr-note">{model.barsNote}</p> : null}
      {model.lineSourceNote ? <p className="corr-note" data-testid="nba-corr-line-source">{model.lineSourceNote}</p> : null}
      {model.metricNote ? <p className="corr-note">{model.metricNote}</p> : null}
      <p className="corr-pp" data-testid="nba-corr-pp">{model.ppNote}</p>
      <p className="corr-age" data-testid="nba-corr-age">{model.ageLine}</p>
    </section>
  )
}
