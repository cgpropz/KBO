import { lazy, Suspense, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import PublicLanding from './PublicLanding'
import { useNbaOpen } from './useNbaOpen'
import CheckoutSuccess from './CheckoutSuccess'
import SiteFooter from './SiteFooter'
import RouteFallback from './RouteFallback'
import { sportFromSearch } from './appSport'
import { freePreviewBannerText } from './freePreviewCopy'
import './FreeFunnel.css'
import './App.css'

const AuthPage = lazy(() => import('./AuthPage'))
const CgpropzLanding = lazy(() => import('./CgpropzLanding'))

const sportImporters = {
  kbo: () => import('./KboApp'),
  wnba: () => import('./wnba/WnbaApp'),
  nfl: () => import('./nfl/NflApp'),
  nba: () => import('./nba/NbaApp'),
  nhl: () => import('./nhl/NhlApp'),
}
const sportLoads = new Map()
function loadSport(id) {
  if (!sportLoads.has(id)) sportLoads.set(id, sportImporters[id]())
  return sportLoads.get(id)
}
if (typeof window !== 'undefined') {
  const linked = sportFromSearch(window.location.search)
  if (linked) loadSport(linked)
}

const KboApp = lazy(() => loadSport('kbo'))
const WnbaApp = lazy(() => loadSport('wnba'))
const NflApp = lazy(() => loadSport('nfl'))
const NbaApp = lazy(() => loadSport('nba'))
const NhlApp = lazy(() => loadSport('nhl'))

const SPORT_STORAGE_KEY = 'cg_sport';

function App() {
  const { user, tier } = useAuth();
  const [previewNode, setPreviewNode] = useState(null);
  const nba = useNbaOpen();
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'hub';
    return sportFromSearch(window.location.search) ? 'home' : 'hub';
  });
  // Pre-login flow: marketing page first, then the login/signup form.
  const [publicView, setPublicView] = useState('landing'); // 'landing' | 'auth'
  const [authMode, setAuthMode] = useState('login');
  const [sport, setSportState] = useState(() => {
    if (typeof window !== 'undefined') {
      const linked = sportFromSearch(window.location.search);
      if (linked) {
        try { localStorage.setItem(SPORT_STORAGE_KEY, linked); } catch { /* ignore */ }
        return linked;
      }
    }
    if (typeof localStorage === 'undefined') return 'kbo';
    return localStorage.getItem(SPORT_STORAGE_KEY) || 'kbo';
  });

  const setSport = (next) => {
    setSportState(next);
    try { localStorage.setItem(SPORT_STORAGE_KEY, next); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!previewNode) {
      document.documentElement.style.removeProperty('--ff-preview-offset');
      return undefined;
    }
    const apply = () => {
      const height = Math.ceil(previewNode.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty('--ff-preview-offset', `${height}px`);
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(previewNode);
    window.addEventListener('resize', apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--ff-preview-offset');
    };
  }, [previewNode]);

  // Stored cg_sport=nba stays put until the access check finishes, so a later
  // public flag does not wipe All-Access. Until then the NBA shell is not
  // mounted. Adjusted during render (not in an effect) once the check is closed.
  // NHL is a live sport: logged-out and free visitors enter it and hit the
  // same paywall as KBO, WNBA, and NFL.
  if (sport === 'nba' && !nba.ready) {
    return (
      <>
        <RouteFallback />
        <SiteFooter />
      </>
    );
  }
  if (sport === 'nba' && !nba.open) {
    setSport('kbo');
  }
  const visibleSport = sport === 'nba' && nba.open ? 'nba' : sport === 'nba' ? 'kbo' : sport;

  const openSignUp = () => { setAuthMode('signup'); setPublicView('auth'); };
  const openLogin = () => { setAuthMode('login'); setPublicView('auth'); };
  // Pops up after a Stripe Payment Link redirects back with ?checkout=success.
  // Stable key keeps it mounted if the page behind it switches branches.
  const checkoutSuccess = <CheckoutSuccess key="checkout-success" onSignUp={openSignUp} onLogin={openLogin} />;

  /* Not logged in → login/signup form when requested */
  if (!user && publicView === 'auth') {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <AuthPage initialMode={authMode} onBack={() => setPublicView('landing')} />
        </Suspense>
        <SiteFooter />
        {checkoutSuccess}
      </>
    );
  }

  /* Front door: marketing page (logged out) or cgpropz hub (logged in) */
  if (view === 'hub') {
    return (
      <>
        {user ? (
          <Suspense fallback={<RouteFallback />}>
            <CgpropzLanding
              onEnterSport={(s) => { setSport(s); setView('home'); }}
              onNavigate={(nextView) => { setSport('kbo'); setView(nextView); }}
            />
          </Suspense>
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

  /* Anonymous visitors and free accounts browse in preview mode. The server
     sends the top 3 lines per board, except NFL while its preview flag is off. */
  const seesFreePreview = !user || tier === 'free'
  const previewBar = seesFreePreview && (
    <div className="ff-preview-bar" role="note" ref={setPreviewNode}>
      <span>👀 {freePreviewBannerText(visibleSport)}</span>
      {!user && (
        <>
          <button className="ff-btn ff-btn-primary ff-btn-small" onClick={openSignUp}>Sign up free</button>
          <button className="ff-btn ff-btn-ghost ff-btn-small" onClick={openLogin}>Log in</button>
        </>
      )}
      {user && (
        <button className="ff-btn ff-btn-primary ff-btn-small" onClick={() => { setSport('kbo'); setView('pricing'); }}>View plans</button>
      )}
    </div>
  );

  let sportApp;
  if (visibleSport === 'wnba') {
    /* WNBA section — separate sport shell behind the same auth */
    sportApp = (
      <WnbaApp
        sport={visibleSport}
        setSport={setSport}
        onNavigateKbo={(nextView) => { setSport('kbo'); setView(nextView || 'pricing'); }}
      />
    );
  } else if (visibleSport === 'nba') {
    sportApp = (
      <NbaApp
        sport={visibleSport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSport('kbo'); setView('pricing'); }}
      />
    );
  } else if (visibleSport === 'nhl') {
    sportApp = (
      <NhlApp
        sport={visibleSport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSport('kbo'); setView('pricing'); }}
      />
    );
  } else if (visibleSport === 'nfl') {
    sportApp = (
      <NflApp
        sport={visibleSport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSport('kbo'); setView('pricing'); }}
      />
    );
  } else {
    /* KBO section — same nav + board shell as WNBA/NFL */
    sportApp = (
      <KboApp
        sport={visibleSport}
        setSport={setSport}
        onNavigateHome={() => setView('hub')}
        initialView={view}
      />
    );
  }

  return (
    <>
      {previewBar}
      <Suspense fallback={<RouteFallback />}>
        {sportApp}
      </Suspense>
      <SiteFooter />
      {checkoutSuccess}
    </>
  );
}

export default App
