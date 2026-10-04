import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import AuthPage from './AuthPage'
import PublicLanding from './PublicLanding'
import KboApp from './KboApp'
import CgpropzLanding from './CgpropzLanding'
import WnbaApp from './wnba/WnbaApp'
import NflApp from './nfl/NflApp'
import CheckoutSuccess from './CheckoutSuccess'
import { buildAppPath, defaultBoardView, hubPath, isBoardView, parseAppRoute } from './appRoute'
import './FreeFunnel.css'
import './App.css'

const SPORT_STORAGE_KEY = 'cg_sport';
const ROUTE_BASE = import.meta.env.BASE_URL || '/';

function readBootRoute() {
  if (typeof window === 'undefined') return { screen: 'hub', sport: null, view: null };
  return parseAppRoute(window.location.pathname, ROUTE_BASE);
}

function rememberSport(next) {
  try { localStorage.setItem(SPORT_STORAGE_KEY, next); } catch { /* ignore */ }
}

// Push the board path without dropping checkout/UTM query params. A matching
// path is left alone so reload and repeat clicks do not stack history entries.
function assignPath(path) {
  if (typeof window === 'undefined' || !path) return;
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path + window.location.search);
}

function App() {
  const { user, loading } = useAuth();
  const [showUI, setShowUI] = useState(false);
  const [boot] = useState(readBootRoute);
  // 'hub' is the front door. 'home' is whichever sport board the URL names.
  const [view, setView] = useState(boot.screen === 'home' ? 'home' : 'hub');
  // Pre-login flow: marketing page first, then the login/signup form.
  const [publicView, setPublicView] = useState('landing'); // 'landing' | 'auth'
  const [authMode, setAuthMode] = useState('login');
  const [sport, setSportState] = useState(() => {
    if (boot.sport) return boot.sport;
    if (typeof localStorage === 'undefined') return 'kbo';
    return localStorage.getItem(SPORT_STORAGE_KEY) || 'kbo';
  });
  const [boardView, setBoardView] = useState(boot.view || defaultBoardView(boot.sport || 'kbo'));

  const setSport = (next) => {
    if (next === sport) return;
    setSportState(next);
    rememberSport(next);
    const nextBoard = defaultBoardView(next);
    setBoardView(nextBoard);
    assignPath(buildAppPath(next, nextBoard, ROUTE_BASE));
  };

  const openBoard = (nextSport, nextView) => {
    const nextBoard = isBoardView(nextSport, nextView) ? nextView : defaultBoardView(nextSport);
    setSportState(nextSport);
    rememberSport(nextSport);
    setBoardView(nextBoard);
    setView('home');
    assignPath(buildAppPath(nextSport, nextBoard, ROUTE_BASE));
    window.scrollTo(0, 0);
  };

  const goHub = () => {
    setView('hub');
    assignPath(hubPath(ROUTE_BASE));
  };

  const onBoardView = (next) => {
    if (!isBoardView(sport, next)) return;
    setBoardView(next);
    assignPath(buildAppPath(sport, next, ROUTE_BASE));
  };

  useEffect(() => {
    const onPop = () => {
      const route = parseAppRoute(window.location.pathname, ROUTE_BASE);
      if (route.screen !== 'home') {
        setView('hub');
        return;
      }
      setSportState(route.sport);
      rememberSport(route.sport);
      setBoardView(route.view || defaultBoardView(route.sport));
      setView('home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
            onEnterSport={(s) => openBoard(s, defaultBoardView(s))}
            onNavigate={(nextView) => (nextView && nextView !== 'hub' ? openBoard('kbo', nextView) : goHub())}
          />
        ) : (
          <PublicLanding
            onGetStarted={openSignUp}
            onLogin={openLogin}
            onOpenBoard={(s) => openBoard(s, defaultBoardView(s))}
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
        routeView={boardView}
        onViewChange={onBoardView}
        onNavigateKbo={(nextView) => (nextView && nextView !== 'hub' ? openBoard('kbo', nextView) : goHub())}
      />
    );
  } else if (sport === 'nfl') {
    sportApp = (
      <NflApp
        sport={sport}
        setSport={setSport}
        routeView={boardView}
        onViewChange={onBoardView}
        onNavigateHome={goHub}
        onNavigatePricing={() => openBoard('kbo', 'pricing')}
      />
    );
  } else {
    /* KBO section — same nav + board shell as WNBA/NFL */
    sportApp = (
      <KboApp
        sport={sport}
        setSport={setSport}
        routeView={boardView}
        onViewChange={onBoardView}
        onNavigateHome={goHub}
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
