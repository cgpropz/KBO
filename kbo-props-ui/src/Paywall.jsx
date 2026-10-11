import { useAuth } from './AuthContext';
import { sportAccess } from './entitlements';
import './Paywall.css';

// Static marketing screenshots only — never real, current paid data. Paid
// views are not rendered at all for users without access (the old version
// rendered the real tool under a CSS blur, which leaked the data to anyone
// who opened dev tools). The server also refuses to send full data to these
// users, see api/data.js.
const TEASER_IMAGE = {
  kbo: '/landing-screenshots/kbo-projections.png',
  wnba: '/landing-screenshots/wnba-edge-board.png',
  nfl: '/landing-screenshots/nfl-player-detail.png',
  nhl: '/sport-cards/nhl-card.webp',
};

const SPORT_LABEL = { wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', kbo: 'KBO' };

export default function Paywall({ children, onNavigate, sport = 'kbo', unlocked = false }) {
  const { tier } = useAuth();
  const access = sportAccess(tier);
  const entitled = sport === 'wnba' ? access.wnba : sport === 'nfl' ? access.nfl : sport === 'nhl' ? access.nhl : access.kbo;
  const isPaid = unlocked === true || entitled;
  const discordOnly = tier === 'discord';

  if (isPaid) return children;

  const sportLabel = SPORT_LABEL[sport] || 'KBO';
  const teaser = TEASER_IMAGE[sport] || TEASER_IMAGE.kbo;

  return (
    <div className="pw-wrap">
      <div className="pw-blurred pw-teaser" aria-hidden="true">
        <img src={teaser} alt="" loading="lazy" />
      </div>
      <div className="pw-overlay">
        <div className="pw-card">
          <div className="pw-icon">🔒</div>
          <h2 className="pw-title">{sportLabel} Pro Feature</h2>
          <p className="pw-desc">
            {discordOnly
              ? `Your Discord Only plan posts props in Discord. It does not include this ${sportLabel} board. Upgrade to All-Access for the full site.`
              : `Unlock full ${sportLabel} projections, player prop cards, and every advanced tool. Grab any All-Access plan (Weekly, Monthly, or Lifetime) to access this board.`}
          </p>
          <button className="pw-cta" onClick={() => onNavigate('pricing')}>
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
}
