import { useEffect, useState } from 'react'
import { fetchNhlDvp } from './nhlData'
import { TEAM_NAMES, teamLogoUrl } from './nhlTeams'
import { fitImage } from '../fitImage.js'

const TABS = [
  { id: 'F', label: 'Forwards', ds: 'nhl_dvp_f', file: 'nhl/dvp_f.json' },
  { id: 'D', label: 'Defense', ds: 'nhl_dvp_d', file: 'nhl/dvp_d.json' },
  { id: 'G', label: 'Goalies', ds: 'nhl_dvp_g', file: 'nhl/dvp_g.json' },
]

const WINDOWS = [
  { id: 'blend', label: 'Season' },
  { id: 'l10', label: 'Last 10' },
  { id: 'l20', label: 'Last 20' },
]

const STAT_ORDER = ['sog', 'points', 'shots']

function fmt1(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(1) : '—'
}

function mix(from, to, progress) {
  const amount = Math.min(1, Math.max(0, progress))
  return `rgb(${Math.round(from[0] + (to[0] - from[0]) * amount)}, ${Math.round(from[1] + (to[1] - from[1]) * amount)}, ${Math.round(from[2] + (to[2] - from[2]) * amount)})`
}

// Rank 1 is the toughest matchup and 32 is the easiest, same as the board grade.
function dvpLabel(rankValue) {
  const max = 32
  const rank = Math.min(max, Math.max(1, Math.round(Number(rankValue) || 1)))
  const mid = Math.round(max / 2)
  const label = rank < mid ? 'Tough' : rank > mid ? 'Easy' : 'Neutral'
  const color = rank <= mid
    ? mix([255, 123, 121], [241, 200, 91], mid === 1 ? 1 : (rank - 1) / (mid - 1))
    : mix([241, 200, 91], [127, 255, 104], (rank - mid) / Math.max(1, max - mid))
  return { label, color, rank }
}

function DvpRow({ team, leagueAvg }) {
  const dvp = dvpLabel(team.rank)
  const scale = (Number(leagueAvg) > 0 ? Number(leagueAvg) : 1) * 1.3
  const pct = Math.min(100, Math.max(0, (Number(team.value) / scale) * 100))
  const logo = teamLogoUrl(team.team)
  return (
    <article className="nhl-dvp-row" data-testid={`nhl-dvp-row-${team.team}`}>
      <span className="nhl-dvp-rank">{team.rank}</span>
      <div className="nhl-dvp-team">
        {logo && <img src={fitImage(logo, 22)} alt="" width="22" height="22" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
        <b>{team.team}</b>
        <span>{TEAM_NAMES[team.team] || team.name}</span>
      </div>
      <span className="nhl-dvp-value">{fmt1(team.value)}</span>
      <span className="nhl-dvp-badge" style={{ color: dvp.color, background: `${dvp.color}22` }}>
        {dvp.label} {dvp.rank}
      </span>
      <div className="nhl-dvp-bar" aria-hidden="true">
        <div style={{ width: `${pct}%`, background: dvp.color }} />
      </div>
      <p className="nhl-dvp-meta">{team.sample} · through {team.through}</p>
    </article>
  )
}

export default function NhlDvp() {
  const [boards, setBoards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [position, setPosition] = useState('F')
  const [windowId, setWindowId] = useState('blend')
  const [stat, setStat] = useState('sog')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await Promise.all(TABS.map((tab) => fetchNhlDvp(tab.ds, tab.file)))
        if (cancelled) return
        const next = {}
        TABS.forEach((tab, index) => {
          next[tab.id] = rows[index].payload
        })
        setBoards(next)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const board = boards?.[position]
  const windowStats = board?.windows?.[windowId]?.stats || {}
  const available = STAT_ORDER.filter((key) => windowStats[key])
  const activeStat = available.includes(stat) ? stat : (available[0] || null)
  const metric = activeStat ? windowStats[activeStat] : null
  const teams = Array.isArray(metric?.teams) ? metric.teams : []
  const easiest = teams[0]
  const toughest = teams[teams.length - 1]

  return (
    <section className="nhl-dvp" data-testid="nhl-dvp-page">
      <header className="nfl-board-header">
        <div>
          <p>NHL / Defense vs position</p>
          <h1>DvP</h1>
        </div>
      </header>
      <p className="nhl-note">
        {board?.rankNote || 'Rank 1 is the toughest matchup. Rank 32 is the easiest.'}
        {' '}Easiest is listed first. Numbers are per game.
        {board?.sourceThrough ? ` Data through ${board.sourceThrough}.` : ''}
      </p>
      <div className="nfl-lines-tabs" role="tablist" aria-label="Position">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={position === tab.id}
            className={position === tab.id ? 'active' : ''}
            data-testid={`nhl-dvp-tab-${tab.id}`}
            onClick={() => setPosition(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="nhl-dvp-controls">
        <div className="nfl-lines-tabs" role="tablist" aria-label="Sample window">
          {WINDOWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={windowId === item.id ? 'active' : ''}
              data-testid={`nhl-dvp-window-${item.id}`}
              onClick={() => setWindowId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="nfl-lines-tabs" role="tablist" aria-label="Stat">
          {available.map((key) => (
            <button
              key={key}
              type="button"
              className={activeStat === key ? 'active' : ''}
              data-testid={`nhl-dvp-stat-${key}`}
              onClick={() => setStat(key)}
            >
              {windowStats[key].label}
            </button>
          ))}
        </div>
      </div>
      <p className="nhl-note">
        {metric?.detail || 'Per game.'}
        {windowId === 'blend' ? ' Season blends this year with last year until a team has 20 games, then uses this season only.' : ' Most recent games, including last season when this year is shorter than the window.'}
        {metric ? ` League average ${fmt1(metric.leagueAvg)}.` : ''}
      </p>
      {loading && <div className="nfl-notice">Loading defense vs position…</div>}
      {error && <div className="nfl-notice">Unable to load DvP: {error}</div>}
      {!loading && !error && metric && (
        <div className="nhl-dvp-card">
          <div className="nhl-dvp-extremes">
            <div className="nhl-dvp-extreme easy">
              <p>Easiest matchup</p>
              <strong>{easiest ? `${easiest.team} · ${fmt1(easiest.value)}` : '—'}</strong>
              <span>{easiest?.name || ''}</span>
            </div>
            <div className="nhl-dvp-extreme tough">
              <p>Toughest matchup</p>
              <strong>{toughest ? `${toughest.team} · ${fmt1(toughest.value)}` : '—'}</strong>
              <span>{toughest?.name || ''}</span>
            </div>
          </div>
          <div className="nhl-dvp-columns">
            <span>Rank</span>
            <span>Team</span>
            <span>Per game</span>
          </div>
          {teams.map((team) => (
            <DvpRow key={team.team} team={team} leagueAvg={metric.leagueAvg} />
          ))}
        </div>
      )}
    </section>
  )
}
