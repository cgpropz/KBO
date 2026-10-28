import { lazy, Suspense, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import PublicLanding from './PublicLanding'
import { useNbaOpen } from './useNbaOpen'
import CheckoutSuccess from './CheckoutSuccess'
import SiteFooter from './SiteFooter'
import RouteFallback from './RouteFallback'
import { accountFromSearch, slipLinkFromSearch, sportFromSearch } from './appSport'
import { canSeeCheatsheets } from './entitlements'
import { cheatsheetsGate, cheatsheetsRequested, stripCheatsheetsSearch } from './cheatsheets/access'
import { signedInCanSeeCheatsheets } from './cheatsheets/sessionGate'
import { slipTabSearch, sportTabSearch } from './memberNav'
import { rememberMemberSport, resolveMemberSport, sportAfterNbaGate } from './memberSport'
import { pauseTokenFromSearch } from './pauseWindow'
import { freePreviewBannerText } from './freePreviewCopy'
import { subscribeBoardRefreshing } from './apiData'
import { useAgeGate } from './ageGateContext'
import { noteSportContext } from './analytics'
import './FreeFunnel.css'
import './App.css'

const AuthPage = lazy(() => import('./AuthPage'))
const SetNewPassword = lazy(() => import('./SetNewPassword'))
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
const Cheatsheets = lazy(() => import('./cheatsheets/Cheatsheets'))

function App() {
  const { user, tier, tierConfirmed, passwordRecovery, clearPasswordRecovery } = useAuth();
  const { requireAge } = useAgeGate();
  const [previewNode, setPreviewNode] = useState(null);
  const [refreshingBoard, setRefreshingBoard] = useState(false);
  const nba = useNbaOpen();
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'hub';
    if (pauseTokenFromSearch(window.location.search) || accountFromSearch(window.location.search)) return 'pricing';
    return sportFromSearch(window.location.search) ? 'home' : 'hub';
  });
  // Logged-out cheatsheets visits stay closed until getSession settles.
  // A cached admin is allowed on the first paint; no effect setState.
  const [cheatsheetSessionChecked, setCheatsheetSessionChecked] = useState(false);
  // Pre-login flow: marketing page first, then the login/signup form.
  // A pause email link must be opened by the matching signed-in member.
  const [publicView, setPublicView] = useState(() => {
    if (typeof window === 'undefined') return 'landing';
    return pauseTokenFromSearch(window.location.search) ? 'auth' : 'landing';
  }); // 'landing' | 'auth'
  const [authMode, setAuthMode] = useState('login');
  const [entry, setEntry] = useState(() => {
    if (typeof window === 'undefined') return null
    return slipLinkFromSearch(window.location.search)
  });
  // Sport-tab clicks force the dashboard. The first load and a slip switch
  // still honor a named sub-page. homeTick asks the shell to go home without
  // remounting boards that are already open.
  const [forceHome, setForceHome] = useState(false);
  const [homeTick, setHomeTick] = useState(0);
  const [sport, setSportState] = useState(() => {
    if (typeof window === 'undefined') return 'nfl';
    // The account page lives on the KBO shell. This visit does not write
    // cg_member_sport, so the saved member sport stays put.
    if (accountFromSearch(window.location.search)) return 'kbo';
    return resolveMemberSport({
      search: window.location.search,
      storage: typeof localStorage === 'undefined' ? null : localStorage,
    });
  });

  // Sport switcher clicks only. Pricing hops and the closed-NBA fallback
  // change the in-memory sport without becoming the saved choice.
  const rememberSport = (next) => {
    setSportState(next);
    rememberMemberSport(typeof localStorage === 'undefined' ? null : localStorage, next);
  };

  const replaceSearch = (search) => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  };

  const chooseSport = (next) => {
    rememberSport(next);
    setEntry(null);
    setForceHome(true);
    setHomeTick((tick) => tick + 1);
    replaceSearch(sportTabSearch(typeof window === 'undefined' ? '' : window.location.search, next));
  };

  const chooseSlipSport = (next) => {
    rememberSport(next);
    setEntry({ view: 'slip', drawer: false });
    setForceHome(false);
    setHomeTick((tick) => tick + 1);
    replaceSearch(slipTabSearch(next));
  };

  useEffect(() => subscribeBoardRefreshing(setRefreshingBoard), []);

  useEffect(() => {
    if (typeof window === 'undefined' || !cheatsheetsRequested(window.location.search)) return undefined;
    const strip = () => {
      const next = stripCheatsheetsSearch(window.location.search);
      window.history.replaceState(null, '', `${window.location.pathname}${next}`);
    };
    if (canSeeCheatsheets(user)) return undefined;
    if (user) {
      strip();
      return undefined;
    }
    let cancelled = false;
    signedInCanSeeCheatsheets().then((allowed) => {
      if (cancelled) return;
      if (!allowed) strip();
      setCheatsheetSessionChecked(true);
    });
    return () => { cancelled = true; };
  }, [user]);

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

  // Recovery links land here with a session already. The form calls
  // updateUser({password}) and Continue leaves that session in place.
  if (passwordRecovery) {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <SetNewPassword onDone={clearPasswordRecovery} />
        </Suspense>
        <SiteFooter />
      </>
    );
  }

  const cheatsheetGate = cheatsheetsGate({
    search: typeof window === 'undefined' ? '' : window.location.search,
    user,
    sessionPending: !user && !cheatsheetSessionChecked,
  });
  if (cheatsheetGate === 'allow' || cheatsheetGate === 'wait') {
    return (
      <>
        {cheatsheetGate === 'allow' ? (
          <Suspense fallback={<RouteFallback />}>
            <Cheatsheets />
          </Suspense>
        ) : (
          <p role="status" style={{ margin: 0, padding: '48px 20px', textAlign: 'center', color: '#a1a1aa' }}>Checking access…</p>
        )}
        <SiteFooter />
      </>
    );
  }

  // A saved NBA choice stays in cg_member_sport until the access check
  // finishes, so a later public flag does not wipe All-Access. Until then the
  // NBA shell is not mounted. Adjusted during render (not in an effect) once
  // the check is closed. A closed NBA falls back to NFL in memory only.
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
    setSportState(sportAfterNbaGate(sport, false));
  }
  const visibleSport = sport === 'nba' && nba.open ? 'nba' : sport === 'nba' ? sportAfterNbaGate(sport, false) : sport;
  // Analytics only: remember the sport being browsed so a checkout from the
  // pricing view (rendered in the KBO shell) credits it. Idempotent.
  if (view === 'home') noteSportContext(visibleSport);

  const openSignUp = async () => {
    const allowed = await requireAge();
    if (!allowed) return;
    setAuthMode('signup');
    setPublicView('auth');
  };
  const openLogin = () => { setAuthMode('login'); setPublicView('auth'); };
  // Pops up after a Stripe Payment Link redirects back with ?checkout=success.
  // Stable key keeps it mounted if the page behind it switches branches.
  const checkoutSuccess = <CheckoutSuccess key="checkout-success" onSignUp={openSignUp} onLogin={openLogin} />;

  /* Not logged in → login/signup form when requested */
  if (!user && publicView === 'auth') {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <AuthPage
            initialMode={authMode}
            onBack={() => setPublicView('landing')}
            notice={pauseTokenFromSearch(window.location.search)
              ? 'Sign in with the membership this pause link was sent to. It only pauses that member.'
              : ''}
          />
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
              onEnterSport={(s, next) => { setSportState(s); setEntry(next || null); setView('home'); }}
              onNavigate={(nextView) => { setSportState('kbo'); setEntry(null); setView(nextView); }}
            />
          </Suspense>
        ) : (
          <PublicLanding
            onGetStarted={openSignUp}
            onLogin={openLogin}
            onOpenBoard={(s) => { setSportState(s); setView('home'); window.scrollTo(0, 0); }}
          />
        )}
        {checkoutSuccess}
      </>
    );
  }

  /* Anonymous visitors and free accounts browse in preview mode. The server
     sends the top 3 lines per board, except NFL while its preview flag is off. */
  const seesFreePreview = !user || (tierConfirmed && tier === 'free')
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
        <button className="ff-btn ff-btn-primary ff-btn-small" onClick={() => { setSportState('kbo'); setView('pricing'); }}>View plans</button>
      )}
    </div>
  );

  let sportApp;
  if (visibleSport === 'wnba') {
    /* WNBA section — separate sport shell behind the same auth */
    sportApp = (
      <WnbaApp
        homeTick={homeTick}
        sport={visibleSport}
        setSport={chooseSport}
        onSlipSport={chooseSlipSport}
        entry={entry}
        forceHome={forceHome}
        onNavigateKbo={(nextView) => { setSportState('kbo'); setView(nextView || 'pricing'); }}
      />
    );
  } else if (visibleSport === 'nba') {
    sportApp = (
      <NbaApp
        homeTick={homeTick}
        sport={visibleSport}
        setSport={chooseSport}
        onSlipSport={chooseSlipSport}
        entry={entry}
        forceHome={forceHome}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSportState('kbo'); setView('pricing'); }}
      />
    );
  } else if (visibleSport === 'nhl') {
    sportApp = (
      <NhlApp
        homeTick={homeTick}
        sport={visibleSport}
        setSport={chooseSport}
        onSlipSport={chooseSlipSport}
        entry={entry}
        forceHome={forceHome}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSportState('kbo'); setView('pricing'); }}
      />
    );
  } else if (visibleSport === 'nfl') {
    sportApp = (
      <NflApp
        homeTick={homeTick}
        sport={visibleSport}
        setSport={chooseSport}
        onSlipSport={chooseSlipSport}
        entry={entry}
        forceHome={forceHome}
        onNavigateHome={() => setView('hub')}
        onNavigatePricing={() => { setSportState('kbo'); setView('pricing'); }}
      />
    );
  } else {
    /* KBO section — same nav + board shell as WNBA/NFL */
    sportApp = (
      <KboApp
        homeTick={homeTick}
        sport={visibleSport}
        setSport={chooseSport}
        onSlipSport={chooseSlipSport}
        onNavigateHome={() => setView('hub')}
        initialView={view}
        entry={entry}
        forceHome={forceHome}
      />
    );
  }

  return (
    <>
      {refreshingBoard && <div className="board-refresh-note" role="status">Refreshing full board</div>}
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
