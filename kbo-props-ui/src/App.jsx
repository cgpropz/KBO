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
import TutorialPage from './TutorialPage'
import Paywall from './Paywall'
import './App.css'

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
      case 'projections': return <StrikeoutProjections onNavigate={setView} />;
      case 'batters':     return <BatterProjections />;
      case 'props':       return <PlayerPropsUI />;
      case 'rankings':    return <PitcherRankings />;
      case 'tracker':     return <PropTracker />;
      case 'optimizer':   return <SlipOptimizer onNavigate={setView} />;
      case 'matchups':    return <MatchupDeepDive />;
      case 'pricing':     return <SubscriptionPage />;
      case 'tutorial':    return <TutorialPage onNavigate={setView} />;
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
  const { signOut, user, tier } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isPaid = tier && tier !== 'free';

  const navItems = [
    { id: 'projections', label: 'Pitchers' },
    { id: 'props', label: 'Player Props' },
    { id: 'batters', label: 'Batters' },
    { id: 'rankings', label: 'Pitcher Rankings' },
    { id: 'tracker', label: 'Tracker' },
    { id: 'optimizer', label: 'Slip Builder' },
    { id: 'matchups', label: 'Matchups' },
  ];

  if (import.meta.env.DEV) {
    navItems.push({ id: 'tutorial', label: 'Tutorial' });
  }

  const handleNav = (id) => {
    setView(id);
    setMenuOpen(false);
  };

  return (
    <>
      <nav className="app-nav">
        <button className="nav-logo" onClick={() => handleNav('home')}>KBO</button>
        <div className="nav-divider" />
        <div className="nav-links-desktop">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-btn ${view === item.id ? 'nav-btn-active' : ''}`}
              onClick={() => handleNav(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {isPaid ? (
          <button className="nav-manage" onClick={() => handleNav('pricing')}>Manage Subscription</button>
        ) : (
          <button className="nav-upgrade" onClick={() => handleNav('pricing')}>Upgrade</button>
        )}
        <button className="nav-signout" onClick={signOut} title={user?.email}>Sign Out</button>
        <button className="nav-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          {menuOpen ? '✕' : '☰'}
        </button>
      </nav>
      {menuOpen && (
        <div className="nav-mobile-menu">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-mobile-btn ${view === item.id ? 'nav-mobile-btn-active' : ''}`}
              onClick={() => handleNav(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className="nav-mobile-divider" />
          {isPaid ? (
            <button className="nav-mobile-btn" onClick={() => handleNav('pricing')}>Manage Subscription</button>
          ) : (
            <button className="nav-mobile-btn" onClick={() => handleNav('pricing')}>Upgrade</button>
          )}
          <button className="nav-mobile-btn nav-mobile-signout" onClick={() => { signOut(); setMenuOpen(false); }}>
            Sign Out
          </button>
        </div>
      )}
    </>
  );
}

export default App
