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
import CgpropzLanding from './CgpropzLanding'
import SubscriptionPage from './SubscriptionPage'
import TutorialPage from './TutorialPage'
import Paywall from './Paywall'
import WnbaApp from './wnba/WnbaApp'
import SportSwitcher from './SportSwitcher'
import './App.css'

/* Views that require a paid subscription */
const PAID_VIEWS = new Set(['projections', 'batters', 'props', 'optimizer', 'matchups']);

const SPORT_STORAGE_KEY = 'cg_sport';

function App() {
  const { user, loading } = useAuth();
  const [showUI, setShowUI] = useState(false);
  const [view, setView] = useState('hub');
  const [sport, setSportState] = useState(() => {
    if (typeof localStorage === 'undefined') return 'kbo';
    return localStorage.getItem(SPORT_STORAGE_KEY) || 'kbo';
  });

  const setSport = (next) => {
    setSportState(next);
    try { localStorage.setItem(SPORT_STORAGE_KEY, next); } catch { /* ignore */ }
  };

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
        background: 'linear-gradient(135deg, #003d7a, #ff6900)',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'Arial, sans-serif'
      }}>
        Loading cgpropz…
      </div>
    );
  }

  /* Not logged in → show login/signup */
  if (!user) {
    return <AuthPage />;
  }

  /* cgpropz hub — sport-agnostic front door (sits above both sports) */
  if (view === 'hub') {
    return (
      <CgpropzLanding
        onEnterSport={(s) => { setSport(s); setView('home'); }}
        onNavigate={(nextView) => { setSport('kbo'); setView(nextView); }}
      />
    );
  }

  /* WNBA section — separate sport shell behind the same auth */
  if (sport === 'wnba') {
    return (
      <WnbaApp
        sport={sport}
        setSport={setSport}
        onNavigateKbo={(nextView) => { setSport('kbo'); setView(nextView || 'pricing'); }}
      />
    );
  }

  if (view === 'home') {
    return <LandingPage onNavigate={setView} sport={sport} setSport={setSport} />;
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
      <Nav view={view} setView={setView} sport={sport} setSport={setSport} />
      {needsPaywall
        ? <Paywall onNavigate={setView}>{content}</Paywall>
        : content}
    </div>
  );
}

/* ── Nav bar (extracted for readability) ── */
function Nav({ view, setView, sport, setSport }) {
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
        <button className="nav-logo" onClick={() => handleNav('hub')} title="cgpropz home">cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
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
