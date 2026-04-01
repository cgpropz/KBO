import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import AuthPage from './AuthPage'
import PlayerPropsUI from './PlayerPropsUI'
import StrikeoutProjections from './StrikeoutProjections'
import BatterProjections from './BatterProjections'
import PitcherRankings from './PitcherRankings'
import PropTracker from './PropTracker'
import SlipOptimizer from './SlipOptimizer'
import MatchupDeepDive from './MatchupDeepDive'
import LandingPage from './LandingPage'
import SubscriptionPage from './SubscriptionPage'
import Paywall from './Paywall'

/* Views that require a paid subscription */
const PAID_VIEWS = new Set(['projections', 'batters', 'props', 'optimizer', 'matchups']);

function App() {
  const { user, loading } = useAuth();
  const [showUI, setShowUI] = useState(false);
  const [view, setView] = useState('home');

  useEffect(() => {
    setTimeout(() => setShowUI(true), 100);
  }, []);

  if (loading || !showUI) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'linear-gradient(135deg, #003d7a, #00a8e8)',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'Arial, sans-serif'
      }}>
        ⚾ Loading KBO Player Props...
      </div>
    );
  }

  /* Not logged in → show login/signup */
  if (!user) {
    return <AuthPage />;
  }

  if (view === 'home') {
    return <LandingPage onNavigate={setView} />;
  }

  const content = (() => {
    switch (view) {
      case 'projections': return <StrikeoutProjections />;
      case 'batters':     return <BatterProjections />;
      case 'props':       return <PlayerPropsUI />;
      case 'rankings':    return <PitcherRankings />;
      case 'tracker':     return <PropTracker />;
      case 'optimizer':   return <SlipOptimizer />;
      case 'matchups':    return <MatchupDeepDive />;
      case 'pricing':     return <SubscriptionPage />;
      default:            return null;
    }
  })();

  const needsPaywall = PAID_VIEWS.has(view);

  return (
    <div>
      <Nav view={view} setView={setView} />
      {needsPaywall
        ? <Paywall onNavigate={setView}>{content}</Paywall>
        : content}
    </div>
  );
}

/* ── Nav bar (extracted for readability) ── */
function Nav({ view, setView }) {
  const { signOut, user } = useAuth();
  const navBtn = (id, label) => ({
    padding: '0.75rem 1.5rem',
    background: view === id ? '#7c3aed' : 'transparent',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: view === id ? '700' : '400',
    fontSize: '0.95rem',
    borderBottom: view === id ? '3px solid #c084fc' : '3px solid transparent',
    transition: 'all 0.2s',
  });

  return (
    <nav style={{
      display: 'flex',
      gap: '0',
      background: '#000',
      padding: '0 1.5rem',
      borderBottom: '2px solid #222',
      alignItems: 'center',
    }}>
      <button
        onClick={() => setView('home')}
        style={{
          padding: '0.75rem 1rem',
          background: 'transparent',
          color: '#c084fc',
          border: 'none',
          cursor: 'pointer',
          fontWeight: '700',
          fontSize: '1.1rem',
          transition: 'all 0.2s',
          letterSpacing: '-0.5px',
          marginRight: '0.5rem',
        }}
        title="Home"
      >
        KBO
      </button>
      <div style={{ width: '1px', height: '1.2rem', background: '#333', marginRight: '0.5rem' }} />
      <button onClick={() => setView('projections')} style={navBtn('projections')}>K Projections</button>
      <button onClick={() => setView('props')} style={navBtn('props')}>Player Props</button>
      <button onClick={() => setView('batters')} style={navBtn('batters')}>Batters</button>
      <button onClick={() => setView('rankings')} style={navBtn('rankings')}>Pitcher Rankings</button>
      <button onClick={() => setView('tracker')} style={navBtn('tracker')}>Tracker</button>
      <button onClick={() => setView('optimizer')} style={navBtn('optimizer')}>Slip Builder</button>
      <button onClick={() => setView('matchups')} style={navBtn('matchups')}>Matchups</button>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setView('pricing')}
        style={{
          padding: '0.6rem 1.2rem',
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: '700',
          fontSize: '0.85rem',
          transition: 'all 0.2s',
          letterSpacing: '0.3px',
          whiteSpace: 'nowrap',
          marginRight: '0.75rem',
        }}
      >
        Upgrade
      </button>
      <button
        onClick={signOut}
        style={{
          padding: '0.5rem 0.9rem',
          background: 'transparent',
          color: '#64748b',
          border: '1px solid #333',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.8rem',
          transition: 'all 0.2s',
        }}
        title={user?.email}
      >
        Sign Out
      </button>
    </nav>
  );
}

export default App
