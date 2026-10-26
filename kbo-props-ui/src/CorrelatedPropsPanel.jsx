import './CorrelatedPropsPanel.css'

export default function CorrelatedPropsPanel({ model, onFocus, onNavigatePricing }) {
  if (!model) return null
  return (
    <section
      className="corr-panel"
      data-testid="nba-correlated-panel"
      data-status={model.status}
      aria-label={model.title}
    >
      <h3 className="corr-title">{model.title}</h3>

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
                  <span className="corr-meta">{row.team ? `${row.team} · ` : ''}{row.stat}</span>
                </span>
                <span className="corr-figures">
                  <span className="corr-rate">{row.rateLabel}</span>
                  <span className="corr-sample">n={row.n}</span>
                </span>
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
    </section>
  )
}
