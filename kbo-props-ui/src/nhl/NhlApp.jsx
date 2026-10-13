import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import { canSeeAgs, sportAccess } from '../entitlements'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import { useNhlOpen } from '../useNhlOpen'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import '../nfl/nfl.css'
import './nhl.css'

const NhlAgs = lazy(() => import('./NhlAgs'))
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

const SlipOptimizer = lazy(() => import('../SlipOptimizer'))

export default function NhlApp({ sport, setSport, onNavigateHome, onNavigatePricing }) {
  const { user, tier } = useAuth()
  const menu = usePageMenu()
  const { open: serverOpen } = useNhlOpen()
  const unlocked = sportAccess(tier).nhl || serverOpen === true
  const showAgs = canSeeAgs(user, import.meta.env.DEV, typeof window === 'undefined' ? '' : window.location.search)
  const [view, setView] = useState(() => (showAgs && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ags') === '1' ? 'ags' : 'dashboard'))
  const [selected, setSelected] = useState(null)

  const openPlayer = (item) => {
    setSelected(item)
    setView('player')
  }

  let content = <NhlPropLines onSelectPlayer={openPlayer} />
  if (view === 'player') content = <NhlPlayerPage item={selected} onBack={() => setView('dashboard')} />
  else if (view === 'ags' && showAgs) content = <NhlAgs />
  else if (view === 'projections') content = <NhlProjections onSelectPlayer={openPlayer} />
  else if (view === 'sharp') content = <NhlSharpOdds onSelectPlayer={openPlayer} />
  else if (view === 'lineups') content = <NhlLineups />
  else if (view === 'dvp') content = <NhlDvp />
  else if (view === 'slip') {
    content = (
      <Suspense fallback={<p style={{ color: '#9fb5a8', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
        <SlipOptimizer sport="nhl" />
      </Suspense>
    )
  }

  return (
    <div className="nfl-root nhl-root">
      <nav className="nfl-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="nfl-nav-links">
            {NAV.map((item) => (
              <button key={item.id} data-testid={item.id === 'slip' ? 'nhl-slip-nav' : `nhl-nav-${item.id}`} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>
            ))}
            {showAgs && (
              <button data-testid="nhl-nav-ags" className={view === 'ags' ? 'active' : ''} onClick={() => setView('ags')}>AGS</button>
            )}
            <GuideNavLinks />
          </div>
          <button className="nfl-pro-badge" onClick={onNavigatePricing}>{unlocked ? 'MANAGE' : 'UPGRADE'}</button>
        </PageMenu>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        <Suspense fallback={<RouteFallback inset />}>
          {view === 'dashboard' || view === 'ags' ? content : (
            <Paywall onNavigate={onNavigatePricing} sport="nhl" unlocked={unlocked}>{content}</Paywall>
          )}
        </Suspense>
      </main>
    </div>
  )
}
