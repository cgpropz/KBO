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

// Rotowire lists a GTD starter under Expected Lineup and again under MAY NOT
// PLAY. The second list is mayNotPlay. Names already in the starters stay
// starters, with the status from the expected lineup. Only players marked out
// who are not starters go to the out list.
function splitLineup(starters, mayNotPlay) {
  const starterNames = new Set(starters.map((player) => player.name));
  const inactive = mayNotPlay.filter((player) => player.status === 'out' && !starterNames.has(player.name));
  return { starters, inactive };
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
