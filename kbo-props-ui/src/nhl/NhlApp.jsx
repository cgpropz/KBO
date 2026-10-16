import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import { sportAccess } from '../entitlements'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import { useNhlOpen } from '../useNhlOpen'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
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

const SlipRail = lazy(() => import('../SlipRail'))

export default function NhlApp({ sport, setSport, onNavigateHome, onNavigatePricing, entry, onSlipSport }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const { open: serverOpen } = useNhlOpen()
  const unlocked = sportAccess(tier).nhl || serverOpen === true
  const [view, setView] = useState(entry?.view === 'slip' ? 'slip' : entry?.view === 'player' && entry.item ? 'player' : 'dashboard')
  const [selected, setSelected] = useState(entry?.item || null)

  const openPlayer = (item) => {
    setSelected(item)
    setView('player')
  }

  let content = <NhlPropLines onSelectPlayer={openPlayer} />
  if (view === 'player') content = <NhlPlayerPage item={selected} onBack={() => setView('dashboard')} />
  else if (view === 'projections') content = <NhlProjections onSelectPlayer={openPlayer} />
  else if (view === 'sharp') content = <NhlSharpOdds onSelectPlayer={openPlayer} />
  else if (view === 'lineups') content = <NhlLineups />
  else if (view === 'dvp') content = <NhlDvp />
  else if (view === 'slip') {
    content = (
      <Suspense fallback={<p style={{ color: '#9fb5a8', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
        <SlipRail sport="nhl" onSport={onSlipSport} />
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
            <GuideNavLinks />
          </div>
          <button className="nfl-pro-badge" onClick={onNavigatePricing}>{unlocked ? 'MANAGE' : 'UPGRADE'}</button>
        </PageMenu>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        <Suspense fallback={<RouteFallback inset />}>
          {view === 'dashboard' ? content : (
            <Paywall onNavigate={onNavigatePricing} sport="nhl" unlocked={unlocked}>{content}</Paywall>
          )}
        </Suspense>
      </main>
    </div>
  )
}
