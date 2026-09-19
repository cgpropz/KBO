import { useAuth } from './AuthContext';
import { sportAccess } from './entitlements';
import './Paywall.css';

export default function Paywall({ children, onNavigate, sport = 'kbo' }) {
  const { tier, user } = useAuth();
  const access = sportAccess(tier, user?.email);
  const isPaid = sport === 'wnba' ? access.wnba : sport === 'nfl' ? access.nfl : access.kbo;

  if (isPaid) return children;

  const sportLabel = sport === 'wnba' ? 'WNBA' : sport === 'nfl' ? 'NFL' : 'KBO';
  const planLabel = sport === 'nfl' ? 'All Access plan' : `${sportLabel} plan`;

  return (
    <div className="pw-wrap">
      <div className="pw-blurred">{children}</div>
      <div className="pw-overlay">
        <div className="pw-card">
          <div className="pw-icon">🔒</div>
          <h2 className="pw-title">{sportLabel} Pro Feature</h2>
          <p className="pw-desc">
            Unlock full {sportLabel} projections, player prop cards, and every advanced tool.
            Grab the {planLabel} to access this board.
          </p>
          <button className="pw-cta" onClick={() => onNavigate('pricing')}>
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
}
