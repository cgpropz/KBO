import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../AuthContext'
import '../wnba/wnba.css'
import './nba.css'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import { viewOnLoad } from '../memberNav'

const NbaPlayers = lazy(() => import('./NbaPlayers'))
const NbaTeams = lazy(() => import('./NbaTeams'))
const NbaEdge = lazy(() => import('./NbaEdge'))
const NbaDashboard = lazy(() => import('./NbaDashboard'))
const NbaSharpOdds = lazy(() => import('./NbaSharpOdds'))

const NAV_ITEMS = [
  { id: 'projections', label: 'PrizePicks Edge' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'slip', label: 'Slip Builder' },
]

const SlipBoard = lazy(() => import('../SlipBoard'))

const NAV_IDS = new Set(NAV_ITEMS.map((item) => item.id))

function resolveNbaView(view) {
  return NAV_IDS.has(view) ? view : 'dashboard'
}

const EMPTY_COPY = {
  projections: {
    title: 'PrizePicks Edge',
    body: 'NBA lines and projections are not loaded yet.',
  },
  lineups: {
    title: 'Lineups',
    body: 'Lineups are not part of this preview.',
  },
}

function EmptyTab({ title, body }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: '#8b94a9' }}>
      <h2 style={{ margin: '0 0 8px', color: '#e6f3ce' }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 13 }}>{body}</p>
    </div>
  )
}

export default function NbaApp({ sport, setSport, onSlipSport, onNavigateHome, onNavigatePricing, entry, forceHome }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useState(() => viewOnLoad({
    sport: 'nba',
    entry,
    search: typeof window === 'undefined' ? '' : window.location.search,
    forceHome,
  }))
  const [playerName, setPlayerName] = useState(entry?.player || '')
  const openView = (next) => {
    if (next !== 'players') setPlayerName('')
    setView(resolveNbaView(next))
  }
  const openPlayer = (name) => {
    setPlayerName(name || '')
    setView('players')
  }

  let content
  if (view === 'teams') content = <NbaTeams />
  else if (view === 'dashboard') {
    content = (
      <NbaDashboard
        onSelectPlayer={openPlayer}
        onNavigate={openView}
        onNavigatePricing={onNavigatePricing}
      />
    )
  } else if (view === 'players') content = <NbaPlayers initialName={playerName} />
  else if (view === 'projections') content = <NbaEdge />
  else if (view === 'sharp') content = <NbaSharpOdds onSelectPlayer={openPlayer} />
  else if (view === 'slip') {
    content = (
      <Suspense fallback={<p style={{ color: '#8b94a9', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
        <SlipBoard sport="nba" onSport={onSlipSport} drawer={entry?.drawer === true} />
      </Suspense>
    )
  }
  else content = <EmptyTab {...(EMPTY_COPY[view] || EMPTY_COPY.lineups)} />

  return (
    <div className="wnba-root nba-root">
      <nav className="wnba-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="wnba-nav-logo" onClick={onNavigateHome} title="cgpropz home">cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="wnba-nav-links">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`btn-ghost${view === item.id ? ' active' : ''}`}
                data-testid={item.id === 'slip' ? 'nba-slip-nav' : undefined}
                onClick={() => openView(item.id)}
              >
                {item.label}
              </button>
            ))}
            <GuideNavLinks />
          </div>
          <div className="wnba-player-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            type="search"
            placeholder="Search players"
            aria-label="Search players"
            disabled
          />
          </div>
        </PageMenu>
      </nav>
      <div className="wnba-content" key={tier || 'free'}>
        <Suspense fallback={<RouteFallback inset />}>
          {content}
        </Suspense>
      </div>
    </div>
  )
}
