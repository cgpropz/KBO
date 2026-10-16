import { useEffect, useState } from 'react';
import { fetchApiDataset } from './apiData';
import { useAgeGate } from './ageGateContext';
import { fitImage } from './fitImage';
import { formatPoints, kickoffLabel } from './nfl/gameCardModel';
import { teamLogoUrl } from './nfl/nflTeams';
import { STRIPE_LINKS } from './pricingTiers';
import { HERO_LANDING_SPORT_ID, LANDING_SPORTS } from './landingSports';
import { AFFILIATION_LINE, AGE_LINE, GAMBLER_HELP_URL, OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling';
import { sessionAccessToken } from './supabaseClient';
import { buildCheckoutUrl, requestOfferCheckoutUrl, requestWeeklyCheckoutUrl } from './tracking';
import { afterPaint, whenVisible } from './whenVisibleOrIdle';
import './PublicLanding.css';

const HERO_SPORT = LANDING_SPORTS.find((sport) => sport.id === HERO_LANDING_SPORT_ID) || LANDING_SPORTS[0];

const LEAGUES = [
  ['KBO', 'Korean baseball', 'Hits, runs, RBIs, strikeouts. Daily boards and cheat sheets.'],
  ['NFL', 'Football', 'Matchup sheets, DVP, snap and usage trends.'],
  ['NHL', 'Hockey', 'Shots, points, saves. Nightly boards and recaps.'],
  ['WNBA', 'Basketball', 'Points, boards, assists, PRA.'],
];

const FAQS = [
  ['What is CG Score?', 'Our model\'s rating for each prop: CG projection vs the PrizePicks line, plus recent hit rates and defense vs position. It\'s research, not a guarantee.'],
  ['Which leagues are covered?', 'KBO, NFL, NHL and WNBA, all under one All-Access login.'],
  ['What does XWEEK do?', 'First-time customers pay $4.99 for the first week, then $9.99/week. Cancel anytime.'],
  ['Is CGPropz affiliated with PrizePicks?', 'No. CGPropz is an independent data and analysis site. It is not a sportsbook and takes no wagers.'],
  ['Can I cancel anytime?', 'Yes. Access runs to the end of your billing period. Lifetime has nothing to cancel.'],
];

// Approved member quotes only. An empty list hides the reviews section.
const REVIEWS = [];

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value) {
  const n = finite(value);
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtScore(value) {
  const n = finite(value);
  if (n == null) return '';
  return n.toFixed(1);
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function ordinal(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '';
  const mod = n % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

function projTone(row) {
  const proj = finite(row?.projection);
  const line = finite(row?.line);
  if (proj == null || line == null) return '';
  const under = String(row?.side || '').toUpperCase() === 'UNDER';
  return (under ? proj < line : proj > line) ? 'v1-up' : 'v1-down';
}

function rowKey(row) {
  return `${row.player}|${row.stat}|${row.line}|${row.side || ''}`;
}

function Headshot({ row, size = 44 }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && row?.image ? fitImage(row.image, size) : '';
  if (!src) {
    return <span className="v1-hs v1-hs-fallback" style={{ width: size, height: size }} aria-hidden="true">{initials(row?.player)}</span>;
  }
  return (
    <img
      className="v1-hs"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      onError={() => setFailed(true)}
    />
  );
}

function Brand({ small = false, mark = false }) {
  const size = small ? 30 : 40;
  return (
    <span className="pl-wordmark v1-brand">
      {mark ? <img src="/favicon.svg" alt="" width={size} height={size} /> : null}
      cg<span>propz</span>
    </span>
  );
}

export default function PublicLanding({ onLogin, onSignOut, user }) {
  const { requireAge } = useAgeGate();
  const [boards, setBoards] = useState({});
  const [markets, setMarkets] = useState(null);
  const [boardApi, setBoardApi] = useState(null);
  const [league, setLeague] = useState(HERO_SPORT.name);
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

    // The featured sport loads while the hero paints, lineups included.
    // Its rows are the only ones on the phone. Every other board waits
    // until a data section is scrolled into view.
    const heroSnap = loadDataset(HERO_SPORT.ds, HERO_SPORT.dev, 'low').catch(() => 'error');
    heroSnap.then(async (snap) => {
      if (!active) return null;
      if (snap === 'error') {
        setBoards((prev) => ({ ...prev, [HERO_SPORT.id]: { status: 'error', rows: [], preview: false, lockedCount: 0 } }));
        return null;
      }
      let lineupData = null;
      if (HERO_SPORT.lineups) {
        try {
          const lineupSnap = await loadDataset(HERO_SPORT.lineups, HERO_SPORT.lineupsDev, 'low');
          lineupData = lineupSnap?.data ?? null;
        } catch { /* a missing injury report still shows the board */ }
      }
      return publish(HERO_SPORT, snap, lineupData);
    });

    const jobs = [
      ...LANDING_SPORTS.filter((sport) => sport.id !== HERO_SPORT.id).map((sport) => () => loadSport(sport)),
      () => loadDataset('nfl_game_markets', 'nfl/game_markets.json')
        .then((snap) => { if (active && snap) setMarkets(snap); })
        .catch(() => { if (active) setMarkets({ data: { games: [] }, preview: false, lockedCount: 0 }); }),
    ];

    const stop = whenVisible(['free-top-3', 'matchup', 'leagues'], () => {
      jobs.reduce((chain, job) => chain.then(() => (active ? job() : null)).then(() => afterPaint()), Promise.resolve());
    });

    return () => {
      active = false;
      stop();
    };
  }, []);

  const heroState = boards[HERO_SPORT.id];
  const allRows = LANDING_SPORTS.flatMap((sport) => boards[sport.id]?.rows || []);
  const phoneRows = boardApi ? boardApi.publicPhoneRows(heroState?.rows || []) : [];
  const hitRows = boardApi ? boardApi.publicTopL5Rows(allRows) : [];
  const game = boardApi ? boardApi.featuredGame(markets?.data) : null;
  const gameRows = boardApi ? boardApi.rowsForGame(boards.nfl?.rows || [], game) : [];
  const dvpRows = (gameRows.length ? gameRows : []).filter((row) => row.oppRank != null);
  const settled = LANDING_SPORTS.every((item) => boards[item.id]);
  const slate = boardApi ? boardApi.slateLabel(phoneRows) : '';
  const phoneTitle = slate && slate !== 'Board' ? `${HERO_SPORT.name} · ${slate}` : HERO_SPORT.name;
  const lockedPreview = hitRows.length
    ? LANDING_SPORTS.map((sport) => boards[sport.id]).find((state) => state?.preview && state.lockedCount > 0)
    : null;

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startWeekly = async () => {
    if (weeklyBusy) return;
    if (!(await requireAge())) return;
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

  return (
    <div className="pl-landing" id="top">
      <div className="v1-glow" />
      <header className="pl-header v1-nav">
        <a className="v1-brand-link" href="#top"><Brand mark /></a>
        <nav className="pl-nav v1-links" aria-label="Page">
          <a href="#free-top-3" onClick={(event) => { event.preventDefault(); scrollTo('free-top-3'); }}>Boards</a>
          <a href="#matchup" onClick={(event) => { event.preventDefault(); scrollTo('matchup'); }}>Matchup sheets</a>
          <a href="#free-top-3" onClick={(event) => { event.preventDefault(); scrollTo('free-top-3'); }}>Results</a>
          <a href="#pricing" onClick={(event) => { event.preventDefault(); scrollTo('pricing'); }}>Pricing</a>
          <a href="#faq" onClick={(event) => { event.preventDefault(); scrollTo('faq'); }}>FAQ</a>
        </nav>
        <button type="button" className="v1-btn v1-btn-sm" disabled={weeklyBusy} onClick={startWeekly}>
          {weeklyBusy ? 'Opening checkout…' : 'Start for $4.99'}
        </button>
      </header>

      <main className="pl-main">
        <section className="pl-hero v1-hero">
          <div>
            <p className="pl-kick v1-kick">KBO · NFL · NHL · WNBA</p>
            <h1>Every prop line, <span className="v1-grad">scored.</span></h1>
            <p className="pl-lead v1-lead">CG Score rates every standard prop line with our projection, recent hit rates and defense vs position, on one board.</p>
            <div className="v1-cta-row">
              <button type="button" className="v1-btn" disabled={weeklyBusy} onClick={startWeekly}>
                {weeklyBusy ? 'Opening checkout…' : 'Start for $4.99 with XWEEK'} →
              </button>
              <button type="button" className="v1-btn v1-btn-ghost" onClick={() => scrollTo('free-top-3')}>See today's board</button>
            </div>
            <p className="v1-offer">Code <b>XWEEK</b> · $4.99 first week, then $9.99/wk · cancel anytime</p>
            <div className="v1-trust">
              <div className="v1-trust-item">
                <b className="pl-num">{LANDING_SPORTS.length}</b>
                <span>Leagues covered</span>
              </div>
            </div>
          </div>
          <Phone rows={phoneRows} title={phoneTitle} ready={!!heroState} lockedCount={heroState?.preview ? heroState.lockedCount : 0} sportName={HERO_SPORT.name} />
        </section>

        <section id="free-top-3">
          <p className="pl-kick v1-kick">{hitRows.length >= 10 ? 'Top 10 tonight' : 'Hit rates'}</p>
          <h2>Highest hit rates on the board</h2>
          <p className="pl-lead v1-lead">Sorted by last-5 hit rate vs today's standard line.</p>
          <div className="v1-card v1-t10">
            {hitRows.length ? hitRows.map((row, index) => {
              const width = row.l5.games > 0 ? Math.round((row.l5.hits / row.l5.games) * 100) : 0;
              const who = [row.team, row.stat].filter(Boolean).join(' · ');
              return (
                <div className="v1-row" key={rowKey(row)}>
                  <span className="v1-rk">{index + 1}</span>
                  <Headshot row={row} />
                  <div>
                    <b>{row.player}</b>
                    {who ? <small>{who}</small> : null}
                  </div>
                  {fmt(row.line) ? <span className="v1-ln pl-num">Line {fmt(row.line)}</span> : <span />}
                  <div className="v1-hr pl-num">
                    L5 {row.l5.hits}/{row.l5.games}
                    {row.l10 ? ` · L10 ${row.l10.hits}/${row.l10.games}` : ''}
                    <div className="v1-bar" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
                  </div>
                </div>
              );
            }) : (
              <p className="v1-empty">{heroState ? (settled ? 'No last-5 sample on the public board right now.' : 'Loading the rest of the board…') : 'Loading the board…'}</p>
            )}
            {lockedPreview && (
              <p className="v1-note">Public preview · {lockedPreview.lockedCount} more lines on All-Access</p>
            )}
            {hitRows.length > 0 && (
              <p className="v1-note">Standard PrizePicks lines only · hit = cleared the line</p>
            )}
          </div>
        </section>

        <section id="matchup">
          <p className="pl-kick v1-kick">Matchup sheets</p>
          <h2>The whole game on one card</h2>
          <div className="v1-two">
            <div className="v1-card v1-match">
              {game ? (
                <>
                  <div className="v1-match-top">
                    <TeamMark team={game.awayTeam} name={game.awayName} />
                    <div>
                      <b>{game.awayName || game.awayTeam} vs {game.homeName || game.homeTeam}</b>
                      <small>{kickoffLabel(game)}</small>
                    </div>
                    <TeamMark team={game.homeTeam} name={game.homeName} />
                  </div>
                  <div className="v1-markets">
                    <Market label="Spread" line={game.spread?.line} projection={game.spread?.projection} />
                    <Market label="Total" line={game.total?.line} projection={game.total?.projection} />
                  </div>
                </>
              ) : (
                <p className="v1-empty">
                  {!markets
                    ? 'The game card loads with the board.'
                    : (markets.preview && Number(markets.lockedCount) > 0
                      ? `NFL free preview is off. ${markets.lockedCount} game cards are on the full board.`
                      : 'No game card is posted right now.')}
                </p>
              )}
            </div>
            <div>
              <p className="pl-lead v1-lead">CG model vs market, defense vs position, snap and usage trends and the injury report, ready before kickoff.</p>
              {dvpRows.length > 0 && (
                <div className="v1-card v1-dvp">
                  <b>Defense vs position</b>
                  {dvpRows.map((row) => (
                    <div className="v1-dvp-row" key={rowKey(row)}>
                      <b>{row.player}</b>
                      <span>{row.stat}</span>
                      <span className="v1-x pl-num">{ordinal(row.oppRank)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="leagues">
          <p className="pl-kick v1-kick">Leagues</p>
          <h2>Four leagues, one board</h2>
          <div className="v1-tabs" role="tablist" aria-label="League">
            {LEAGUES.map(([id]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === league}
                className={id === league ? 'v1-tab on' : 'v1-tab'}
                onClick={() => setLeague(id)}
              >
                {id}
              </button>
            ))}
          </div>
          <div className="v1-lg">
            {LEAGUES.map(([id, title, copy]) => (
              <div className={id === league ? 'v1-card v1-lg-card on' : 'v1-card v1-lg-card'} key={id}>
                <p className="pl-kick v1-kick">{id}</p>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing">
          <p className="pl-kick v1-kick">Pricing</p>
          <h2>One login. Every league.</h2>
          <div className="v1-prc">
            <article className="v1-pc v1-hot">
              <span className="v1-bd">FIRST WEEK $4.99</span>
              <h3>Weekly All-Access</h3>
              <p className="pl-amount v1-price">$4.99 <small>first week</small></p>
              <p className="v1-then">then $9.99 / week</p>
              <span className="v1-code">CODE: XWEEK</span>
              <ul>
                <li>KBO, NFL, NHL &amp; WNBA boards</li>
                <li>CG projections vs PrizePicks lines</li>
                <li>Hit rates, DVP &amp; matchup sheets</li>
              </ul>
              <button type="button" className="v1-btn" disabled={weeklyBusy} onClick={startWeekly}>
                {weeklyBusy ? 'Opening checkout…' : 'Start for $4.99'}
              </button>
            </article>
            <article className="v1-pc">
              <h3>Monthly All-Access</h3>
              <p className="pl-amount v1-price">$29.99 <small>/ month</small></p>
              <p className="v1-then">every sport, one login</p>
              <ul>
                <li>Everything in Weekly</li>
                <li>Slip builder &amp; prop tracker</li>
                <li>Cancel anytime</li>
              </ul>
              <a className="v1-btn v1-btn-ghost" href={buildCheckoutUrl(STRIPE_LINKS.monthly, user || null)}>Go monthly</a>
            </article>
            <article className="v1-pc">
              <h3>Lifetime All-Access</h3>
              <p className="pl-amount v1-price">$249.99 <small>once</small></p>
              <p className="v1-then">no renewals</p>
              <ul>
                <li>Everything in Monthly</li>
                <li>All future features</li>
                <li>One-time purchase</li>
              </ul>
              <button type="button" className="v1-btn v1-btn-ghost" disabled={lifetimeBusy} onClick={buyLifetime}>
                {lifetimeBusy ? 'Opening checkout…' : 'Get lifetime'}
              </button>
            </article>
          </div>
          <p className="v1-fine">
            XWEEK: first-time customers only, $4.99 for week one, then $9.99/week until canceled. No free trial. Entertainment only.
            {' '}<a href="/pricing">Prices on the pricing page</a>
          </p>
        </section>

        {REVIEWS.length > 0 && (
          <section id="reviews">
            <p className="pl-kick v1-kick">Reviews</p>
            <h2>What members say</h2>
            <div className="v1-rv">
              {REVIEWS.map((review) => (
                <div className="v1-rv-card" key={review.id}>
                  <p>{review.quote}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="faq">
          <p className="pl-kick v1-kick">FAQ</p>
          <h2>Questions, answered</h2>
          <div className="v1-faq">
            {FAQS.map(([q, a]) => (
              <div className="v1-q" key={q}>
                <b>{q}</b>
                <p>{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pl-close">
          <div className="v1-close">
            <p className="pl-kick v1-kick">Ready when the lines drop</p>
            <h2>Score tonight's board in seconds.</h2>
            <div className="v1-cta-row">
              <button type="button" className="v1-btn" disabled={weeklyBusy} onClick={startWeekly}>
                {weeklyBusy ? 'Opening checkout…' : 'Start for $4.99 with XWEEK'} →
              </button>
              <button type="button" className="v1-btn v1-btn-ghost" onClick={() => scrollTo('free-top-3')}>See today's board</button>
            </div>
            <p className="v1-offer">Code <b>XWEEK</b> · $4.99 first week, then $9.99/wk · cancel anytime</p>
          </div>
        </section>
      </main>

      <footer className="v1-footer">
        <div>
          <a className="v1-brand-link" href="#top"><Brand small /></a>
          <p>Independent data &amp; analysis. Not a sportsbook. Not affiliated with PrizePicks.</p>
          <p>{AFFILIATION_LINE}</p>
          <p className="v1-footer-links">
            <a href="/guides/start-here">Start Here</a>
            <a href="/guides/cg-score">How CG Score works</a>
            <a href="/policies">Plans &amp; Policies</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/responsible-gaming">Responsible Gaming</a>
            <a href="/states-not-available">Where CGPropz isn't available</a>
            {user ? (
              <button type="button" className="v1-text" onClick={onSignOut}>Sign out</button>
            ) : (
              <button type="button" className="v1-text" onClick={onLogin}>Log in</button>
            )}
          </p>
        </div>
        <div>
          <p className="v1-rg">{STANDARD_LINE}</p>
          <p>{OPERATOR_DISCLAIMER}</p>
          <p>{AGE_LINE}</p>
          <p><a href={GAMBLER_HELP_URL}>ncpgambling.org</a></p>
        </div>
      </footer>
    </div>
  );
}

function Phone({ rows, title, ready, lockedCount = 0, sportName = '' }) {
  const empty = !ready
    ? 'Loading the board…'
    : (lockedCount > 0
      ? `${sportName} free preview is off. ${lockedCount} lines are on the full board.`
      : 'No scored lines in this preview right now.');
  return (
    <div className="v1-phone">
      <div className="v1-scr">
        <div className="v1-notch" />
        <div className="v1-ab">
          <b>cg<span>propz</span></b>
          <span className="v1-ab-tag">{title}</span>
        </div>
        <div className="v1-cgt" role="table">
          <div className="v1-hd" role="row">
            <span>Player · prop</span>
            <span>Line</span>
            <span>Proj</span>
            <span>CG</span>
          </div>
          {rows.map((row) => (
            <div className="v1-cgt-row" role="row" key={rowKey(row)}>
              <div>
                <b>{row.player}</b>
                <small>{[row.team, row.stat].filter(Boolean).join(' · ')}</small>
              </div>
              <span className="pl-num v1-n">{fmt(row.line)}</span>
              <span className={`pl-num v1-n ${projTone(row)}`}>{fmt(row.projection)}</span>
              <span className="pl-num v1-cg">{fmtScore(row.score)}</span>
            </div>
          ))}
          {!rows.length && (
            <p className="v1-empty">{empty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamMark({ team, name }) {
  const src = teamLogoUrl(team);
  const fitted = src ? fitImage(src, 36) : '';
  if (!fitted) return <span className="v1-hs v1-hs-fallback" aria-hidden="true">{initials(name || team)}</span>;
  return <img className="v1-logo" src={fitted} alt={name || team || ''} width="36" height="36" loading="lazy" decoding="async" fetchPriority="low" />;
}

function Market({ label, line, projection }) {
  const lineN = finite(line);
  const projN = finite(projection);
  if (lineN == null && projN == null) return null;
  return (
    <div>
      <span>{label}</span>
      {lineN != null && <b className="pl-num">{formatPoints(lineN)}</b>}
      {projN != null && <small>CG {formatPoints(projN)}</small>}
    </div>
  );
}
