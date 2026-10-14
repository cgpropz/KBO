import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { sportAccess } from './entitlements';
import { useNbaOpen } from './useNbaOpen';
import { fetchApiDataset } from './apiData';
import { fetchDataSnapshot } from './dataUrl';
import { fitImage } from './fitImage';
import { teamLogoUrl as nflLogo } from './nfl/nflTeams';
import { teamLogoUrl as nhlLogo, nhlHeadshotUrl } from './nhl/nhlTeams';
import { nbaLogoUrl } from './nba/nbaPropLines';
import { ResponsibleGamblingCopy } from './SiteFooter';
import {
  countPlayable, formatRecord, kboHubRows, nbaHubRows, nflHubRows, nhlHubRows,
  playableRows, recapLabel, topHubRows, unavailableFromLineups, wnbaHubRows,
} from './memberHub';
import './MemberCommandCenter.css';

/*
 * Paid-member landing, Sports Hub: sport rail, today's games, top plays, news.
 * Every row comes from the same server-gated /api/data snapshots the boards
 * use, standard PrizePicks lines only. Held lines and OUT / IR / scratched
 * players stay off, using the lineup statuses the boards already publish.
 * The record strip reads /member-recap.json. The news panel is a slot for
 * the market-signals branch. Logged-out and free visitors never see this page.
 */

const KBO_LOGOS = {
  Doosan: 'doosan', Hanwha: 'hanwha', Lotte: 'lotte', Kia: 'kia', KIA: 'kia', Kiwoom: 'kiwoom',
  LG: 'lg', KT: 'kt', NC: 'nc', Samsung: 'samsung', SSG: 'ssg',
};
const kboLogo = (team) => (KBO_LOGOS[team] ? `/team-logos/${KBO_LOGOS[team]}.webp` : null);

// The WNBA board points at /logos/<team>.png, which is not shipped in this app,
// so use the same public ESPN logo CDN the NFL/NHL/NBA boards use.
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
  { id: 'nfl', name: 'NFL', full: 'Pro Football', ds: 'nfl_projections', dev: 'nfl/projections.json', toRows: nflHubRows, logo: nflLogo, lineups: 'nfl_lineups', lineupsDev: 'nfl/lineups.json' },
  { id: 'nhl', name: 'NHL', full: 'Pro Hockey', ds: 'nhl_projections', dev: 'nhl/projections.json', toRows: nhlHubRows, logo: nhlLogo, lineups: 'nhl_lineups', lineupsDev: 'nhl/lineups.json' },
  { id: 'wnba', name: 'WNBA', full: "Women's Basketball", ds: 'wnba_projections_standard', dev: 'wnba/projections_standard.json', toRows: wnbaHubRows, logo: wnbaLogo, roster: 'wnba_players', rosterDev: 'wnba/players.json', lineups: 'wnba_lineups', lineupsDev: 'wnba/lineups.json' },
  { id: 'nba', name: 'NBA', full: 'Pro Basketball', ds: 'nba_projections_standard', dev: 'nba/projections_standard.json', toRows: nbaHubRows, logo: nbaLogoUrl, roster: 'nba_players', rosterDev: 'nba/players.json' },
];

const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

function startLabel(start) {
  if (!start) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(start) ? `${start}T12:00:00Z` : start);
  if (!Number.isFinite(t)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return `${new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

// Tries each URL in turn (same-origin resized copy, then the original the
// boards use) and reports when none of them load.
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

function TeamLogo({ src, size = 16, className = 'mcc-team-logo', title }) {
  const { src: url, next } = useImageChain(src ? [fitImage(src, size), src] : []);
  if (!url) return null;
  return <img className={className} src={url} alt={title || ''} title={title} width={size} height={size} loading="lazy" onError={next} />;
}

function Avatar({ row, sport, size = 48, badge = true }) {
  const { src, next } = useImageChain(headshotSources(row, size));
  const logo = badge && sport ? sport.logo(row.team) : null;
  return (
    <div className="mcc-avatar-wrap" style={{ width: size, height: size }}>
      <div className="mcc-avatar" aria-hidden="true">
        {src ? <img src={src} alt="" width={size} height={size} loading="lazy" onError={next} /> : initials(row.player)}
      </div>
      {logo && <span className="mcc-avatar-badge"><TeamLogo src={logo} size={18} className="" title={row.team} /></span>}
    </div>
  );
}

function Matchup({ row, sport }) {
  return (
    <span className="mcc-matchup">
      <TeamLogo src={sport.logo(row.team)} size={18} title={row.team} />
      <span>{row.team}</span>
      {row.opponent && (
        <>
          <span className="mcc-vs">vs</span>
          <TeamLogo src={sport.logo(row.opponent)} size={18} title={row.opponent} />
          <span>{row.opponent}</span>
        </>
      )}
    </span>
  );
}

function PlayRow({ row, sport, onOpen }) {
  const when = startLabel(row.start);
  return (
    <button type="button" className={`mcc-row ${row.side === 'UNDER' ? 'is-under' : 'is-over'}`} onClick={() => onOpen(sport.id)}>
      <Avatar row={row} sport={sport} size={48} />
      <div className="mcc-row-main">
        <div className="mcc-row-name">{row.player}</div>
        <div className="mcc-row-meta">
          <Matchup row={row} sport={sport} />
          {when && <span>· {when}</span>}
        </div>
        <div className="mcc-row-line">
          <span className={`mcc-side ${row.side === 'UNDER' ? 'is-under' : ''}`}>{row.side === 'UNDER' ? 'U' : 'O'} {fmt(row.line)}</span>
          <span>{row.stat}</span>
          <span className="mcc-proj">Proj {fmt(row.projection)}</span>
        </div>
      </div>
      <div className="mcc-score" aria-label={`CG Score ${Math.round(row.score)}`}>
        <strong>{Math.round(row.score)}</strong>
        <span>CG</span>
      </div>
    </button>
  );
}

function slateGames(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (!row?.team) continue;
    const key = `${row.team}|${row.opponent || ''}`;
    if (!seen.has(key)) seen.set(key, { team: row.team, opponent: row.opponent || '', start: row.start || null });
  }
  return [...seen.values()];
}

function todayLabel(now = new Date()) {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
}

function useBoards(access, nbaOpen) {
  const [boards, setBoards] = useState({});
  const [photos, setPhotos] = useState(null);
  const [rosters, setRosters] = useState({});
  const [lineups, setLineups] = useState({});

  useEffect(() => {
    fetchDataSnapshot('player_photos.json').then((s) => setPhotos(s?.data || {})).catch(() => setPhotos({}));
  }, []);

  useEffect(() => {
    let alive = true;
    SPORTS.forEach((sport) => {
      const allowed = sport.id === 'nba' ? nbaOpen === true : access[sport.id];
      if (!allowed) {
        setBoards((b) => ({ ...b, [sport.id]: { status: sport.id === 'nba' && nbaOpen !== true ? 'closed' : 'locked', raw: null } }));
        return;
      }
      if (sport.roster) {
        fetchApiDataset(sport.roster, { devStaticPath: sport.rosterDev })
          .then((snap) => { if (alive) setRosters((r) => ({ ...r, [sport.id]: snap.data })); })
          .catch(() => {});
      }
      if (sport.lineups) {
        fetchApiDataset(sport.lineups, { devStaticPath: sport.lineupsDev })
          .then((snap) => { if (alive) setLineups((s) => ({ ...s, [sport.id]: snap.data })); })
          .catch(() => { if (alive) setLineups((s) => ({ ...s, [sport.id]: null })); });
      }
      fetchApiDataset(sport.ds, { devStaticPath: sport.dev })
        .then((snap) => {
          if (!alive) return;
          setBoards((b) => ({ ...b, [sport.id]: { status: 'ready', raw: snap.data, updatedAt: snap.updatedAt, preview: snap.preview } }));
        })
        .catch(() => { if (alive) setBoards((b) => ({ ...b, [sport.id]: { status: 'error', raw: null } })); });
    });
    return () => { alive = false; };
  }, [access.kbo, access.wnba, access.nfl, access.nhl, nbaOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const out = {};
    SPORTS.forEach((sport) => {
      const b = boards[sport.id];
      if (!b) { out[sport.id] = { status: 'loading', rows: [], count: 0 }; return; }
      if (b.status !== 'ready') { out[sport.id] = { status: b.status, rows: [], count: 0 }; return; }
      const raw = sport.id === 'kbo' ? sport.toRows(b.raw, photos || {}) : sport.toRows(b.raw, rosters[sport.id]);
      const all = playableRows(raw, unavailableFromLineups(sport.id, lineups[sport.id]));
      const rows = topHubRows(all, 5);
      out[sport.id] = {
        status: rows.length ? 'ready' : 'empty',
        rows,
        games: slateGames(all),
        count: countPlayable(all),
        updatedAt: b.updatedAt,
      };
    });
    return out;
  }, [boards, photos, rosters, lineups]);
}

function useRecap() {
  const [recap, setRecap] = useState(null);
  useEffect(() => {
    fetch(`/member-recap.json?v=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRecap(j?.sports || {}))
      .catch(() => setRecap({}));
  }, []);
  return recap;
}

function emptyCopy(status, sport) {
  if (status === 'loading') return 'Loading today\'s board…';
  if (status === 'locked') return `${sport.name} isn't in your plan. Add it from Manage plan.`;
  if (status === 'closed') return 'The NBA board opens soon. No lines are posted for members yet.';
  if (status === 'error') return `Couldn't load the ${sport.name} board. Open it directly or try again shortly.`;
  return `No standard ${sport.name} lines on the board right now. Check back when the next slate posts.`;
}

export default function MemberCommandCenter({ onEnterSport, onNavigate }) {
  const { user, tier, signOut } = useAuth();
  const access = sportAccess(tier);
  const { open: nbaOpen } = useNbaOpen();
  const boards = useBoards(access, nbaOpen);
  const recap = useRecap();
  const firstReady = SPORTS.find((s) => boards[s.id]?.status === 'ready');
  const [picked, setPicked] = useState(null);
  const selected = SPORTS.find((s) => s.id === picked) || firstReady || SPORTS[0];
  const state = boards[selected.id];
  const isAllAccess = access.kbo && access.wnba && access.nfl && access.nhl;

  const recapCells = SPORTS
    .filter((s) => recap?.[s.id])
    .map((s) => ({ sport: s, r: recap[s.id], label: recapLabel(recap[s.id].slate_date_iso) }))
    .sort((a, b) => b.r.slate_date_iso.localeCompare(a.r.slate_date_iso))
    .slice(0, 3);
  const topToday = SPORTS
    .flatMap((s) => (boards[s.id]?.rows || []).slice(0, 1).map((row) => ({ sport: s, row })))
    .sort((a, b) => b.row.score - a.row.score)[0];

  return (
    <div className="mcc">
      <header className="mcc-header">
        <div className="mcc-wordmark">cg<span>propz</span></div>
        <nav className="mcc-nav" aria-label="Member">
          <button type="button" className="is-active">Today</button>
          <button type="button" onClick={() => onEnterSport(selected.id === 'nba' && !nbaOpen ? 'kbo' : selected.id)}>Boards</button>
          <a href="/guides/cg-score">CG Score</a>
          <button type="button" onClick={() => onNavigate('pricing')}>Settings</button>
          {user && <button type="button" className="mcc-signout" onClick={signOut} title={user.email}>Sign out</button>}
        </nav>
      </header>

      <main className="mcc-main">
        <div className="hub-hero">
          <div>
            <div className="mcc-kicker">{isAllAccess ? 'All Access' : 'Member'} · Sports Hub</div>
            <h1>Today</h1>
            <p className="hub-date">{todayLabel()}</p>
          </div>
          <button type="button" className="hub-feature" onClick={() => topToday && onEnterSport(topToday.sport.id)} disabled={!topToday}>
            {topToday && <Avatar row={topToday.row} sport={topToday.sport} size={44} />}
            <div>
              <span>Top CG today</span>
              <strong>{topToday ? Math.round(topToday.row.score) : '—'}</strong>
              <small>{topToday ? `${topToday.row.player} · ${topToday.sport.name}` : 'Waiting on today\'s lines'}</small>
            </div>
          </button>
        </div>

        <div className="hub-rail" role="group" aria-label="Sports">
          {SPORTS.map((s) => {
            const b = boards[s.id];
            const record = recap?.[s.id] ? formatRecord(recap[s.id]) : null;
            const badge = b?.status === 'ready' ? `${b.count} lines`
              : b?.status === 'empty' ? 'No lines'
                : b?.status === 'locked' ? 'Locked'
                  : b?.status === 'closed' ? 'Soon'
                    : b?.status === 'error' ? 'Retry' : '…';
            return (
              <button key={s.id} type="button" className={`hub-sport ${s.id === selected.id ? 'is-active' : ''}`} onClick={() => setPicked(s.id)} aria-pressed={s.id === selected.id}>
                <span className="hub-sport-top">
                  <span className="hub-sport-name">{s.name}</span>
                  <span className="mcc-badge">{badge}</span>
                </span>
                <span className="hub-sport-full">{s.full}</span>
                <span className="hub-sport-foot">
                  {b?.rows?.length > 0 && (
                    <span className="mcc-sport-faces" aria-hidden="true">
                      {b.rows.slice(0, 3).map((row) => <Avatar key={row.player} row={row} size={26} badge={false} />)}
                    </span>
                  )}
                  <span className="hub-record">{record || (s.id === 'nba' && !nbaOpen ? 'Opens soon' : '—')}</span>
                </span>
              </button>
            );
          })}
        </div>

        <section className="mcc-strip" aria-label="Graded record">
          {recapCells.map(({ sport, r, label }) => (
            <div key={sport.id} className="mcc-strip-cell">
              <span>{label} · {sport.name}</span>
              <strong>{formatRecord(r)}</strong>
              <small>Standard lines graded (W-L{r.pushes ? '-P' : ''})</small>
            </div>
          ))}
          {recap && recapCells.length === 0 && (
            <div className="mcc-strip-cell"><span>Graded record</span><strong>—</strong><small>No graded slate yet</small></div>
          )}
        </section>

        {state?.games?.length > 0 && (
          <div className="hub-games" aria-label={`${selected.name} games`}>
            {state.games.map((game) => (
              <div key={`${game.team}-${game.opponent}`} className="hub-game">
                <TeamLogo src={selected.logo(game.team)} size={22} title={game.team} />
                <span>{game.team}</span>
                {game.opponent && (
                  <>
                    <span className="mcc-vs">vs</span>
                    <TeamLogo src={selected.logo(game.opponent)} size={22} title={game.opponent} />
                    <span>{game.opponent}</span>
                  </>
                )}
                {startLabel(game.start) && <span className="hub-game-time">{startLabel(game.start)}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="mcc-grid">
          <section className="mcc-panel mcc-plays" aria-label={`Top ${selected.name} plays`}>
            <div className="mcc-panel-head">
              <h2>Top plays · {selected.name}</h2>
              <span className="mcc-chip">Standard lines</span>
            </div>
            {state?.status === 'ready' ? (
              <div className="mcc-rows">
                {state.rows.map((row) => <PlayRow key={`${row.player}-${row.stat}`} row={row} sport={selected} onOpen={onEnterSport} />)}
              </div>
            ) : (
              <p className="mcc-empty">{emptyCopy(state?.status, selected)}</p>
            )}
            {(selected.id !== 'nba' || nbaOpen) && state?.status !== 'locked' && (
              <button type="button" className="mcc-open" onClick={() => onEnterSport(selected.id)}>Open full {selected.name} board →</button>
            )}
            <a className="mcc-explain" href="/guides/cg-score">What's in a CG Score?</a>
          </section>

          <section className="mcc-panel mcc-news" aria-label="News">
            <div className="mcc-panel-head">
              <h2>{selected.name} news</h2>
              <span className="mcc-chip is-placeholder">Placeholder</span>
            </div>
            <p className="mcc-empty">
              News isn't connected yet. cgpropz doesn't have a headline source today, so nothing here is real reporting.
              Injury and lineup notes still show on each sport's board.
            </p>
          </section>
        </div>
      </main>

      <footer className="mcc-footer">
        <div className="mcc-wordmark">cg<span>propz</span></div>
        <p className="mcc-rg">21+ · Play responsibly</p>
        <div className="site-footer"><ResponsibleGamblingCopy /></div>
        <div className="mcc-footer-links">
          <button type="button" onClick={() => onNavigate('pricing')}>Settings · Discord · Manage plan</button>
        </div>
      </footer>
    </div>
  );
}
