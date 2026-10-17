const cheerio = require('cheerio');

function playerStatus(className, injuryText) {
  const injText = String(injuryText || '').trim().toUpperCase();
  if (injText === 'OUT') return 'out';
  if (injText === 'GTD') return 'gtd';
  if (injText === 'QUES' || injText === 'Q') return 'questionable';
  if (className.includes('is-pct-play-0')) return 'out';
  if (className.includes('is-pct-play-50')) return 'gtd';
  if (className.includes('is-pct-play-75')) return 'questionable';
  return 'expected';
}

// out is more cautious than gtd or questionable, and both of those are more
// cautious than a plain expected listing. Same title-name within a team merges
// to the more cautious status.
const STATUS_CAUTION = { out: 3, gtd: 2, questionable: 2, expected: 1 };

function moreCautious(current, next) {
  return (STATUS_CAUTION[next] || 0) > (STATUS_CAUTION[current] || 0) ? next : current;
}

function splitLineup(starters, mayNotPlay) {
  const byName = new Map();
  function add(player, listedAsStarter) {
    if (!player?.name) return;
    const prev = byName.get(player.name);
    if (!prev) {
      byName.set(player.name, { ...player, listedAsStarter });
      return;
    }
    byName.set(player.name, {
      name: player.name,
      pos: prev.pos || player.pos,
      status: moreCautious(prev.status, player.status),
      listedAsStarter: prev.listedAsStarter || listedAsStarter,
    });
  }
  for (const player of starters || []) add(player, true);
  for (const player of mayNotPlay || []) add(player, false);

  const mergedStarters = [];
  const inactive = [];
  for (const player of byName.values()) {
    const row = { name: player.name, pos: player.pos, status: player.status };
    if (player.status === 'out') {
      inactive.push(row);
      continue;
    }
    if (!player.listedAsStarter && (player.status === 'gtd' || player.status === 'questionable')) {
      inactive.push(row);
      continue;
    }
    if (player.listedAsStarter) mergedStarters.push(row);
  }
  return { starters: mergedStarters, inactive };
}

function parseRotowireLineups(html, normalizeTeamAbbr = (value) => String(value || '').trim().toUpperCase()) {
  const $ = cheerio.load(html);
  const games = [];

  $('.lineup').not('.is-tools').each((_, container) => {
    const $c = $(container);
    const $box = $c.find('.lineup__box').first();
    if (!$box.length) return;

    const gameTime = $c.find('.lineup__meta .lineup__time').first()
      .text().replace(/\s+/g, ' ').trim();

    function parseTeamMeta(sideClass) {
      const abbr = $box.find(`.lineup__team.${sideClass} .lineup__abbr`).text().trim();
      const name = $c.find(`.lineup__matchup .lineup__mteam.${sideClass}`).text().trim();
      const canonical = normalizeTeamAbbr(abbr) || abbr;
      return { abbr: canonical, rawAbbr: abbr, name };
    }

    const visitor = parseTeamMeta('is-visit');
    const home = parseTeamMeta('is-home');
    if (!visitor.abbr && !home.abbr) return;

    function parseList(sideClass) {
      const $list = $box.find(`.lineup__list.${sideClass}`);
      const starters = [];
      const mayNotPlay = [];
      let passedDivider = false;

      $list.children().each((_, el) => {
        const $el = $(el);
        const cls = ($el.attr('class') || '');

        if (cls.includes('lineup__title') && cls.includes('is-middle')) {
          passedDivider = true;
          return;
        }
        if (!cls.includes('lineup__player')) return;

        const name = $el.find('a').attr('title') || $el.find('a').text().trim();
        if (!name) return;

        const pos = $el.find('.lineup__pos').text().trim();
        const status = playerStatus(cls, $el.find('.lineup__inj').text());
        (passedDivider ? mayNotPlay : starters).push({ name, pos, status });
      });

      return splitLineup(starters, mayNotPlay);
    }

    const vis = parseList('is-visit');
    const hom = parseList('is-home');

    games.push({
      gameTime,
      visitor: { ...visitor, players: vis.starters, inactive: vis.inactive },
      home: { ...home, players: hom.starters, inactive: hom.inactive },
    });
  });

  return games;
}

module.exports = { parseRotowireLineups, splitLineup, playerStatus };
