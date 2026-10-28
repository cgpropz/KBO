import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { canSeeCheatsheets } from '../entitlements'
import { STANDARD_LINE } from '../responsibleGambling'
import {
  CHEATSHEET_SPORTS,
  cheatsheetsHref,
  homeHref,
  layoutFromSearch,
  leagueFromSearch,
} from './access'
import { selectedGame, toggleSort, visibleGames } from './boardControls'
import GameProj from './GameProj'
import { loadLivePack } from './loadLiveBoard'
import { sourceLabel, waitingPack } from './liveBoard'
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
  const [pack, setPack] = useState(() => waitingPack(leagueFromSearch(readSearch())))

  const projectionOnly = pack.projectionOnly === true
  const games = visibleGames(pack.games, { team, minEdge }, gameSort, { projectionOnly })
  const game = selectedGame(pack.games, games, gameId)
  const search = readSearch()

  useEffect(() => {
    let cancelled = false
    loadLivePack(league).then((next) => {
      if (!cancelled) setPack(next)
    })
    return () => { cancelled = true }
  }, [league])

  if (!canSeeCheatsheets(user)) return null

  const pickLeague = (id) => {
    if (id === league) return
    setLeague(id)
    setPack(waitingPack(id))
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
      data-source={pack.example ? 'example' : (pack.status || 'live')}
      data-model={pack.model || ''}
      data-projection={projectionOnly ? 'only' : ''}
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
            value={projectionOnly ? '0' : minEdge}
            disabled={projectionOnly}
            title={projectionOnly ? 'This sheet does not rank by edge' : undefined}
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
        <p
          className={`cs-source${pack.status === 'unavailable' ? ' is-gap' : ''}${pack.status === 'waiting' ? ' is-wait' : ''}`}
          data-testid="cheatsheet-source"
        >
          {sourceLabel(pack)}
        </p>
      </div>
      <GameProj
        pack={pack}
        game={game}
        games={games}
        gameSort={gameSort}
        onGameSort={(key) => {
          if (projectionOnly && key === 'edge') return
          setGameSort((current) => toggleSort(current, key))
        }}
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
