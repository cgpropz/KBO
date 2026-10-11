import { useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import { sportAccess } from '../entitlements'
import SportSwitcher from '../SportSwitcher'
import { useNhlOpen } from '../useNhlOpen'
import '../nfl/nfl.css'
import NhlDvp from './NhlDvp'
import NhlLineups from './NhlLineups'
import NhlPlayerPage from './NhlPlayerPage'
import NhlProjections from './NhlProjections'
import NhlPropLines from './NhlPropLines'
import NhlSharpOdds from './NhlSharpOdds'
import './nhl.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'Board' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'dvp', label: 'DvP' },
]

export default function NhlApp({ sport, setSport, onNavigateHome, onNavigatePricing }) {
  const { tier } = useAuth()
  const { open: serverOpen } = useNhlOpen()
  const unlocked = sportAccess(tier).nhl || serverOpen === true
  const [view, setView] = useState('dashboard')
  const [selected, setSelected] = useState(null)

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

  return (
    <div className="nfl-root nhl-root">
      <nav className="nfl-nav">
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="nfl-nav-links">
          {NAV.map((item) => (
            <button key={item.id} data-testid={`nhl-nav-${item.id}`} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>
          ))}
        </div>
        <button className="nfl-pro-badge" onClick={onNavigatePricing}>NHL</button>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        {view === 'dashboard' ? content : (
          <Paywall onNavigate={onNavigatePricing} sport="nhl" unlocked={unlocked}>{content}</Paywall>
        )}
      </main>
    </div>
  )
}
