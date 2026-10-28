import { lazy, Suspense, useState } from 'react'
import VisitedPane from '../VisitedPane'
import { useSportView } from '../useSportView'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import { sportAccess } from '../entitlements'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import { useNhlOpen } from '../useNhlOpen'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import CheatsheetsNavLink from '../CheatsheetsNavLink'
import '../nfl/nfl.css'
import './nhl.css'

const NhlDvp = lazy(() => import('./NhlDvp'))
const NhlLineups = lazy(() => import('./NhlLineups'))
const NhlPlayerPage = lazy(() => import('./NhlPlayerPage'))
const NhlProjections = lazy(() => import('./NhlProjections'))
const NhlPropLines = lazy(() => import('./NhlPropLines'))
const NhlSharpOdds = lazy(() => import('./NhlSharpOdds'))

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'Board' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'dvp', label: 'DvP' },
  { id: 'slip', label: 'Slip Builder' },
]

const SlipBoard = lazy(() => import('../SlipBoard'))

export default function NhlApp({ sport, setSport, onSlipSport, onNavigateHome, onNavigatePricing, entry, forceHome, homeTick = 0 }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const { open: serverOpen } = useNhlOpen()
  const unlocked = sportAccess(tier).nhl || serverOpen === true
  const [view, setView] = useSportView({ sport: 'nhl', entry, forceHome, homeTick })
  const [selected, setSelected] = useState(entry?.item || null)

  const openPlayer = (item) => {
    setSelected(item)
    setView('player')
  }

  const paid = (node) => <Paywall onNavigate={onNavigatePricing} sport="nhl" unlocked={unlocked}>{node}</Paywall>

  return (
    <div className="nfl-root nhl-root">
      <nav className="nfl-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="nfl-nav-links">
            <CheatsheetsNavLink />
            {NAV.map((item) => (
              <button key={item.id} data-testid={item.id === 'slip' ? 'nhl-slip-nav' : `nhl-nav-${item.id}`} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>
            ))}
            <GuideNavLinks />
          </div>
          <button className="nfl-pro-badge" onClick={onNavigatePricing}>{unlocked ? 'MANAGE' : 'UPGRADE'}</button>
        </PageMenu>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        {view === 'player' && (
          <Suspense fallback={<RouteFallback inset />}>
            {paid(<NhlPlayerPage item={selected} onBack={() => setView('dashboard')} />)}
          </Suspense>
        )}
        {view === 'slip' && (
          <Suspense fallback={<p style={{ color: '#9fb5a8', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
            {paid(<SlipBoard sport="nhl" onSport={onSlipSport} drawer={entry?.drawer === true} />)}
          </Suspense>
        )}
        <VisitedPane active={view === 'dashboard'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NhlPropLines onSelectPlayer={openPlayer} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'projections'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NhlProjections onSelectPlayer={openPlayer} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'sharp'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NhlSharpOdds onSelectPlayer={openPlayer} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'lineups'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NhlLineups />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'dvp'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NhlDvp />)}</Suspense>
        </VisitedPane>
      </main>
    </div>
  )
}
