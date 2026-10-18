import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import './BoardLoadError.css';
import { sportAccess } from './entitlements';
import { useNbaOpen } from './useNbaOpen';
import { fetchApiDataset } from './apiData';
import { beginHubLoad, hubTokenForRetry, loadHubSports, loadMemberBoard, memberBoardPatch, nextSportRetry, sportRetryStillCurrent } from './memberBoardLoad';
import { boundedAccessToken, cachedAccessToken } from './supabaseClient';
import { fetchDataSnapshot } from './dataUrl';
import { fitImage } from './fitImage';
import { teamColor as nflTeamColor, teamLogoUrl as nflLogo } from './nfl/nflTeams';
import { teamColor as wnbaTeamColor } from './wnba/utils/formatters';
import { teamLogoUrl as nhlLogo, nhlHeadshotUrl } from './nhl/nhlTeams';
import { nbaLogoUrl } from './nba/nbaPropLines';
import Results from './Results';
import { barResult, hitRatePillColor } from './hitRateStrip';
import {
  countPlayable, hubGames, kboHubRows, nbaHubRows, nflHubRows, nhlHubRows,
  confirmedGoalieStarters, playableRows, sameMatchup, sideLetter, statusChips, topHitRateRows, topHubRows, unavailableFromLineups, wnbaHubRows,
  hubGamedayFor,
  scopeToGameday,
} from './memberHub';
import { readMemberSportChoice, rememberMemberSport, selectedHubSport } from './memberSport';
import './MemberCommandCenter.css';

/*
 * Paid-member landing, Option B Sports Hub.
 * Rows come from the same server-gated /api/data snapshots as the boards.
 * Held lines and OUT / IR / scratched players stay off. CG Score is the
 * board score, unchanged. The news panel is a slot for the market-signals
 * branch. Logged-out and free visitors never see this page.
 */

const KBO_LOGOS = {
  Doosan: 'doosan', Hanwha: 'hanwha', Lotte: 'lotte', Kia: 'kia', KIA: 'kia', Kiwoom: 'kiwoom',
  LG: 'lg', KT: 'kt', NC: 'nc', Samsung: 'samsung', SSG: 'ssg',
};
const kboLogo = (team) => (KBO_LOGOS[team] ? `/team-logos/${KBO_LOGOS[team]}.webp` : null);
const KBO_COLORS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5', Samsung: '#60a5fa', SSG: '#ff5555',
};

function inkOn(hex) {
  const n = Number.parseInt(String(hex || '').slice(1), 16);
  if (!Number.isFinite(n)) return '#fff';
  const y = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  return y > 160 ? '#111214' : '#fff';
}

function teamFill(sportId, team) {
  if (sportId === 'kbo') return KBO_COLORS[team] || '#3f3f46';
  if (sportId === 'nfl') return nflTeamColor(team);
  if (sportId === 'wnba') return wnbaTeamColor(String(team || '').toUpperCase());
  return '#3f3f46';
}

const ESPN_WNBA = {
  ATL: 'atl', CHI: 'chi', CON: 'conn', CONN: 'conn', DAL: 'dal', GS: 'gs', GSV: 'gs', IND: 'ind',
  LA: 'la', LAS: 'la', LV: 'lv', LVA: 'lv', MIN: 'min', NY: 'ny', NYL: 'ny', PHX: 'phx', PHO: 'phx',
  SEA: 'sea', WSH: 'wsh', WAS: 'wsh', TOR: 'tor', POR: 'por',
};
const wnbaLogo = (team) => {
  const slug = ESPN_WNBA[String(team || '').trim().toUpperCase()];
  return slug ? `https://a.espncdn.com/i/teamlogos/wnba/500/${slug}.png` : null;
};

const SPORTS = [
  { id: 'kbo', name: 'KBO', full: 'Korean Baseball', ds: 'prizepicks_props', dev: 'prizepicks_props.json', toRows: kboHubRows, logo: kboLogo },
  { id: 'wnba', name: 'WNBA', full: "Women's Basketball", ds: 'wnba_projections_standard', dev: 'wnba/projections_standard.json', toRows: wnbaHubRows, logo: wnbaLogo, roster: 'wnba_players', rosterDev: 'wnba/players.json', lineups: 'wnba_lineups', lineupsDev: 'wnba/lineups.json' },
  { id: 'nfl', name: 'NFL', full: 'Pro Football', ds: 'nfl_projections', dev: 'nfl/projections.json', toRows: nflHubRows, logo: nflLogo, lineups: 'nfl_lineups', lineupsDev: 'nfl/lineups.json' },
  { id: 'nhl', name: 'NHL', full: 'Pro Hockey', ds: 'nhl_projections', dev: 'nhl/projections.json', toRows: nhlHubRows, logo: nhlLogo, lineups: 'nhl_lineups', lineupsDev: 'nhl/lineups.json' },
  { id: 'nba', name: 'NBA', full: 'Pro Basketball', ds: 'nba_projections_standard', dev: 'nba/projections_standard.json', toRows: nbaHubRows, logo: nbaLogoUrl, roster: 'nba_players', rosterDev: 'nba/players.json' },
];

const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

function ordinal(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '—';
  const mod = n % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

function rowKey(row) {
  return `${row.player}|${row.stat}|${row.line}`;
}

function gameKey(game) {
  return [game.team, game.opponent].filter(Boolean).sort().join('|');
}

function parseWhen(start) {
  if (!start) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return new Date(`${start}T12:00:00Z`);
  const t = Date.parse(start);
  return Number.isFinite(t) ? new Date(t) : null;
}

function dayLabel(start, now = new Date()) {
  const format = (when, timeZone) => when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).replace(',', '');
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) return format(new Date(`${start}T12:00:00Z`), 'UTC');
  return format(parseWhen(start) || now, 'America/New_York');
}

function clockLabel(start) {
  if (!start || /^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const when = parseWhen(start);
  if (!when) return null;
  return `${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

function updatedLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return `${new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function useImageChain(urls) {
  const sources = [...new Set(urls.filter(Boolean))];
  const key = sources.join('|');
  const [state, setState] = useState({ key, idx: 0 });
  const idx = state.key === key ? state.idx : 0;
  const next = () => setState({ key, idx: idx + 1 });
  return { src: sources[idx] || null, next };
}

function headshotSources(row, cssPx) {
  const nhl = row.playerId ? nhlHeadshotUrl(row.playerId) : null;
  return [nhl && fitImage(nhl, cssPx), nhl, row.image && fitImage(row.image, cssPx), row.image];
}

function TeamLogo({ src, size = 16, className = 'hub-logo-img', title }) {
  const { src: url, next } = useImageChain(src ? [fitImage(src, size), src] : []);
  if (!url) return null;
  return <img className={className} src={url} alt="" title={title} width={size} height={size} loading="lazy" onError={next} />;
}

function Avatar({ row, sport, size = 48 }) {
  const { src, next } = useImageChain(headshotSources(row, size));
  const logo = sport ? sport.logo(row.team) : null;
  const fill = teamFill(sport?.id, row.team);
  return (
    <div className="hub-avatar-wrap" style={{ width: size, height: size }}>
      <div className={`hub-avatar${src ? '' : ' is-fallback'}`} style={src ? undefined : { background: fill, color: inkOn(fill) }} aria-hidden="true">
        {src ? <img src={src} alt="" width={size} height={size} loading="lazy" onError={next} /> : initials(row.player)}
      </div>
      {logo && <span className="hub-avatar-badge"><TeamLogo src={logo} size={16} className="" title={row.team} /></span>}
    </div>
  );
}

function Matchup({ row, sport }) {
  const when = clockLabel(row.start);
  return (
    <span className="hub-match">
      <TeamLogo src={sport.logo(row.team)} size={16} title={row.team} />
      <span>{row.team}</span>
      {row.opponent && (
        <>
          <span className="hub-vs">vs</span>
          <TeamLogo src={sport.logo(row.opponent)} size={16} title={row.opponent} />
          <span>{row.opponent}</span>
        </>
      )}
      {when && <span className="hub-when">{when}</span>}
    </span>
  );
}

function L10Chart({ values, line, side }) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  const target = Number(line);
  if (!nums.length || !Number.isFinite(target)) {
    return <p className="hub-chart-empty">No L10 game log on this line.</p>;
  }
  const max = Math.max(target, ...nums, 1);
  const linePct = Math.min(96, Math.max(4, (target / max) * 100));
  return (
    <div className="hub-chart" role="img" aria-label={`Last ${nums.length} games against a line of ${fmt(target)}`}>
      {nums.map((value, index) => {
        const kind = barResult(value, target, side);
        const color = kind === 'push' ? '#a1a1aa' : kind === 'hit' ? '#22c55e' : '#f87171';
        return (
          <span key={`${value}-${index}`} className="hub-bar-col">
            <span className="hub-bar" style={{ height: `${Math.max(8, (value / max) * 100)}%`, background: color }} />
          </span>
        );
      })}
      <span className="hub-chart-line" style={{ bottom: `${linePct}%` }}>
        <span className="hub-line-label hub-num">{sideLetter(side)}{sideLetter(side) ? ' ' : ''}{fmt(target)}</span>
      </span>
    </div>
  );
}

function useRecap() {
  const [recap, setRecap] = useState(null);
  useEffect(() => {
    fetchApiDataset('member_recap')
      .then((snap) => setRecap(snap?.preview ? {} : (snap?.data?.sports || {})))
      .catch(() => setRecap({}));
  }, []);
  return recap;
}

function useBoards(access, nbaOpen, selectedId, planPending, planFailed) {
  const [boards, setBoards] = useState({});
  const [photos, setPhotos] = useState(null);
  const [rosters, setRosters] = useState({});
  const [lineups, setLineups] = useState({});
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const accessRef = useRef(access);
  accessRef.current = access;
  const nbaOpenRef = useRef(nbaOpen);
  nbaOpenRef.current = nbaOpen;
  const generation = useRef(0);
  const loadSportRef = useRef(async () => {});
  const boardLoad = useRef({});
  const hubTokenRef = useRef(undefined);
  const retryTicket = useRef({});

  useEffect(() => {
    fetchDataSnapshot('player_photos.json').then((s) => setPhotos(s?.data || {})).catch(() => setPhotos({}));
  }, []);

  useEffect(() => {
    const gen = generation.current + 1;
    generation.current = gen;
    const alive = () => generation.current === gen;
    let slot = 0;
    const loadSport = async (sport) => {
      if (!alive()) return;
      const seq = (boardLoad.current[sport.id] || 0) + 1;
      boardLoad.current[sport.id] = seq;
      const mine = () => alive() && boardLoad.current[sport.id] === seq;
      const place = slot;
      slot += 1;
      const open = nbaOpenRef.current;
      if (planFailed) {
        setBoards((b) => ({ ...b, [sport.id]: { status: 'error', raw: null } }));
        return;
      }
      if (planPending) {
        setBoards((b) => ({ ...b, [sport.id]: { status: 'loading', raw: null } }));
        return;
      }
      const allowed = sport.id === 'nba' ? open === true : accessRef.current[sport.id];
      if (!allowed) {
        setBoards((b) => ({ ...b, [sport.id]: { status: sport.id === 'nba' && open !== true ? 'closed' : 'locked', raw: null } }));
        return;
      }
      const dataset = (ds, opts = {}) => fetchApiDataset(ds, {
        ...opts,
        ...(hubTokenRef.current ? { accessToken: hubTokenRef.current } : {}),
        fresh: false,
      });
      const writeBoard = (snap) => {
        if (!mine()) return;
        setBoards((b) => {
          const patch = memberBoardPatch(b[sport.id], snap);
          if (!patch) return b;
          return { ...b, [sport.id]: patch };
        });
      };
      const extras = [];
      if (sport.roster) {
        extras.push(
          dataset(sport.roster, { devStaticPath: sport.rosterDev })
            .then((snap) => { if (mine()) setRosters((r) => ({ ...r, [sport.id]: snap.data })); })
            .catch(() => {}),
        );
      }
      if (sport.lineups) {
        extras.push(
          dataset(sport.lineups, { devStaticPath: sport.lineupsDev })
            .then((snap) => { if (mine()) setLineups((s) => ({ ...s, [sport.id]: snap.data })); })
            .catch(() => { if (mine()) setLineups((s) => ({ ...s, [sport.id]: null })); }),
        );
      }
      const board = loadMemberBoard(sport, dataset, undefined, {
        slot: place,
        priority: place === 0 ? 'high' : undefined,
        alive: mine,
        onUnresolved: writeBoard,
      }).then((snap) => {
        writeBoard(snap);
      }).catch((err) => { writeBoard({ error: err }); });
      await Promise.all([board, ...extras]);
    };
    loadSportRef.current = loadSport;
    // One capped refresh for this hub load. A hang or a failed client
    // download still starts the sports. Background retries reuse the token.
    let stopped = false;
    beginHubLoad(
      (token) => {
        if (token) hubTokenRef.current = token;
        return loadHubSports(SPORTS, () => selectedRef.current, loadSport, alive);
      },
      () => boundedAccessToken({ fresh: true }),
      () => !stopped && alive(),
    );
    return () => {
      stopped = true;
      generation.current += 1;
      retryTicket.current = {};
    };
  }, [access.kbo, access.wnba, access.nfl, access.nhl, nbaOpen, planPending, planFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const retrySport = (id) => {
    const sport = SPORTS.find((item) => item.id === id);
    if (!sport) return;
    const started = nextSportRetry(retryTicket.current, id);
    retryTicket.current = started.tickets;
    const ticket = started.ticket;
    setBoards((b) => ({ ...b, [id]: { status: 'loading', raw: null } }));
    hubTokenForRetry(hubTokenRef.current, {
      cached: () => cachedAccessToken(),
      refresh: () => boundedAccessToken({ fresh: true }),
    }).then((token) => {
      if (!sportRetryStillCurrent(retryTicket.current, id, ticket)) return;
      hubTokenRef.current = token;
      loadSportRef.current(sport);
    });
  };

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const shaped = useMemo(() => {
    const out = {};
    SPORTS.forEach((sport) => {
      const b = boards[sport.id];
      if (!b) { out[sport.id] = { status: 'loading', rows: [], all: [], games: [], count: 0, lineups: [] }; return; }
      if (b.status !== 'ready') { out[sport.id] = { status: b.status, rows: [], all: [], games: [], count: 0, lineups: lineups[sport.id] || [] }; return; }
      const raw = sport.id === 'kbo' ? sport.toRows(b.raw, photos || {}) : sport.toRows(b.raw, rosters[sport.id]);
      const playable = playableRows(
        raw,
        unavailableFromLineups(sport.id, lineups[sport.id]),
        confirmedGoalieStarters(lineups[sport.id]),
      );
      // One slate for daily sports (NFL keeps its week): tomorrow's games stay off tonight's top 3, L10 and counts.
      const gameday = hubGamedayFor(sport.id, playable, now);
      const all = scopeToGameday(playable, gameday);
      const shown = countPlayable(all);
      out[sport.id] = {
        status: all.length ? 'ready' : 'empty',
        rows: topHubRows(all, 12),
        all,
        games: scopeToGameday(hubGames(sport.id, all, lineups[sport.id]), gameday),
        gameday,
        count: shown + (b.preview ? Number(b.lockedCount) || 0 : 0),
        updatedAt: b.updatedAt,
        lineups: lineups[sport.id] || [],
      };
    });
    return out;
  }, [boards, photos, rosters, lineups, now]);

  return { boards: shaped, retrySport };
}

function emptyCopy(status, sport) {
  if (status === 'loading') return 'Loading your member board…';
  if (status === 'locked') return `${sport.name} isn't in your plan. Add it from Manage plan.`;
  if (status === 'closed') return 'The NBA board opens soon. No lines are posted for members yet.';
  if (status === 'error') return 'Couldn\'t load your member board';
  return `No standard ${sport.name} lines on the board right now.`;
}

function sportStatus(sport, board, nbaOpen) {
  if (!board || board.status === 'loading') return 'Loading';
  if (board.status === 'locked') return 'Locked';
  if (board.status === 'closed' || (sport.id === 'nba' && !nbaOpen)) return 'Opens soon';
  if (board.status === 'error') return 'Couldn\'t load · Retry';
  if (board.status === 'empty' || !board.count) return 'No lines';
  const games = board.games?.length ? `${board.games.length} game${board.games.length === 1 ? '' : 's'}` : null;
  return games ? `${games} · ${board.count} props` : `${board.count} props`;
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="hub-icon">
      <path fill="currentColor" d="M12 22a2.4 2.4 0 0 0 2.35-1.9h-4.7A2.4 2.4 0 0 0 12 22Zm7-6.2V11a7 7 0 0 0-5-6.7V3.5a2 2 0 1 0-4 0v.8A7 7 0 0 0 5 11v4.8L3.3 17.5a1 1 0 0 0 .7 1.7h16a1 1 0 0 0 .7-1.7L19 15.8Z" />
    </svg>
  );
}

export default function MemberCommandCenter({ onEnterSport, onNavigate }) {
  const { user, tier, tierConfirmed, planCheckExhausted, retryPlanCheck, signOut } = useAuth();
  const planFailed = Boolean(user) && planCheckExhausted === true;
  const planPending = Boolean(user) && tierConfirmed !== true && !planFailed;
  const access = sportAccess(tier);
  const { open: nbaOpen } = useNbaOpen();
  const [picked, setPicked] = useState(() => (
    readMemberSportChoice(typeof localStorage === 'undefined' ? null : localStorage)
  ));
  const selected = SPORTS.find((s) => s.id === selectedHubSport(picked));
  const { boards, retrySport } = useBoards(access, nbaOpen, selected.id, planPending, planFailed);
  const retryHub = (id) => {
    if (planFailed) {
      retryPlanCheck();
      return;
    }
    retrySport(id);
  };
  const recap = useRecap();
  const [matchup, setMatchup] = useState('');
  const [focus, setFocus] = useState(null);
  const [panel, setPanel] = useState('today');
  const [bellOpen, setBellOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const pickSport = (id) => {
    setPicked(id);
    rememberMemberSport(typeof localStorage === 'undefined' ? null : localStorage, id);
    setPanel('today');
  };
  const [seenSport, setSeenSport] = useState(selected.id);
  if (seenSport !== selected.id) {
    setSeenSport(selected.id);
    setMatchup('');
    setFocus(null);
  }
  const state = boards[selected.id] || { status: 'loading', rows: [], all: [], games: [], count: 0, lineups: [] };

  const games = state.games || [];
  const activeGame = games.find((game) => gameKey(game) === matchup) || null;
  const pool = activeGame ? (state.all || []).filter((row) => sameMatchup(row, activeGame)) : (state.all || []);
  const ranked = topHubRows(pool, 7);
  const top = ranked.slice(0, 3);
  const preview = ranked.slice(3, 7);
  const hitLeaders = topHitRateRows(pool, 10);
  const active = [...top, ...preview, ...hitLeaders].find((row) => rowKey(row) === focus) || top[0] || null;
  const shownGames = activeGame ? [activeGame] : games;
  const timedStarts = shownGames
    .filter((game) => game.start && !/^\d{4}-\d{2}-\d{2}$/.test(game.start))
    .map((game) => parseWhen(game.start))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const firstStart = timedStarts[0] || null;
  const eyebrowWhen = shownGames.find((game) => game.start)?.start || firstStart?.toISOString() || null;
  const chips = statusChips({
    sport: selected.id,
    rows: state.all || [],
    lineups: state.lineups,
    recap: recap?.[selected.id],
    ready: state.status === 'ready' || state.status === 'empty',
  });

  const openSport = selected.id === 'nba' && !nbaOpen ? 'nfl' : selected.id;
  const openSlip = (mode) => {
    try { sessionStorage.setItem('cg_slip_mode', mode === 'auto' ? 'auto' : 'build'); } catch { /* ignore */ }
    onEnterSport(openSport, { view: 'slip' });
  };
  const openLog = (row) => {
    if (!row) return;
    if (selected.id === 'nhl') onEnterSport('nhl', { view: 'player', item: row.detail || row });
    else onEnterSport(selected.id, { view: 'player', player: row.player, prop: row.stat });
  };

  const userInitials = initials((user?.email || 'M').split('@')[0].replace(/[._-]+/g, ' ')) || 'M';
  const notices = [
    ...chips.map((chip) => chip.text),
    state.updatedAt ? `Board updated ${updatedLabel(state.updatedAt)}` : null,
  ].filter(Boolean);

  return (
    <div className="hub">
      <header className="hub-top">
        <button type="button" className="hub-brand" onClick={() => setPanel('today')}>cg<span>propz</span></button>
        <nav className="hub-nav" aria-label="Member">
          <button type="button" className={panel === 'today' ? 'is-active' : ''} onClick={() => setPanel('today')}>Today</button>
          <button type="button" onClick={() => onEnterSport(openSport, { view: 'board' })}>Boards</button>
          <button type="button" onClick={() => openSlip('build')}>Slip Builder</button>
          <button type="button" onClick={() => openSlip('auto')}>Optimizer</button>
          <button type="button" className={panel === 'results' ? 'is-active' : ''} onClick={() => setPanel('results')}>Results</button>
        </nav>
        <div className="hub-tools">
          <div className="hub-pop">
            <button type="button" className="hub-icon-btn" aria-label="Alerts" aria-expanded={bellOpen} onClick={() => { setBellOpen((v) => !v); setAccountOpen(false); }}>
              <BellIcon />
            </button>
            {bellOpen && (
              <div className="hub-menu" role="status">
                {notices.length ? notices.map((note) => <p key={note}>{note}</p>) : <p>No new alerts.</p>}
              </div>
            )}
          </div>
          <button type="button" className="hub-settings" onClick={() => onNavigate('pricing')}>Settings</button>
          <div className="hub-pop">
            <button type="button" className="hub-user" aria-label="Account" aria-expanded={accountOpen} onClick={() => { setAccountOpen((v) => !v); setBellOpen(false); }}>
              {userInitials}
            </button>
            {accountOpen && (
              <div className="hub-menu hub-menu-account">
                {user?.email && <p>{user.email}</p>}
                <button type="button" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="hub-sportbar">
        <div className="hub-pills" role="group" aria-label="Sports">
          {SPORTS.map((sport) => (
            <button
              key={sport.id}
              type="button"
              className={sport.id === selected.id ? 'is-active' : ''}
              aria-pressed={sport.id === selected.id}
              onClick={() => pickSport(sport.id)}
            >
              {sport.name}
            </button>
          ))}
        </div>
        <label className="hub-matchup-filter">
          <span>Matchup:</span>
          <select value={matchup} onChange={(event) => { setMatchup(event.target.value); setFocus(null); }} disabled={!games.length}>
            <option value="">{state.status === 'loading' ? 'Loading games…' : state.status === 'error' ? 'Couldn\'t load games' : games.length ? `All ${games.length} game${games.length === 1 ? '' : 's'}` : 'No games'}</option>
            {games.map((game) => (
              <option key={gameKey(game)} value={gameKey(game)}>
                {game.opponent ? `${game.team} vs ${game.opponent}` : game.team}
              </option>
            ))}
          </select>
        </label>
      </div>

      {panel === 'results' ? (
        <main className="hub-main">
          <Results />
        </main>
      ) : (
        <main className="hub-main">
          <div className="hub-heading">
            <p className="hub-eyebrow">{selected.name} · {dayLabel(eyebrowWhen)}</p>
            <div className="hub-title-row">
              {state.updatedAt && <p className="hub-updated">Board updated {updatedLabel(state.updatedAt)}</p>}
              <h1>Tonight&apos;s {selected.name} top 3</h1>
            </div>
            <p className="hub-slate">
              {state.status === 'loading' ? 'Loading games…' : state.status === 'error' ? 'Couldn\'t load your member board' : shownGames.length ? `${shownGames.length} game${shownGames.length === 1 ? '' : 's'}` : 'No games posted'}
              {firstStart && <> · First start {clockLabel(firstStart.toISOString())}</>}
            </p>
          </div>

          {chips.length > 0 && (
            <div className="hub-status" aria-label="Board status">
              {chips.map((chip) => chip.action === 'results' ? (
                <button key={chip.text} type="button" className={`hub-status-chip is-${chip.tone}`} onClick={() => setPanel('results')}>
                  {chip.prefix} <span className="hub-win">{chip.hits}</span>-<span className="hub-loss">{chip.misses}</span>{chip.pushes ? `-${chip.pushes}` : ''} → Results
                </button>
              ) : (
                <span key={chip.text} className={`hub-status-chip is-${chip.tone}`}>{chip.text}</span>
              ))}
            </div>
          )}

          <div className="hub-columns">
            <div className="hub-plays">
              {state.status === 'ready' && top.length > 0 ? top.map((row, index) => (
                <button
                  key={rowKey(row)}
                  type="button"
                  className={`hub-card ${active && rowKey(active) === rowKey(row) ? 'is-open' : ''}`}
                  onClick={() => setFocus(rowKey(row))}
                >
                  <span className="hub-rank hub-num">{index + 1}</span>
                  <Avatar row={row} sport={selected} size={52} />
                  <span className="hub-card-copy">
                    <span className="hub-name">{row.player}</span>
                    <Matchup row={row} sport={selected} />
                    <span className="hub-chips">
                      <span className="hub-mini">{sideLetter(row.side)}{sideLetter(row.side) ? ' ' : ''}{fmt(row.line)} {row.stat}</span>
                      {row.hitRate != null && <span className="hub-mini hub-num">L10 {Math.round(row.hitRate)}%</span>}
                      <span className="hub-mini is-status">{row.statusLabel || (row.side === 'UNDER' ? 'Under' : 'Over')}</span>
                    </span>
                  </span>
                  <span className="hub-score" aria-label={`CG Score ${Math.round(row.score)}`}>
                    <strong className="hub-num">{Math.round(row.score)}</strong>
                    <span>CG</span>
                  </span>
                </button>
              )) : (
                <section className="hub-card hub-card-empty">
                  <p>{state.status === 'loading' && <span className="board-spinner" aria-hidden="true" />}{emptyCopy(state.status, selected)}</p>
                  {state.status === 'error' && (
                    <button type="button" className="hub-retry" onClick={() => retryHub(selected.id)}>Retry</button>
                  )}
                </section>
              )}
            </div>

              <section className="hub-card hub-preview">
                <div className="hub-card-head">
                  <h2>Board preview</h2>
                  <a href="/guides/cg-score">What&apos;s in a CG Score</a>
                </div>
                {preview.length > 0 ? preview.map((row) => (
                  <button key={rowKey(row)} type="button" className="hub-preview-row" onClick={() => setFocus(rowKey(row))}>
                    <Avatar row={row} sport={selected} size={36} />
                    <span>
                      <span className="hub-name">{row.player}</span>
                      <span className="hub-preview-meta">{sideLetter(row.side)}{sideLetter(row.side) ? ' ' : ''}{fmt(row.line)} {row.stat}</span>
                    </span>
                    <span className="hub-num hub-preview-score">{Math.round(row.score)}</span>
                  </button>
                )) : null}
                {(selected.id !== 'nba' || nbaOpen) && state.status !== 'locked' && state.status !== 'closed' && (
                  <button type="button" className="hub-open" onClick={() => onEnterSport(selected.id, { view: 'board' })}>
                    Open full board ({state.count} props) →
                  </button>
                )}
              </section>

              <div className="hub-side">
              <section className="hub-card hub-drill" aria-label="Player drilldown">
                <div className="hub-card-head">
                  <h2>Player drilldown</h2>
                  {active && <span className="hub-mini">{active.player}</span>}
                </div>
                {active ? (
                  <>
                    <div className="hub-drill-player">
                      <Avatar row={active} sport={selected} size={56} />
                      <div>
                        <div className="hub-name">{active.player}</div>
                        <Matchup row={active} sport={selected} />
                      </div>
                    </div>
                    <L10Chart values={active.recent} line={active.line} side={active.side} />
                    <div className="hub-stats">
                      <div>
                        <span>L10</span>
                        <strong className="hub-num">{active.hitRate == null ? '—' : `${Math.round(active.hitRate)}%`}</strong>
                        {active.hitHits != null && active.hitGames != null && (
                          <span className="hub-hit-sample hub-num">{active.hitHits}/{active.hitGames}</span>
                        )}
                      </div>
                      {active.oppRank != null && <div><span>Opp rank</span><strong className="hub-num">{ordinal(active.oppRank)}</strong></div>}
                      <div><span>Projection</span><strong className="hub-num">{fmt(active.projection)}</strong></div>
                    </div>
                    <div className="hub-actions">
                      <button type="button" className="hub-primary" onClick={() => openSlip('build')}>Add to slip</button>
                      <button type="button" className="hub-ghost" onClick={() => openLog(active)}>Full game log</button>
                    </div>
                  </>
                ) : (
                  <p className="hub-chart-empty">Pick a play to see the last 10 games against the line.</p>
                )}
              </section>

              <section className="hub-card hub-hitrate" aria-label="Top 10 hit rate">
                <div className="hub-card-head">
                  <h2>Top 10 Hit Rate</h2>
                  <span className="hub-hit-kicker">L10</span>
                </div>
                {hitLeaders.length > 0 ? hitLeaders.map((row, index) => (
                  <button key={rowKey(row)} type="button" className={`hub-hit-row${active && rowKey(active) === rowKey(row) ? ' is-open' : ''}`} onClick={() => setFocus(rowKey(row))}>
                    <span className="hub-hit-rank hub-num">{index + 1}</span>
                    <span className="hub-hit-copy">
                      <span className="hub-name">{row.player}</span>
                      <span className="hub-preview-meta">{sideLetter(row.side)}{sideLetter(row.side) ? ' ' : ''}{fmt(row.line)} {row.stat}</span>
                    </span>
                    <span className="hub-hit-rate">
                      <strong className="hub-num" style={{ color: hitRatePillColor(row.hitRate) || undefined }}>{Math.round(row.hitRate)}%</strong>
                      <span className="hub-num">{row.hitHits}/{row.hitGames}</span>
                    </span>
                  </button>
                )) : (
                  <p className="hub-chart-empty">{state.status === 'error' ? emptyCopy(state.status, selected) : state.status === 'loading' ? 'Loading your member board…' : 'No L10 hit rates on this board.'}</p>
                )}
              </section>
              </div>

              <section className="mcc-panel mcc-news hub-news" aria-label="News">
                <h2>{selected.name} news</h2>
                <p className="mcc-empty">No news yet</p>
              </section>

              <section className="hub-card hub-others" aria-label="Other sports today">
                <div className="hub-card-head"><h2>Other sports today</h2></div>
                <div className="hub-tiles">
                  {SPORTS.map((sport) => (
                    <button
                      key={sport.id}
                      type="button"
                      className={`hub-tile ${sport.id === selected.id ? 'is-active' : ''} ${boards[sport.id]?.status === 'error' ? 'is-error' : ''}`}
                      onClick={() => {
                        pickSport(sport.id);
                        if (boards[sport.id]?.status === 'error') retryHub(sport.id);
                      }}
                    >
                      <strong>{sport.name}</strong>
                      <span>{sportStatus(sport, boards[sport.id], nbaOpen)}</span>
                    </button>
                  ))}
                </div>
              </section>
          </div>
        </main>
      )}

      <footer className="hub-footer">
        <div className="hub-brand">cg<span>propz</span></div>
        <p>21+ · Play responsibly · Entertainment only</p>
        <p><a href="tel:18004262537">1-800-GAMBLER</a></p>
        <p>Not affiliated with PrizePicks or Underdog</p>
        <nav className="hub-footer-links" aria-label="Footer">
          <button type="button" onClick={() => onNavigate('pricing')}>Settings</button>
          <span className="hub-footer-sep" aria-hidden="true">·</span>
          <button type="button" onClick={() => onNavigate('pricing')}>Discord &amp; integrations</button>
          <span className="hub-footer-sep" aria-hidden="true">·</span>
          <button type="button" onClick={() => onNavigate('pricing')}>Manage plan</button>
          <span className="hub-footer-sep" aria-hidden="true">·</span>
          <a href="/guides/start-here">Help</a>
        </nav>
      </footer>
    </div>
  );
}
