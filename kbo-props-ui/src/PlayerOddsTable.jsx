import { bookLogoSrc } from './nfl/bookLogos'
import { formatAmerican, formatOddsLine } from './playerOdds'
import './playerOdds.css'

function ChartIcon() {
  return (
    <svg className="player-odds-chart-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 15l4.2-4.2 3.1 2.6L19 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function PlayerOddsTable({ propLabel, rows, status }) {
  const ready = status === 'ready'
  const list = ready && Array.isArray(rows) ? rows : []

  return (
    <section className="player-odds" aria-label="Sportsbook odds" data-odds-prop={propLabel || ''}>
      <h2>Odds</h2>
      {status === 'loading' && <p className="player-odds-empty">Loading sportsbook odds.</p>}
      {status === 'error' && <p className="player-odds-empty">Sportsbook odds are unavailable right now.</p>}
      {ready && !list.length && <p className="player-odds-empty">No sportsbook odds for this prop.</p>}
      {ready && list.length > 0 && (
        <div className="player-odds-scroll">
          <table>
            <thead>
              <tr>
                <th>Book</th>
                <th>Line</th>
                <th>Over</th>
                <th>Under</th>
                <th className="player-odds-icon-col" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {list.map((row) => {
                const src = bookLogoSrc(row)
                return (
                  <tr key={row.book_key || row.book}>
                    <td>
                      <div className="player-odds-book">
                        {src ? <img src={src} alt="" /> : null}
                        <span>{row.book}</span>
                      </div>
                    </td>
                    <td>{formatOddsLine(row.line)}</td>
                    <td>{formatAmerican(row.over)}</td>
                    <td>{formatAmerican(row.under)}</td>
                    <td className="player-odds-icon"><ChartIcon /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
