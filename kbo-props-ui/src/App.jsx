import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import AuthPage from './AuthPage'
import PublicLanding from './PublicLanding'
import KboApp from './KboApp'
import CgpropzLanding from './CgpropzLanding'
import WnbaApp from './wnba/WnbaApp'
import NflApp from './nfl/NflApp'
import CheckoutSuccess from './CheckoutSuccess'
import './FreeFunnel.css'
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

  const openSignUp = () => { setAuthMode('signup'); setPublicView('auth'); };
  const openLogin = () => { setAuthMode('login'); setPublicView('auth'); };
  // Pops up after a Stripe Payment Link redirects back with ?checkout=success.
  // Stable key keeps it mounted if the page behind it switches branches.
  const checkoutSuccess = <CheckoutSuccess key="checkout-success" onSignUp={openSignUp} onLogin={openLogin} />;

  /* Not logged in → login/signup form when requested */
  if (!user && publicView === 'auth') {
    return (
      <>
        <AuthPage initialMode={authMode} onBack={() => setPublicView('landing')} />
        {checkoutSuccess}
      </>
    );
  }

  /* Front door: marketing page (logged out) or cgpropz hub (logged in) */
  if (view === 'hub') {
    return (
      <>
        {user ? (
          <CgpropzLanding
            onEnterSport={(s) => { setSport(s); setView('home'); }}
            onNavigate={(nextView) => { setSport('kbo'); setView(nextView); }}
          />
        ) : (
          <PublicLanding
            onGetStarted={openSignUp}
            onLogin={openLogin}
            onOpenBoard={(s) => { setSport(s); setView('home'); window.scrollTo(0, 0); }}
          />
        )}
        {checkoutSuccess}
      </>
    );
  }

  /* Logged-out visitors can browse the boards in preview mode (the server
     only sends them the top 3 lines per board + a locked count). */
  const previewBar = !user && (
    <div className="ff-preview-bar" role="note">
      <span>👀 Free preview: you're seeing the top 3 lines on each board.</span>
      <button className="ff-btn ff-btn-primary ff-btn-small" onClick={openSignUp}>Sign up free</button>
      <button className="ff-btn ff-btn-ghost ff-btn-small" onClick={openLogin}>Log in</button>
    </div>
  );

  let sportApp;
  if (sport === 'wnba') {
    /* WNBA section — separate sport shell behind the same auth */
    sportApp = (
      <WnbaApp
        sport={sport}
        setSport={setSport}
        onNavigateKbo={(nextView) => { setSport('kbo'); setView(nextView || 'pricing'); }}
      />
    );
  } else if (sport === 'nfl') {
    sportApp = (
      <NflApp
        sport={sport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSport('kbo'); setView('pricing'); }}
      />
    );
  } else {
    /* KBO section — same nav + board shell as WNBA/NFL */
    sportApp = (
      <KboApp
        sport={sport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        initialView={view}
      />
    );
  }

  return (
    <>
      {previewBar}
      {sportApp}
      {checkoutSuccess}
    </>
  );
}

export default App
