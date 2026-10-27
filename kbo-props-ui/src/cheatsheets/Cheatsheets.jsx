import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { canSeeCheatsheets } from '../entitlements'
import { STANDARD_LINE } from '../responsibleGambling'
import { fetchNflGameMarkets } from '../nfl/nflData'
import {
  CHEATSHEET_SPORTS,
  cheatsheetsHref,
  homeHref,
  layoutFromSearch,
  leagueFromSearch,
} from './access'
import { selectedGame, toggleSort, visibleGames } from './boardControls'
import GameProj from './GameProj'
import { liveNflPack } from './nflGameSheet'
import { packFor } from './packs'
import './cheatsheets.css'

function readSearch() {
  return typeof window === 'undefined' ? '' : window.location.search
}

function remember(league, layout) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  params.set('cheatsheets', '1')
  params.set('league', league)
  params.set('gp', layout)
  params.delete('page')
  params.delete('sport')
  params.delete('s')
  params.delete('nbaTab')
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
}

const RESET = {
  gameId: '',
  gameSort: { key: 'board', dir: 'asc' },
  rowSort: { away: null, home: null },
  team: '',
  minEdge: '0',
  rowMode: 'all',
  panel: 'overview',
}

export default function Cheatsheets() {
  const { user } = useAuth()
  const [league, setLeague] = useState(() => leagueFromSearch(readSearch()))
  const [layout, setLayout] = useState(() => layoutFromSearch(readSearch()))
  const [gameId, setGameId] = useState('')
  const [gameSort, setGameSort] = useState(RESET.gameSort)
  const [rowSort, setRowSort] = useState(RESET.rowSort)
  const [team, setTeam] = useState('')
  const [minEdge, setMinEdge] = useState('0')
  const [rowMode, setRowMode] = useState('all')
  const [panel, setPanel] = useState('overview')
  const [livePack, setLivePack] = useState(null)

  const base = packFor(league)
  const pack = league === 'nfl' && livePack ? livePack : base
  const games = visibleGames(pack.games, { team, minEdge }, gameSort)
  const game = selectedGame(pack.games, games, gameId)
  const search = readSearch()

  useEffect(() => {
    if (league !== 'nfl') return undefined
    let cancelled = false
    fetchNflGameMarkets()
      .then((snap) => {
        if (cancelled) return
        const next = liveNflPack(snap?.payload, { preview: snap?.preview === true })
        if (next) setLivePack(next)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [league])

  if (!canSeeCheatsheets(user)) return null

  const pickLeague = (id) => {
    setLeague(id)
    setGameId(RESET.gameId)
    setGameSort(RESET.gameSort)
    setRowSort(RESET.rowSort)
    setTeam(RESET.team)
    setMinEdge(RESET.minEdge)
    setRowMode(RESET.rowMode)
    setPanel(RESET.panel)
    remember(id, layout)
  }
  const pickLayout = (next) => {
    setLayout(next)
    remember(league, next)
  }

  return (
    <div
      className="cs-page"
      data-testid="cheatsheets-page"
      data-sport={league}
      data-source={pack.example ? 'example' : 'live'}
    >
      <header className="cs-primary">
        <a className="cs-brand" href={homeHref(search)}>cg<span>propz</span></a>
        <nav className="cs-nav" aria-label="Primary">
          <a href={cheatsheetsHref(search)} aria-current="page" data-testid="cheatsheets-current">Cheatsheets</a>
        </nav>
        <div className="cs-sports" role="tablist" aria-label="Cheatsheet sport">
          {CHEATSHEET_SPORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === league}
              className={item.id === league ? 'on' : ''}
              data-testid={`cheatsheets-sport-${item.id}`}
              onClick={() => pickLeague(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <p className="cs-rg">{STANDARD_LINE}</p>
      </header>
      <div className="cs-filters" data-testid="cheatsheet-filters">
        <label>
          Team
          <input
            value={team}
            placeholder="Abbr or name"
            data-testid="cheatsheet-filter-team"
            onChange={(event) => setTeam(event.target.value)}
          />
        </label>
        <label>
          Min edge
          <select
            value={minEdge}
            data-testid="cheatsheet-filter-edge"
            onChange={(event) => setMinEdge(event.target.value)}
          >
            <option value="0">All games</option>
            <option value="1">1+ pt</option>
            <option value="2">2+ pt</option>
          </select>
        </label>
        <label>
          Stat rows
          <select
            value={rowMode}
            data-testid="cheatsheet-filter-rows"
            onChange={(event) => setRowMode(event.target.value)}
          >
            <option value="all">All stats</option>
            <option value="pos">Positive edge</option>
            <option value="10">Edge 10%+</option>
          </select>
        </label>
        <p className="cs-count" data-testid="cheatsheet-game-count" aria-live="polite">
          {games.length} of {pack.games.length} games
        </p>
        <p className="cs-source" data-testid="cheatsheet-source">{pack.example ? 'Example sheet' : 'Live game markets'}</p>
      </div>
      <GameProj
        pack={pack}
        game={game}
        games={games}
        gameSort={gameSort}
        onGameSort={(key) => setGameSort((current) => toggleSort(current, key))}
        onSelectGame={setGameId}
        rowSort={rowSort}
        onRowSort={(scope, key) => setRowSort((current) => ({ ...current, [scope]: toggleSort(current[scope], key) }))}
        rowMode={rowMode}
        layout={layout}
        onLayout={pickLayout}
        panel={panel}
        onPanel={setPanel}
      />
    </div>
  )
}
