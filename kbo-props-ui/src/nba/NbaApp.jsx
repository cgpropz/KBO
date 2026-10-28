import { lazy, Suspense, useState } from 'react'
import VisitedPane from '../VisitedPane'
import { useSportView } from '../useSportView'
import { useAuth } from '../AuthContext'
import '../wnba/wnba.css'
import './nba.css'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import CheatsheetsNavLink from '../CheatsheetsNavLink'

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

export default function NbaApp({ sport, setSport, onSlipSport, onNavigateHome, onNavigatePricing, entry, forceHome, homeTick = 0 }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useSportView({ sport: 'nba', entry, forceHome, homeTick })
  const [playerName, setPlayerName] = useState(entry?.player || '')
  const openView = (next) => {
    if (next !== 'players') setPlayerName('')
    setView(resolveNbaView(next))
  }
  const openPlayer = (name) => {
    setPlayerName(name || '')
    setView('players')
  }

  return (
    <div className="wnba-root nba-root">
      <nav className="wnba-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="wnba-nav-logo" onClick={onNavigateHome} title="cgpropz home">cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="wnba-nav-links">
            <CheatsheetsNavLink />
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
        {view === 'slip' && (
          <Suspense fallback={<p style={{ color: '#8b94a9', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
            <SlipBoard sport="nba" onSport={onSlipSport} drawer={entry?.drawer === true} />
          </Suspense>
        )}
        {view === 'lineups' && <EmptyTab {...EMPTY_COPY.lineups} />}
        <VisitedPane active={view === 'dashboard'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NbaDashboard onSelectPlayer={openPlayer} onNavigate={openView} onNavigatePricing={onNavigatePricing} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'projections'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NbaEdge />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'sharp'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NbaSharpOdds onSelectPlayer={openPlayer} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'players'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NbaPlayers initialName={playerName} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'teams'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NbaTeams />
          </Suspense>
        </VisitedPane>
      </div>
    </div>
  )
}
