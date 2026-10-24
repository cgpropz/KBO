import { useEffect, useRef, useState } from 'react';
import { fetchApiDataset } from './apiData';
import { useAgeGate } from './ageGateContext';
import DiscordOnlyPlans from './DiscordOnlyPlans';
import { fitImage } from './fitImage';
import { kickoffLabel } from './nfl/gameCardModel';
import { teamLogoUrl } from './nfl/nflTeams';
import { PageMenu, PageMenuButton, usePageMenu } from './PageMenu';
import { STRIPE_LINKS } from './pricingTiers';
import { HERO_LANDING_SPORT_ID, LANDING_SPORTS } from './landingSports';
import { NFL_FREE_PREVIEW_ENABLED } from './nflPreviewFlag';
import { publicFaqs } from './publicFaqs';
import { OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling';
import { DataCredit } from './SiteFooter'
import { sessionAccessToken } from './supabaseClient';
import { buildCheckoutUrl, requestOfferCheckoutUrl, requestWeeklyCheckoutUrl } from './tracking';
import { observeVisibleOnce, trackCheckoutClick, trackFreeTop3View } from './analytics';
import { lineClause, lineWord } from './lineCount';
import { whenVisibleOrIdle } from './whenVisibleOrIdle';
import { rowStartMs } from './etStart';
import { freeTopEmptyText, kboHoldMessage } from './freeTopEmpty';
import PlayerMark from './PlayerMark';
import { playerInitials } from './playerMark';
import PlayableRecord from './PlayableRecord';
import './PublicLanding.css';

// O / U for a row's side. A neutral row (CG exactly 50) has no side and no letter.
function sideLetter(side) {
  return side === 'UNDER' ? 'U' : side === 'OVER' ? 'O' : '';
}

const FAQS = publicFaqs();
const HERO_SPORT = LANDING_SPORTS.find((sport) => sport.id === HERO_LANDING_SPORT_ID) || LANDING_SPORTS[0];

const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

const fmtScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
};

function ordinal(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '—';
  const mod = n % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

function kickoffText(row) {
  const ms = rowStartMs(row);
  if (ms == null) return '';
  return `${new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

function BoardTable({ rows, showHitRate, sport, showKickoff = false }) {
  if (!rows.length) return null;
  return (
    <div className="pl-table" role="table">
      <div className="pl-tr pl-th" role="row">
        <span>Player · prop</span>
        <span>Line</span>
        <span>Proj</span>
        <span>L10</span>
        <span>CG</span>
      </div>
      {rows.map((row) => (
        <div className="pl-tr" role="row" key={`${row.player}|${row.stat}|${row.line}|${row.side || ''}|${row.start || ''}`}>
          <span className="pl-player">
            <PlayerMark name={row.player} team={row.team} sport={sport} image={row.ppImageUrl} />
            <span>
              <b>{row.player}</b>
              <small>{row.team ? `${row.team} vs ${row.opponent || '—'}` : row.stat} · {row.stat}{showKickoff && kickoffText(row) ? ` · ${kickoffText(row)}` : ''}</small>
            </span>
          </span>
          <span className="pl-num">{sideLetter(row.side)}{sideLetter(row.side) ? ' ' : ''}{fmt(row.line)}</span>
          <span className="pl-num pl-proj">{fmt(row.projection)}</span>
          <span className="pl-num">
            {showHitRate && Number.isFinite(row.hitRate) ? `${Math.round(row.hitRate)}%` : (Number.isFinite(row.hitHits) && Number.isFinite(row.hitGames) ? `${row.hitHits}/${row.hitGames}` : '—')}
            {showHitRate && Number.isFinite(row.hitHits) && Number.isFinite(row.hitGames) ? <small>{row.hitHits}/{row.hitGames}</small> : null}
          </span>
          <span className="pl-num pl-score">{fmtScore(row.score)}</span>
        </div>
      ))}
    </div>
  );
}

function Phone({ rows, sport }) {
  return (
    <div className="pl-phone" aria-hidden="true">
      <div className="pl-phone-top"><i /><b>cgpropz</b><i /></div>
      {rows.slice(0, 6).map((row) => (
        <div className="pl-phone-row" key={`${row.player}|${row.stat}|${row.line}`}>
          <span className="pl-phone-id">
            <PlayerMark name={row.player} team={row.team} sport={sport} size={28} photo={false} />
            <span>
              <b>{row.player}</b>
              <small>{row.stat} · {sideLetter(row.side)}{sideLetter(row.side) ? ' ' : ''}{fmt(row.line)}</small>
            </span>
          </span>
          <em>{fmtScore(row.score)}</em>
        </div>
      ))}
      {!rows.length && <p className="pl-phone-empty">Board preview</p>}
    </div>
  );
}

export default function PublicLanding({ onGetStarted, onLogin, onOpenBoard, onSignOut, user }) {
  const menu = usePageMenu();
  const { requireAge } = useAgeGate();
  const [boards, setBoards] = useState({});
  const [markets, setMarkets] = useState(null);
  const [boardApi, setBoardApi] = useState(null);
  const [sportId, setSportId] = useState(HERO_LANDING_SPORT_ID);
  const [hitSportId, setHitSportId] = useState(HERO_LANDING_SPORT_ID);
  const [openFaq, setOpenFaq] = useState(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [lifetimeBusy, setLifetimeBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const started = new Set();
    let boardPromise = null;
    const loadBoard = () => {
      if (!boardPromise) {
        boardPromise = import('./publicBoard.js').then((mod) => {
          if (active) setBoardApi(mod);
          return mod;
        });
      }
      return boardPromise;
    };

    const loadDataset = (ds, dev, priority) => {
      if (!ds || started.has(ds)) return Promise.resolve(null);
      started.add(ds);
      return fetchApiDataset(ds, { devStaticPath: dev, priority });
    };

    const publish = async (sport, snap, lineupData) => {
      const mod = await loadBoard();
      if (!active || !snap) return;
      setBoards((prev) => ({
        ...prev,
        [sport.id]: {
          status: 'ready',
          rows: mod.rowsFromSnapshot(sport.id, snap.data, lineupData),
          updatedAt: snap.updatedAt,
          preview: !!snap.preview,
          lockedCount: Number(snap.lockedCount) || 0,
          hold: kboHoldMessage(sport.id, snap.data),
        },
      }));
    };

    const loadSport = async (sport, priority) => {
      let snap = null;
      try {
        snap = await loadDataset(sport.ds, sport.dev, priority);
      } catch {
        if (active) setBoards((prev) => ({ ...prev, [sport.id]: { status: 'error', rows: [], preview: false, lockedCount: 0 } }));
        return;
      }
      if (!snap) return;
      let lineupData = null;
      if (sport.lineups) {
        try {
          const lineupSnap = await loadDataset(sport.lineups, sport.lineupsDev, priority);
          lineupData = lineupSnap?.data ?? null;
        } catch { /* a missing injury report still shows the board */ }
      }
      await publish(sport, snap, lineupData);
    };

    // One /api/data call while the hero paints. Board code and every other
    // dataset wait until a data section is scrolled into view, or until a
    // gap after load so they are not part of the initial burst.
    const heroSnap = loadDataset(HERO_SPORT.ds, HERO_SPORT.dev, 'low').catch(() => 'error');

    const stop = whenVisibleOrIdle(['free-top-3', 'matchup', 'boards'], () => {
      heroSnap.then(async (snap) => {
        if (!active) return;
        if (snap === 'error') {
          setBoards((prev) => ({ ...prev, [HERO_SPORT.id]: { status: 'error', rows: [], preview: false, lockedCount: 0 } }));
          return;
        }
        let lineupData = null;
        if (HERO_SPORT.lineups) {
          try {
            const lineupSnap = await loadDataset(HERO_SPORT.lineups, HERO_SPORT.lineupsDev);
            lineupData = lineupSnap?.data ?? null;
          } catch { /* a missing injury report still shows the board */ }
        }
        publish(HERO_SPORT, snap, lineupData);
      });
      LANDING_SPORTS.forEach((sport) => {
        if (sport.id !== HERO_SPORT.id) loadSport(sport);
      });
      loadDataset('nfl_game_markets', 'nfl/game_markets.json')
        .then((snap) => { if (active && snap) setMarkets(snap); })
        .catch(() => { if (active) setMarkets({ data: { games: [] }, preview: false, lockedCount: 0 }); });
    });

    return () => {
      active = false;
      stop();
    };
  }, []);

  const sport = LANDING_SPORTS.find((item) => item.id === sportId) || LANDING_SPORTS[0];
  const hitSport = LANDING_SPORTS.find((item) => item.id === hitSportId) || LANDING_SPORTS[0];
  const sportState = boards[sport.id];
  const hitState = boards[hitSport.id];
  const switchRows = boardApi ? boardApi.publicSwitcherRows(sportState?.rows || []) : [];
  // free_top3_view: the free board preview with rows, scrolled into view.
  // Once per sport per page load (switching tabs counts the new sport).
  const freeBoardRef = useRef(null);
  const freeRowsShown = switchRows.length > 0;
  useEffect(() => {
    if (!freeRowsShown) return undefined;
    return observeVisibleOnce(freeBoardRef.current, () => trackFreeTop3View(sport.id));
  }, [freeRowsShown, sport.id]);
  const hitRows = boardApi ? boardApi.publicFreeTopRows(hitState?.rows || []) : [];
  const phoneRows = switchRows;
  const game = boardApi ? boardApi.featuredGame(markets?.data) : null;
  const gameRows = boardApi ? boardApi.rowsForGame(boards.nfl?.rows || [], game) : [];
  const dvpRows = (gameRows.length ? gameRows : (boardApi ? boardApi.publicSwitcherRows(boards.nfl?.rows || [], 4) : [])).filter((row) => row.oppRank != null);
  const settled = LANDING_SPORTS.every((item) => boards[item.id]);

  const scrollTo = (id) => {
    menu.close();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startWeekly = async () => {
    if (weeklyBusy) return;
    if (!(await requireAge())) return;
    trackCheckoutClick('weekly', sport.id);
    setWeeklyBusy(true);
    try {
      let token = '';
      if (user) {
        try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
      }
      const url = await requestWeeklyCheckoutUrl(token ? { token } : {});
      window.location.assign(url);
    } catch {
      window.location.assign(buildCheckoutUrl(STRIPE_LINKS.weekly, user || null));
    } finally {
      setWeeklyBusy(false);
    }
  };

  const buyLifetime = async () => {
    if (lifetimeBusy) return;
    if (!(await requireAge())) return;
    trackCheckoutClick('lifetime', sport.id);
    setLifetimeBusy(true);
    try {
      let token = '';
      if (user) {
        try { token = await sessionAccessToken() || ''; } catch { /* guest checkout still works */ }
      }
      const result = await requestOfferCheckoutUrl(token ? { plan: 'lifetime', token } : { plan: 'lifetime' });
      window.location.assign(result.url);
    } catch { /* button stays put; they can retry */ }
    finally { setLifetimeBusy(false); }
  };

  const chooseSport = (id) => {
    setSportId(id);
  };

  return (
    <div className="pl-landing" id="top">
      <div className="pl-glow" />
      <header className="pl-header" onClick={(event) => { if (event.target.closest('#cg-page-menu a, #cg-page-menu button')) menu.close(); }}>
        <a className="pl-wordmark" href="#top">cg<span>propz</span></a>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <PageMenu open={menu.open}>
          <nav className="pl-nav" aria-label="Page">
            <a href="#boards" onClick={(event) => { event.preventDefault(); scrollTo('boards'); }}>Boards</a>
            <a href="/nba-player-props">NBA</a>
            <a href="#matchup" onClick={(event) => { event.preventDefault(); scrollTo('matchup'); }}>Matchup sheets</a>
            <a href="#free-top-3" onClick={(event) => { event.preventDefault(); scrollTo('free-top-3'); }}>Results</a>
            <a href="#pricing" onClick={(event) => { event.preventDefault(); scrollTo('pricing'); }}>Pricing</a>
            <a href="#faq" onClick={(event) => { event.preventDefault(); scrollTo('faq'); }}>FAQ</a>
          </nav>
          <div className="pl-header-actions">
            {user ? (
              <button type="button" className="pl-text" onClick={onSignOut}>Sign out</button>
            ) : (
              <button type="button" className="pl-text" onClick={onLogin}>Log in</button>
            )}
            <button type="button" className="pl-cta pl-cta-small" onClick={() => scrollTo('pricing')}>Get the board</button>
          </div>
        </PageMenu>
      </header>

      <main className="pl-main">
        <section className="pl-hero">
          <div>
            <p className="pl-kick">KBO · NBA · NFL · NHL · WNBA</p>
            <h1>Every prop line, <span className="pl-grad">scored.</span></h1>
            <p className="pl-lead">CG Score rates every standard prop line with our projection, recent hit rates and defense vs position, on one board.</p>
            <div className="pl-cta-row">
              <button type="button" className="pl-cta" onClick={() => scrollTo('pricing')}>Get the board</button>
              <button type="button" className="pl-ghost" onClick={() => scrollTo('boards')}>See today's board</button>
            </div>
            <ul className="pl-trust">
              <li><i />Standard lines</li>
              <li><i />CG Score on every row</li>
              <li><i />One login, every league</li>
            </ul>
          </div>
          <Phone rows={phoneRows} sport={sport.id} />
        </section>

        <section id="free-top-3">
          <p className="pl-kick">Free preview</p>
          <h2>Today's free top 3</h2>
          <p className="pl-lead">The three standard lines with the highest CG Scores on each board. Pulled lines stay off this list.</p>
          <PlayableRecord sport={hitSport.id} />
          <div className="pl-seg" role="tablist" aria-label="Free top 3 sport">
            {LANDING_SPORTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === hitSport.id}
                className={item.id === hitSport.id ? 'on' : ''}
                onClick={() => setHitSportId(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="pl-card">
            {hitRows.length ? <BoardTable rows={hitRows} showHitRate showKickoff sport={hitSport.id} /> : (
              <p className="pl-empty">{freeTopEmptyText({ sportName: hitSport.name, settled: settled || !!hitState?.hold, hold: hitState?.hold })}</p>
            )}
            {hitState?.preview && hitState.lockedCount > 0 && (
              <p className="pl-foot">Public preview · {hitState.lockedCount} more {lineWord(hitState.lockedCount)} on All-Access</p>
            )}
          </div>
        </section>

        <section id="matchup">
          <p className="pl-kick">Matchup sheets</p>
          <h2>The whole game on one card</h2>
          <div className="pl-two">
            <div className="pl-card pl-match">
              {game ? (
                <>
                  <div className="pl-match-top">
                    <TeamMark team={game.awayTeam} name={game.awayName} />
                    <div>
                      <b>{game.awayName || game.awayTeam} vs {game.homeName || game.homeTeam}</b>
                      <small>{kickoffLabel(game)}</small>
                    </div>
                    <TeamMark team={game.homeTeam} name={game.homeName} />
                  </div>
                  <div className="pl-markets">
                    <Market label="Spread" {...boardApi.matchupMarketText(game).spread} />
                    <Market label="Total" {...boardApi.matchupMarketText(game).total} />
                  </div>
                  {gameRows.length ? <BoardTable rows={gameRows} sport="nfl" /> : (
                    <p className="pl-empty">Player props for this game are on the full board.</p>
                  )}
                </>
              ) : (
                <p className="pl-empty">
                  {!markets
                    ? 'Loading the game card…'
                    : (markets.preview && !NFL_FREE_PREVIEW_ENABLED && Number(markets.lockedCount) > 0
                      ? `NFL free preview is off. ${markets.lockedCount} game cards are on the full board.`
                      : 'No game card is posted right now.')}
                </p>
              )}
            </div>
            <div>
              <p className="pl-lead">CG model vs the posted number, defense vs position, snap and usage trends, and the injury report, ready before kickoff.</p>
              {dvpRows.length > 0 && (
                <div className="pl-card pl-dvp">
                  {dvpRows.map((row) => (
                    <div key={`${row.player}|${row.stat}`} className="pl-dvp-row">
                      <span><b>{row.player}</b><small>{row.stat}</small></span>
                      <span className="pl-dvp-bar" aria-hidden="true"><i style={{ width: `${Math.max(8, (Number(row.oppRank) / 32) * 100)}%` }} /></span>
                      <span className="pl-num">{ordinal(row.oppRank)}</span>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="pl-ghost" onClick={() => onOpenBoard?.('nfl')}>Open the NFL board</button>
            </div>
          </div>
        </section>

        <section id="boards">
          <p className="pl-kick">Leagues</p>
          <h2>Switch sports, keep the board</h2>
          <div className="pl-card pl-sw" ref={freeBoardRef}>
            <div className="pl-sw-top">
              <div className="pl-seg" role="tablist" aria-label="League">
                {LANDING_SPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={item.id === sport.id}
                    className={item.id === sport.id ? 'on' : ''}
                    onClick={() => chooseSport(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <p className="pl-sw-meta"><b>{sport.sportName}</b> · {boardApi ? boardApi.slateLabel(sportState?.rows || []) : 'Board'} · {sport.props}</p>
            </div>
            {switchRows.length ? <BoardTable rows={switchRows} sport={sport.id} /> : (
              <p className="pl-empty">
                {settled
                  ? (sport.id === 'nfl' && !NFL_FREE_PREVIEW_ENABLED && !sportState?.rows?.length
                    ? `NFL free preview is off.${sportState?.lockedCount ? ` ${sportState.lockedCount} ${lineClause(sportState.lockedCount)} on the full board.` : ''}`
                    : `No scored standard lines in the ${sport.name} public preview right now.`)
                  : 'Loading the board…'}
              </p>
            )}
            <div className="pl-foot">
              <span>Standard lines · CG Score is the board score</span>
              {sportState?.rows?.length > 0 && (
                <button type="button" className="pl-text" onClick={() => onOpenBoard?.(sport.id)}>Open {sport.name}</button>
              )}
            </div>
          </div>
          <div className="pl-tick">
            {LANDING_SPORTS.map((item) => (
              <button key={item.id} type="button" className={item.id === sport.id ? 'on' : ''} onClick={() => chooseSport(item.id)}>
                <i />{item.name} <em>{boardApi ? boardApi.slateLabel(boards[item.id]?.rows || []) : 'Board'}</em>
              </button>
            ))}
          </div>
        </section>

        <section id="pricing">
          <p className="pl-kick">Pricing</p>
          <h2>One login. Every league.</h2>
          <div className="pl-prices">
            <article className="pl-price is-on">
              <p className="pl-kick">Weekly</p>
              <p className="pl-amount">$4.99 <span>first week</span></p>
              <p className="pl-price-note">Then $9.99/week. Code XWEEK is applied at checkout when it is valid for this buyer.</p>
              <ul>
                <li>KBO, WNBA, NFL, NBA, and NHL boards</li>
                <li>CG Score on every standard line</li>
                <li>Hit rates and game logs</li>
                <li>Cancel anytime</li>
              </ul>
              <button type="button" className="pl-cta" disabled={weeklyBusy} onClick={startWeekly}>
                {weeklyBusy ? 'Opening checkout…' : 'Start weekly'}
              </button>
            </article>
            <article className="pl-price">
              <p className="pl-kick">Monthly</p>
              <p className="pl-amount">$29.99 <span>/ month</span></p>
              <p className="pl-price-note">Every board, billed monthly.</p>
              <ul>
                <li>Same boards as weekly</li>
                <li>Billed once a month</li>
                <li>Cancel anytime</li>
              </ul>
              <a className="pl-ghost" href={buildCheckoutUrl(STRIPE_LINKS.monthly, user || null)} onClick={() => trackCheckoutClick('monthly', sport.id)}>Get monthly</a>
            </article>
            <article className="pl-price">
              <p className="pl-kick">Lifetime</p>
              <p className="pl-amount">$249.99 <span>once</span></p>
              <p className="pl-price-note">Pay once. No renewal.</p>
              <ul>
                <li>Same boards as weekly</li>
                <li>One-time payment</li>
                <li>No renewal</li>
              </ul>
              <button type="button" className="pl-ghost" disabled={lifetimeBusy} onClick={buyLifetime}>
                {lifetimeBusy ? 'Opening checkout…' : 'Buy lifetime'}
              </button>
            </article>
          </div>
          <p className="pl-checkout-note">
            No account needed to check out. Afterwards, sign up with the same email you used at checkout and the plan unlocks.
            {!user && onGetStarted && (
              <> <button type="button" className="pl-text" onClick={onGetStarted}>Create an account</button></>
            )}
            {' '}<a href="/pricing">Yearly and account plans</a>
          </p>
          <DiscordOnlyPlans variant="public" user={user} />
        </section>

        <section id="faq">
          <p className="pl-kick">FAQ</p>
          <h2>Questions, answered</h2>
          <div className="pl-faq">
            {FAQS.map((item) => {
              const open = openFaq === item.q;
              return (
                <div key={item.q} className={open ? 'pl-faq-item is-open' : 'pl-faq-item'}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? null : item.q)}>
                    <span>{item.q}</span>
                    <span aria-hidden="true">{open ? '−' : '+'}</span>
                  </button>
                  {open && <p>{item.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="pl-close">
          <h2>Score tonight's board in seconds.</h2>
          <button type="button" className="pl-cta" onClick={() => scrollTo('pricing')}>Get the board</button>
        </section>
      </main>

      <footer className="pl-footer">
        <a className="pl-wordmark" href="#top">cg<span>propz</span></a>
        <p className="pl-footer-links">
          <a href="/guides/start-here">Start Here</a>
          <a href="/guides/cg-score">How CG Score works</a>
          <a href="/policies">Plans & Policies</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/responsible-gaming">Responsible Gaming</a>
          <a href="/states-not-available">Where CGPropz isn't available</a>
        </p>
        <p>{STANDARD_LINE}</p>
        <p>{OPERATOR_DISCLAIMER}</p>
        <p>© {new Date().getFullYear()} cgpropz</p>
        <DataCredit />
      </footer>
    </div>
  );
}

function TeamMark({ team, name }) {
  const src = teamLogoUrl(team);
  return src
    ? <img src={fitImage(src, 36)} alt={name || team} width="36" height="36" />
    : <span className="pl-avatar" aria-hidden="true">{playerInitials(name || team)}</span>;
}

function Market({ label, line, projection }) {
  return (
    <div>
      <span>{label}</span>
      <b className="pl-num">{line}</b>
      <small>CG {projection}</small>
    </div>
  );
}
