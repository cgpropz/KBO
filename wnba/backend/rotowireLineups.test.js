const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRotowireLineups } = require('./rotowireLineups');

// Allisha Gray is in the expected lineup as GTD and listed again under MAY NOT PLAY.
const DOUBLE_LISTED = `
<div class="lineup">
  <div class="lineup__meta"><div class="lineup__time">7:30 PM ET</div></div>
  <div class="lineup__matchup">
    <span class="lineup__mteam is-visit">Dream</span>
    <span class="lineup__mteam is-home">Aces</span>
  </div>
  <div class="lineup__box">
    <div class="lineup__team is-visit"><span class="lineup__abbr">ATL</span></div>
    <div class="lineup__team is-home"><span class="lineup__abbr">LVA</span></div>
    <ul class="lineup__list is-visit">
      <li class="lineup__player">
        <a title="Allisha Gray">A. Gray</a>
        <span class="lineup__pos">G</span>
        <span class="lineup__inj">GTD</span>
      </li>
      <li class="lineup__player">
        <a title="Rhyne Howard">Rhyne Howard</a>
        <span class="lineup__pos">G</span>
      </li>
      <li class="lineup__title is-middle">MAY NOT PLAY</li>
      <li class="lineup__player is-pct-play-50">
        <a title="Allisha Gray">Allisha Gray</a>
        <span class="lineup__pos">G</span>
        <span class="lineup__inj">GTD</span>
      </li>
      <li class="lineup__player is-pct-play-0">
        <a title="Tina Charles">Tina Charles</a>
        <span class="lineup__pos">F</span>
        <span class="lineup__inj">OUT</span>
      </li>
      <li class="lineup__player is-pct-play-50">
        <a title="Maya Caldwell">Maya Caldwell</a>
        <span class="lineup__pos">G</span>
        <span class="lineup__inj">GTD</span>
      </li>
    </ul>
    <ul class="lineup__list is-home">
      <li class="lineup__player">
        <a title="A'ja Wilson">A'ja Wilson</a>
        <span class="lineup__pos">F</span>
      </li>
    </ul>
  </div>
</div>
`;

test('a starter listed again under MAY NOT PLAY stays a starter with the GTD badge', () => {
  const [game] = parseRotowireLineups(DOUBLE_LISTED);
  const atlanta = game.visitor;
  assert.equal(atlanta.abbr, 'ATL');
  const gray = atlanta.players.filter((player) => player.name === 'Allisha Gray');
  assert.deepEqual(gray, [{ name: 'Allisha Gray', pos: 'G', status: 'gtd' }]);
  assert.equal(atlanta.inactive.some((player) => player.name === 'Allisha Gray'), false);
  assert.deepEqual(atlanta.inactive, [{ name: 'Tina Charles', pos: 'F', status: 'out' }]);
  assert.equal(atlanta.players.some((player) => player.name === 'Maya Caldwell'), false);
  assert.equal(atlanta.inactive.some((player) => player.name === 'Maya Caldwell'), false);
  assert.deepEqual(game.home.players.map((player) => player.name), ["A'ja Wilson"]);
  assert.deepEqual(game.home.inactive, []);
});
