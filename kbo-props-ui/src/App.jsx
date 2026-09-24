import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import AuthPage from './AuthPage'
import PublicLanding from './PublicLanding'
import KboApp from './KboApp'
import CgpropzLanding from './CgpropzLanding'
import WnbaApp from './wnba/WnbaApp'
import NflApp from './nfl/NflApp'
import './App.css'

const SPORT_STORAGE_KEY = 'cg_sport';

function App() {
  const { user, loading } = useAuth();
  const [showUI, setShowUI] = useState(false);
  const [view, setView] = useState('hub');
  // Pre-login flow: marketing page first, then the login/signup form.
  const [publicView, setPublicView] = useState('landing'); // 'landing' | 'auth'
  const [authMode, setAuthMode] = useState('login');
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
        background: 'linear-gradient(135deg, #04140a, #22c55e)',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'Arial, sans-serif'
      }}>
        Loading cgpropz…
      </div>
    );
  }

  /* Not logged in → marketing page first, then login/signup */
  if (!user) {
    if (publicView === 'landing') {
      return (
        <PublicLanding
          onGetStarted={() => { setAuthMode('signup'); setPublicView('auth'); }}
          onLogin={() => { setAuthMode('login'); setPublicView('auth'); }}
        />
      );
    }
    return <AuthPage initialMode={authMode} onBack={() => setPublicView('landing')} />;
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

  if (sport === 'nfl') {
    return (
      <NflApp
        sport={sport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSport('kbo'); setView('pricing'); }}
      />
    );
  }

  /* KBO section — same nav + board shell as WNBA/NFL */
  return (
    <KboApp
      sport={sport}
      setSport={setSport}
      onNavigateHome={() => setView('hub')}
      initialView={view}
    />
  );
}

export default App
