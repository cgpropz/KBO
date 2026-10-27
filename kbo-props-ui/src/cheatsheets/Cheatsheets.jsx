import { useState } from 'react'
import { useAuth } from '../AuthContext'
import { canSeeCheatsheets } from '../entitlements'
import { STANDARD_LINE } from '../responsibleGambling'
import {
  CHEATSHEET_SPORTS,
  cheatsheetsHref,
  homeHref,
  layoutFromSearch,
  leagueFromSearch,
  sportChrome,
} from './access'
import GameProj from './GameProj'
import example from './gameProjExample.json'
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

export default function Cheatsheets() {
  const { user } = useAuth()
  const [league, setLeague] = useState(() => leagueFromSearch(readSearch()))
  const [layout, setLayout] = useState(() => layoutFromSearch(readSearch()))
  if (!canSeeCheatsheets(user)) return null

  const sport = sportChrome(league, example)
  const search = readSearch()
  const pickLeague = (id) => {
    setLeague(id)
    remember(id, layout)
  }
  const pickLayout = (next) => {
    setLayout(next)
    remember(league, next)
  }

  return (
    <div className="cs-page" data-testid="cheatsheets-page" data-sport={sport.id}>
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
              aria-selected={item.id === sport.id}
              className={item.id === sport.id ? 'on' : ''}
              data-testid={`cheatsheets-sport-${item.id}`}
              onClick={() => pickLeague(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <p className="cs-rg">{STANDARD_LINE}</p>
      </header>
      {sport.id !== 'nfl' && (
        <p className="cs-demo" data-testid="cheatsheets-demo-note">
          {sport.name} is showing the EXAMPLE DAL@PHI demo. No live {sport.name} game projection.
        </p>
      )}
      <GameProj week={sport.week} layout={layout} onLayout={pickLayout} />
    </div>
  )
}
