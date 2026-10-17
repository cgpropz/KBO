// WNBA schedule helpers built on the ESPN scoreboard the backend already reads
// for spreads (site.api.espn.com/.../wnba/scoreboard?dates=YYYYMMDD).
//
// Two jobs, both pure so they can be tested without the network:
//   1. Drop PrizePicks props whose game is final, live, or past its start time,
//      the same rule pipeline/board_expiry.py applies to the NFL/NHL boards.
//   2. Give a lineup game a tip time from the schedule when the lineup feed has
//      none for the upcoming game. A time is only ever copied from a schedule
//      event; nothing is guessed.

const ET = 'America/New_York';

function etDate(value) {
  const moment = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toLocaleDateString('en-CA', { timeZone: ET });
}

function etTimeLabel(value) {
  const moment = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(moment.getTime())) return null;
  const label = moment.toLocaleTimeString('en-US', {
    timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${label} ET`;
}

function parseStart(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  // A start time with no zone is ambiguous; ignore it rather than guess.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
  const moment = new Date(text);
  return Number.isNaN(moment.getTime()) ? null : moment;
}

function espnDates(fromDate, days) {
  const out = [];
  const start = new Date(`${fromDate}T12:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}

// ESPN scoreboard payload -> [{ id, startTime, gameDate, state, completed, home, away }].
function parseScoreboard(payload, normalizeTeamAbbr = v => String(v || '').trim().toUpperCase()) {
  const events = [];
  for (const event of payload?.events || []) {
    const competition = event?.competitions?.[0] || {};
    const start = parseStart(event?.date || competition?.date);
    if (!start) continue;
    const statusType = event?.status?.type || competition?.status?.type || {};
    const teams = {};
    for (const competitor of competition.competitors || []) {
      const abbr = normalizeTeamAbbr(competitor?.team?.displayName)
        || normalizeTeamAbbr(competitor?.team?.abbreviation);
      if (abbr) teams[competitor.homeAway === 'home' ? 'home' : 'away'] = abbr;
    }
    if (!teams.home || !teams.away) continue;
    events.push({
      id: String(event.id || competition.id || ''),
      startTime: start.toISOString(),
      gameDate: etDate(start),
      state: String(statusType.state || '').toLowerCase() || null,
      completed: statusType.completed === true,
      home: teams.home,
      away: teams.away,
    });
  }
  return events;
}

function mergeEvents(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const event of list || []) {
      const key = event.id || `${event.away}@${event.home}|${event.startTime}`;
      byId.set(key, event);
    }
  }
  return [...byId.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function eventIsOver(event) {
  return event?.completed === true || event?.state === 'post';
}

function eventHasStarted(event, now = new Date()) {
  if (!event) return false;
  if (eventIsOver(event) || event.state === 'in') return true;
  const start = parseStart(event.startTime);
  return start != null && now.getTime() >= start.getTime();
}

function involves(event, team) {
  return !!team && (event.home === team || event.away === team);
}

// The schedule event for a prop: same ET game date, opponent in the game, and
// the player's team too when it is known.
function findPropEvent(prop, events, { team = null, normalizeTeamAbbr = v => v } = {}) {
  const gameDate = String(prop?.gameDate || '').slice(0, 10);
  const opponent = normalizeTeamAbbr(prop?.opponent) || null;
  if (!gameDate || !opponent) return null;
  const own = normalizeTeamAbbr(team) || null;
  return (events || []).find(event => (
    event.gameDate === gameDate
    && involves(event, opponent)
    && (!own || own === opponent || involves(event, own))
  )) || null;
}

// True when a prop's game is final, live, or past its start. Same order as
// board_expiry.game_has_started: explicit start, then schedule, then date.
function propHasStarted(prop, { events = [], team = null, now = new Date(), normalizeTeamAbbr } = {}) {
  if (!prop || typeof prop !== 'object') return false;
  const start = parseStart(prop.start_time || prop.startTime);
  if (start && now.getTime() >= start.getTime()) return true;
  const event = findPropEvent(prop, events, { team, normalizeTeamAbbr });
  if (event && eventHasStarted(event, now)) return true;
  const gameDate = String(prop.gameDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(gameDate) && gameDate < etDate(now)) return true;
  return false;
}

// Copy the schedule's start time onto a prop that has none, so the publish-time
// expiry (pipeline/board_expiry.py reads start_time) drops it at tip.
function withScheduleStart(prop, events, options = {}) {
  if (!prop || prop.start_time) return prop;
  const event = findPropEvent(prop, events, options);
  return event ? { ...prop, start_time: event.startTime } : prop;
}

// PrizePicks lines map (name -> { __allProps, statKey... }) without props whose
// game has started. A player left with no props is removed; stat shortcut keys
// for removed props are cleared. Returns { lines, dropped }.
function dropStartedLines(lines, {
  events = [], now = new Date(), teamByName = {}, statMap = {}, normalizeTeamAbbr,
} = {}) {
  const out = {};
  let dropped = 0;
  for (const [name, player] of Object.entries(lines || {})) {
    const props = Array.isArray(player?.__allProps) ? player.__allProps : [];
    const team = teamByName[name] || teamByName[String(name).toLowerCase()] || null;
    const options = { events, team, now, normalizeTeamAbbr };
    const kept = [];
    const removed = [];
    for (const prop of props) {
      if (propHasStarted(prop, options)) removed.push(prop);
      else kept.push(withScheduleStart(prop, events, options));
    }
    dropped += removed.length;
    if (props.length && !kept.length) continue;
    const next = { ...player, __allProps: kept };
    for (const prop of removed) {
      const key = statMap[prop?.stat];
      if (key && !kept.some(other => statMap[other?.stat] === key)) delete next[key];
    }
    out[name] = next;
  }
  return { lines: out, dropped };
}

// Projection rows (exported projections_*.json) without started props. Rows are
// kept (they carry gamelogs for player pages); only ppAllProps shrinks, and
// ppLines entries for removed stats are cleared. Returns { rows, dropped }.
function dropStartedProjectionProps(rows, {
  events = [], now = new Date(), statMap = {}, normalizeTeamAbbr,
} = {}) {
  let dropped = 0;
  const out = (rows || []).map(row => {
    const props = Array.isArray(row?.ppAllProps) ? row.ppAllProps : null;
    if (!props || !props.length) return row;
    const options = { events, team: row.team, now, normalizeTeamAbbr };
    const kept = [];
    const removed = [];
    for (const prop of props) {
      if (propHasStarted(prop, options)) removed.push(prop);
      else kept.push(withScheduleStart(prop, events, options));
    }
    if (!removed.length && kept.every((prop, i) => prop === props[i])) return row;
    dropped += removed.length;
    const next = { ...row, ppAllProps: kept };
    if (removed.length && row.ppLines && typeof row.ppLines === 'object') {
      const ppLines = { ...row.ppLines };
      for (const prop of removed) {
        const key = statMap[prop?.stat];
        if (key && !kept.some(other => statMap[other?.stat] === key)) ppLines[key] = null;
      }
      next.ppLines = ppLines;
    }
    return next;
  });
  return { rows: out, dropped };
}

function pairEvents(game, events) {
  const away = game?.visitor?.abbr;
  const home = game?.home?.abbr;
  if (!away || !home) return [];
  return (events || []).filter(event => (
    (event.away === away && event.home === home) || (event.away === home && event.home === away)
  ));
}

// Fill a lineup game's tip time from the schedule.
// - No gameTime in the feed: take the next not-final schedule game for the pair.
// - The feed's game is already final on the schedule (the listing is still the
//   last game): move the time to the next scheduled game for the pair and flag
//   that the listed players are from the finished game.
// - Otherwise keep the feed's time and add startTime/gameDate when one schedule
//   event matches it.
// With no matching schedule event the game is returned unchanged.
function attachScheduleTimes(games, events, now = new Date()) {
  return (games || []).map(game => {
    const matches = pairEvents(game, events);
    if (!matches.length) return game;
    const upcoming = matches.filter(event => !eventIsOver(event));
    const feedTime = String(game.gameTime || '').trim();
    const timeOf = event => ({
      gameTime: etTimeLabel(event.startTime),
      startTime: event.startTime,
      gameDate: event.gameDate,
    });

    if (!feedTime || /^(tbd|tba)$/i.test(feedTime)) {
      const next = upcoming[0];
      if (!next) return game;
      return { ...game, ...timeOf(next), gameTimeSource: 'schedule' };
    }

    const today = etDate(now);
    const listed = matches.find(event => (
      etTimeLabel(event.startTime) === feedTime && event.gameDate === today
    )) || matches.find(event => etTimeLabel(event.startTime) === feedTime);
    if (listed && eventIsOver(listed)) {
      const next = upcoming.find(event => event.startTime > listed.startTime);
      if (!next) return game;
      return {
        ...game,
        ...timeOf(next),
        gameTimeSource: 'schedule',
        listedGameTime: feedTime,
        listedGameDate: listed.gameDate,
        lineupFromFinishedGame: true,
      };
    }
    if (listed) {
      return { ...game, startTime: listed.startTime, gameDate: listed.gameDate, gameTimeSource: 'rotowire' };
    }
    return game;
  });
}

module.exports = {
  etDate,
  etTimeLabel,
  parseStart,
  espnDates,
  parseScoreboard,
  mergeEvents,
  eventIsOver,
  eventHasStarted,
  findPropEvent,
  propHasStarted,
  withScheduleStart,
  dropStartedLines,
  dropStartedProjectionProps,
  attachScheduleTimes,
};
