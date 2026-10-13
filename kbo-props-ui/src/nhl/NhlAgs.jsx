import { useEffect, useMemo, useState } from 'react'
import { fetchNhlAgs } from './nhlData'
import { nhlHeadshotUrl, teamLogoUrl } from './nhlTeams'
import { fitImage } from '../fitImage.js'
import { CgScoreCell, CgScoreNote } from '../CgScoreExplainer'
import BoardStatus from '../BoardStatus'
import { BoardSkeleton } from '../BootScreen.jsx'
import { NHL_AGS_BACKTEST, SCORE_LINE, formatBacktestBand } from './agsScore.js'

// No odds feed exists yet. The column is in this table and stays unrendered
// until a feed is wired and this flag is turned on.
export const SHOW_AGS_ODDS = false

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function ordinal(rank) {
  const value = Number(rank)
  if (!Number.isFinite(value)) return '—'
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  switch (value % 10) {
    case 1: return `${value}st`
    case 2: return `${value}nd`
    case 3: return `${value}rd`
    default: return `${value}th`
  }
}

function pct(value, games) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const count = Number(games)
  const gamesLabel = Number.isFinite(count) ? ` · ${count} gm` : ''
  return `${Number(value).toFixed(1)}%${gamesLabel}`
}

function MiniChart({ recent }) {
  const values = Array.isArray(recent) ? recent : []
  const maxValue = Math.max(...values, 1)
  return (
    <div className="nfl-lines-chart" aria-hidden="true">
      {values.map((value, index) => (
        <span key={index} className={value > 0 ? 'hit' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function scoreNoteFor(item) {
  const score = Number(item.score)
  if (!Number.isFinite(score)) return null
  return {
    score: score.toFixed(1),
    lead: SCORE_LINE,
    disclaimer: NHL_AGS_BACKTEST.responsible,
  }
}

function AgsRow({ item }) {
  const score = Number(item.score)
  const scoreText = Number.isFinite(score) ? score.toFixed(1) : '—'
  const [whyOpen, setWhyOpen] = useState(false)
  const note = scoreNoteFor(item)
  const logo = teamLogoUrl(item.opponent)
  const headshot = item.imageUrl || nhlHeadshotUrl(item.playerId)
  const columns = SHOW_AGS_ODDS ? 8 : 7
  const matchup = [
    item.teamRank ? `team ${ordinal(item.teamRank)}` : null,
    item.goalieRank ? `goalie ${ordinal(item.goalieRank)}` : item.goalie ? 'goalie unknown' : null,
  ].filter(Boolean).join(' · ')
  return (
    <>
      <tr className="nfl-lines-row" data-testid="nhl-ags-row">
        <td>
          <div className="nfl-lines-player">
            <div className="nfl-lines-avatar">{headshot ? <img src={fitImage(headshot, 42)} alt="" loading="lazy" /> : initials(item.player)}</div>
            <div className="nfl-lines-info">
              <span className="nfl-player-link">{item.player}</span>
              <span className="nfl-lines-tag">{item.team}{item.position ? `, ${item.position}` : ''} vs {item.opponent}</span>
              {item.role && <span className="nhl-ags-role">{item.role}</span>}
            </div>
          </div>
        </td>
        <td className="hit-rate-chart"><MiniChart recent={item.recentGoals} /></td>
        <td className="hit-rate-score">
          <CgScoreCell
            scoreText={scoreText}
            note={note}
            open={whyOpen}
            onToggle={() => setWhyOpen((current) => !current)}
          />
        </td>
        <td className="hit-rate-extra">
          <small className="nhl-ags-label">L10 scored</small>
          <strong>{pct(item.l10ScoredPct, item.l10Games)}</strong>
        </td>
        <td className="hit-rate-extra">
          <small className="nhl-ags-label">2026 scored</small>
          <strong>{pct(item.seasonScoredPct, item.seasonGames)}</strong>
        </td>
        <td className="hit-rate-extra">
          <small className="nhl-ags-label">Matchup</small>
          <div className="nfl-lines-matchup">
            {logo && <img className="nfl-lines-matchup-logo" src={fitImage(logo, 22)} alt="" loading="lazy" />}
            <strong>{item.matchupRank ? ordinal(item.matchupRank) : '—'}</strong>
          </div>
          {matchup && <small className="nhl-ags-label">{matchup}</small>}
        </td>
        <td className="hit-rate-extra">
          <small className="nhl-ags-label">Price to beat</small>
          <strong>{item.priceToBeatText || '—'}</strong>
        </td>
        {SHOW_AGS_ODDS && (
          <td className="hit-rate-extra nhl-ags-odds">
            <small className="nhl-ags-label">Odds</small>
            <strong>{item.odds ?? '—'}</strong>
          </td>
        )}
      </tr>
      {whyOpen && note && (
        <tr className="cg-score-note-row">
          <td colSpan={columns}>
            <CgScoreNote note={note} />
          </td>
        </tr>
      )}
    </>
  )
}

export default function NhlAgs() {
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [query, setQuery] = useState('')
  const [backtest, setBacktest] = useState(NHL_AGS_BACKTEST)

  useEffect(() => {
    let active = true
    fetchNhlAgs()
      .then(({ records: next, updatedAt: publishedAt, payload }) => {
        if (!active) return
        setRecords(next)
        setUpdatedAt(publishedAt || null)
        if (payload?.backtest?.bands?.length) setBacktest(payload.backtest)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return records
      .filter((item) => !needle || String(item.player || '').toLowerCase().includes(needle) || String(item.team || '').toLowerCase().includes(needle))
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
  }, [records, query])

  return (
    <section className="nfl-lines-page nhl-ags-page" data-testid="nhl-ags-page">
      <div className="nfl-board-header">
        <div>
          <p>NHL / ADMIN PREVIEW</p>
          <h1>Anytime Goal Scorer</h1>
          <BoardStatus sport="nhl" updatedAt={updatedAt} />
        </div>
        <div className="nfl-lines-header-actions">
          <span>{rows.length} players</span>
          <label className="nhl-ags-search">
            <span className="nhl-ags-label">Player</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search players" />
          </label>
        </div>
      </div>
      <p className="nhl-ags-score-line" data-testid="nhl-ags-score-line">{SCORE_LINE}</p>
      <div className="nhl-ags-backtest" data-testid="nhl-ags-backtest">
        <p className="nhl-ags-backtest-label">{backtest.label || 'Backtest'}</p>
        <ul className="nhl-ags-backtest-bands">
          {(backtest.bands || []).map((band) => (
            <li key={band.band}>{formatBacktestBand(band)}</li>
          ))}
        </ul>
        <p>{backtest.smallSample}</p>
        <p>{backtest.responsible}</p>
      </div>
      {error && <div className="nfl-notice">Unable to load the anytime goal board: {error}</div>}
      {!error && !loaded && (
        <div role="status" aria-label="Loading anytime goal scorer">
          <BoardSkeleton />
        </div>
      )}
      {!error && loaded && !rows.length && <div className="nfl-notice">No anytime goal scorers are posted for this slate.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table hit-rate-board">
            <thead>
              <tr>
                <th>Player</th>
                <th>L10 goals</th>
                <th>CG Score</th>
                <th>L10 scored</th>
                <th>2026 scored</th>
                <th>Matchup</th>
                <th>Price to beat</th>
                {SHOW_AGS_ODDS && <th>Odds</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => <AgsRow key={item.id || `${item.player}-${item.team}`} item={item} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
