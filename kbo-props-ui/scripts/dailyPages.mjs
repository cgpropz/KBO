// Daily dated pages: /{sport}-player-props/YYYY-MM-DD (ET slate date).
//
// Source: one committed file per sport and day, content/daily/{sport}/{date}.json,
// exported from Board QA's qa_pick_ledger (see content/daily/README.md). The
// build never queries the database. A page is indexable only when the file is
// marked verified by Board QA and holds exactly three complete free props;
// otherwise it is noindex,follow and stays out of the sitemap. Past days stay
// up as results pages once the three props are graded.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { breadcrumbNode, escapeHtml, faqNode, pageUrl, renderDocument, SITE } from './seoShared.mjs';

export const DAILY_DIR = join(dirname(fileURLToPath(import.meta.url)), '../content/daily');

// Sports with a free top 3. NFL and NBA are left out on purpose: add a sport
// here only once its free top 3 is live and Board QA ledgers it.
export const DAILY_SPORTS = [
  { id: 'kbo', name: 'KBO', slug: 'kbo' },
  { id: 'nhl', name: 'NHL', slug: 'nhl' },
  { id: 'wnba', name: 'WNBA', slug: 'wnba' },
];

export const PROMO_LINE = 'First week $4.99 with code XWEEK (auto-fills at checkout), then $9.99/wk, cancel anytime.';
export const FOOTER_LINE = '21+ · Play responsibly · Entertainment only';
const RISK_LINE = 'Pick\'em contests carry financial risk, and no projection or score can promise a result. If you or someone you know has a gambling problem, call or text 1-800-GAMBLER. CGPropz is not affiliated with or endorsed by PrizePicks or Underdog.';
const CG_TEXT = 'CG Score compares the CGPropz projection with the posted line. The further the score is from 50, the bigger the gap between projection and line. Above 50 leans over, below 50 leans under. It isn\'t a win probability.';
const RESULTS = new Set(['Hit', 'Miss', 'Push', 'DNP', 'Void']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcNoon(date) {
  return new Date(`${date}T12:00:00Z`);
}

export function dateShort(date) {
  return utcNoon(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dateLong(date) {
  return utcNoon(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function etTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function kstDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' });
}

// ISO 8601 with the ET offset, for schema dates.
export function etIso(iso) {
  const d = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(parts.timeZoneName || '');
  const offset = m ? `${m[1].startsWith('-') ? '-' : '+'}${String(Math.abs(Number(m[1]))).padStart(2, '0')}:${m[2] || '00'}` : 'Z';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function shiftDate(date, days) {
  const d = utcNoon(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value) {
  const n = num(value);
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// A prop is complete when every ledger field the page prints is present.
export function propComplete(prop) {
  return !!(prop && prop.player && prop.team && prop.stat
    && num(prop.line) != null && (prop.side === 'Over' || prop.side === 'Under')
    && num(prop.projection) != null && num(prop.cg_score) != null
    && Number.isInteger(prop.l10_hits) && Number.isInteger(prop.l10_n) && prop.l10_n > 0
    && prop.ledger_id != null && prop.ledger_id !== ''
    && prop.line_type === 'standard');
}

// Only Board QA verifies a daily file (content/daily/README.md).
export const DAILY_VERIFIER = 'board-qa';

export function isIndexable(day) {
  return day?.verified === true
    && day.verified_by === DAILY_VERIFIER
    && Array.isArray(day.props) && day.props.length === 3
    && day.props.every(propComplete);
}

export function isGraded(day) {
  return Array.isArray(day?.props) && day.props.length === 3 && day.props.every((p) => RESULTS.has(p.result));
}

export function readDailyFiles(dir = DAILY_DIR) {
  const days = [];
  for (const sport of DAILY_SPORTS) {
    const sportDir = join(dir, sport.id);
    if (!existsSync(sportDir)) continue;
    for (const name of readdirSync(sportDir).sort()) {
      const date = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !DATE_RE.test(date)) continue;
      const day = JSON.parse(readFileSync(join(sportDir, name), 'utf8'));
      if (day.date && day.date !== date) throw new Error(`${sport.id}/${name}: date field ${day.date} does not match the file name`);
      days.push({ ...day, sport: sport.id, date });
    }
  }
  return days;
}

export function dailyPath(sportId, date) {
  return `/${sportId}-player-props/${date}`;
}

function faqAnswer(sport, day, free) {
  if (free.length === 3) {
    return `Today's free ${sport.name} top 3 is listed above: ${free[0].player}, ${free[1].player} and ${free[2].player}, each on a standard line with its CG Score and L10 hit rate.`;
  }
  return `Today's free ${sport.name} top 3 for ${dateShort(day.date)} has not been verified yet. The free top 3 is on the CGPropz homepage, and every standard line on the slate is on the full board with All-Access.`;
}

export function dailyFaqs(sport, day, free) {
  return [
    { q: `What are the free ${sport.name} player props today?`, a: faqAnswer(sport, day, free) },
    { q: 'What does CG Score mean?', a: CG_TEXT },
    { q: 'What does "7 of last 10" mean?', a: "The player cleared today's line on the listed side in 7 of their last 10 games. Ten games is a small sample, so read it with the projection, the matchup and the latest news." },
    { q: 'Do these lines match PrizePicks?', a: 'The lines shown are standard lines on the CGPropz board at the snapshot time. Lines change, so confirm the current line in your app before entering. CGPropz is not affiliated with PrizePicks or Underdog.' },
  ];
}

function gamesFor(props) {
  const seen = new Map();
  for (const p of props) {
    if (!p.start_time || !p.team || !p.opponent) continue;
    const key = [p.team, p.opponent].sort().join('|') + p.start_time;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

// SportsEvent nodes for the games behind the three free props only.
export function sportsEventNodes(sport, props) {
  return gamesFor(props).map((p) => ({
    '@type': 'SportsEvent',
    name: `${p.team} vs ${p.opponent}`,
    sport: sport.id === 'kbo' ? 'Baseball' : sport.id === 'nhl' ? 'Ice hockey' : 'Basketball',
    startDate: etIso(p.start_time),
    competitor: [
      { '@type': 'SportsTeam', name: p.team },
      { '@type': 'SportsTeam', name: p.opponent },
    ],
    ...(p.venue ? { location: { '@type': 'Place', name: p.venue } } : {}),
  }));
}

function propsTable(props) {
  const rows = props.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.player)}</td><td>${escapeHtml(p.team)}</td><td>${escapeHtml(p.stat)}</td><td>${escapeHtml(fmt(p.line))}</td><td>${escapeHtml(p.side)}</td><td>${escapeHtml(fmt(p.projection))}</td><td>${escapeHtml(fmt(p.cg_score))}</td><td>${p.l10_hits} of ${p.l10_n}</td></tr>`).join('');
  return `<div class="table-scroll"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Stat</th><th>Line</th><th>Side</th><th>Projection</th><th>CG Score</th><th>L10</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function resultsTable(props) {
  const rows = props.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.player)}</td><td>${escapeHtml(p.stat)}</td><td>${escapeHtml(fmt(p.line))}</td><td>${escapeHtml(p.side)}</td><td>${escapeHtml(p.result)}</td></tr>`).join('');
  return `<h2>Results</h2><div class="table-scroll"><table><thead><tr><th>#</th><th>Player</th><th>Stat</th><th>Line</th><th>Side</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderDailyPage(day, { existing = new Set() } = {}) {
  const sport = DAILY_SPORTS.find((s) => s.id === day.sport);
  if (!sport) throw new Error(`No daily pages for ${day.sport}`);
  const path = dailyPath(sport.id, day.date);
  const indexable = isIndexable(day);
  const free = indexable ? day.props : [];
  const short = dateShort(day.date);
  const title = `${sport.name} Player Props Today (${short}) | CGPropz`;
  const description = `${sport.name} player props today, ${short}: the free top 3 from the CGPropz board, with CG Score, projections and L10 hit rates, all on standard lines. 21+.`;
  const updated = day.date_modified || day.snapshot_time || `${day.date}T12:00:00Z`;
  const starts = (day.props || []).map((p) => p.start_time).filter(Boolean).sort();
  const games = Number.isInteger(day.slate_game_count) ? day.slate_game_count : null;
  const slate = games && starts.length
    ? `${games} ${sport.name} ${games === 1 ? 'game' : 'games'} on the slate for ${dateLong(day.date).replace(/, \d{4}$/, '')}, starting at ${etTime(starts[0])} ET${sport.id === 'kbo' ? ` (${kstDate(starts[0])} in Korea)` : ''}. `
    : '';
  const faqs = dailyFaqs(sport, day, free);
  const prev = shiftDate(day.date, -1);
  const next = shiftDate(day.date, 1);
  const links = [
    `<li><a href="${pageUrl(`/${sport.slug}-player-props`)}">${escapeHtml(sport.name)} player props hub</a></li>`,
    existing.has(dailyPath(sport.id, prev)) ? `<li><a href="${pageUrl(dailyPath(sport.id, prev))}">Previous day: ${escapeHtml(sport.name)} props for ${escapeHtml(dateShort(prev))}</a></li>` : '',
    existing.has(dailyPath(sport.id, next)) ? `<li><a href="${pageUrl(dailyPath(sport.id, next))}">Next day: ${escapeHtml(sport.name)} props for ${escapeHtml(dateShort(next))}</a></li>` : '',
    `<li><a href="${pageUrl('/guides/cg-score')}">How CG Score works</a></li>`,
    `<li><a href="${pageUrl('/guides/start-here')}">Start here: how to read player props</a></li>`,
    `<li><a href="${pageUrl('/pricing')}">All-Access pricing</a></li>`,
  ].filter(Boolean).join('');
  const topBlock = free.length === 3
    ? `<h2>Today's free ${escapeHtml(sport.name)} top 3</h2>
      <p>Chosen from the standard lines on the board, ranked by CG Score.</p>
      ${propsTable(free)}
      ${day.snapshot_time ? `<p>Board snapshot: ${escapeHtml(etTime(day.snapshot_time))} ET. All three are standard lines.</p>` : '<p>All three are standard lines.</p>'}
      <h3>How to read CG Score</h3>
      <p>${escapeHtml(CG_TEXT)} <a href="${pageUrl('/guides/cg-score')}">How CG Score works</a></p>
      <h2>Hit-rate notes</h2>
      <ul>${free.map((p) => `<li><strong>${escapeHtml(p.player)}:</strong> went ${escapeHtml(p.side)} ${escapeHtml(fmt(p.line))} in ${p.l10_hits} of the last ${p.l10_n} games.</li>`).join('')}</ul>
      <p>Ten games is a small sample. A role change, an injury to a teammate or a minutes limit can make older games a weak guide, so check the latest news before the game.</p>
      ${free.some((p) => p.dvp_note) ? `<h2>DvP notes</h2><ul>${free.filter((p) => p.dvp_note).map((p) => `<li><strong>${escapeHtml(p.player)}:</strong> ${escapeHtml(p.dvp_note)}</li>`).join('')}</ul><p>DvP shows how today's opponent has defended the player's position. Read it as matchup context alongside the score and the hit rate.</p>` : ''}
      ${isGraded(day) ? resultsTable(free) : ''}`
    : `<h2>Today's free ${escapeHtml(sport.name)} top 3</h2>
      <p>The free top 3 for ${escapeHtml(short)} has not been verified yet. See it on the <a href="${pageUrl('/')}#free-top-3">homepage</a> or <a href="${pageUrl(`/?sport=${sport.id}`)}">open the ${escapeHtml(sport.name)} board</a>.</p>`;
  const bodyHtml = `
      <p class="lede">${escapeHtml(sport.name)} · player props</p>
      <h1>${escapeHtml(sport.name)} Player Props Today — ${escapeHtml(dateLong(day.date))}</h1>
      <p><em>Updated ${escapeHtml(etTime(updated))} ET. Lines move, so check the current line in your app before entering.</em></p>
      <p>${escapeHtml(slate)}${free.length === 3 ? `Below is today's free ${escapeHtml(sport.name)} top 3 from the CGPropz board, each with its line, projection, CG Score and recent hit rate. ` : ''}Every standard line on the slate is on the full board with All-Access.</p>
      ${topBlock}
      <h2>Get the full ${escapeHtml(sport.name)} board</h2>
      <p>All-Access opens every standard line on today's ${escapeHtml(sport.name)} slate with projections, CG Scores, hit rates, DvP and the slip builder, plus every other CGPropz board under one login.</p>
      <p><strong>${escapeHtml(PROMO_LINE)}</strong></p>
      <div class="actions"><a class="btn btn-primary" href="${pageUrl('/pricing')}">Compare All-Access plans</a></div>
      <h2>More ${escapeHtml(sport.name)} props and guides</h2>
      <ul>${links}</ul>
      <h2>FAQ</h2>
      <div class="faq">${faqs.map((f) => `<h3>${escapeHtml(f.q)}</h3>\n<p>${escapeHtml(f.a)}</p>`).join('\n')}</div>
      <p class="rg"><strong>${escapeHtml(FOOTER_LINE)}</strong><br />${escapeHtml(RISK_LINE)}<br />${escapeHtml(PROMO_LINE)}</p>
    `;
  const html = renderDocument({
    title,
    description,
    path,
    bodyHtml,
    robots: indexable ? 'index,follow' : 'noindex,follow',
    schemas: [
      breadcrumbNode([
        { name: 'Home', url: pageUrl('/') },
        { name: `${sport.name} player props`, url: pageUrl(`/${sport.slug}-player-props`) },
        { name: short, url: pageUrl(path) },
      ]),
      faqNode(faqs),
      ...(indexable ? sportsEventNodes(sport, free) : []),
    ],
  });
  return {
    path,
    file: `${sport.slug}-player-props/${day.date}.html`,
    title,
    description,
    indexable,
    lastmod: String(updated).slice(0, 10),
    html,
  };
}

export function renderDailyPages(dir = DAILY_DIR) {
  const days = readDailyFiles(dir);
  const existing = new Set(days.map((d) => dailyPath(d.sport, d.date)));
  return days.map((day) => renderDailyPage(day, { existing }));
}

// Hub links: the most recent indexable days for a sport.
export function recentDailyLinks(sportId, pages, limit = 5) {
  const list = pages
    .filter((p) => p.indexable && p.path.startsWith(`/${sportId}-player-props/`))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, limit);
  if (!list.length) return '';
  return `<h2>Daily free top 3 pages</h2>\n<ul>${list.map((p) => `<li><a href="${pageUrl(p.path)}">${escapeHtml(p.title.replace(/ \| CGPropz$/, ''))}</a></li>`).join('')}</ul>`;
}

export { SITE };
