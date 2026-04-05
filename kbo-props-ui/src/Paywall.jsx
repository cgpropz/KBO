import { useAuth } from './AuthContext';
import './Paywall.css';

const OWNER_EMAILS = ['cgpropz@gmail.com', 'vicelocksx@gmail.com'];

export default function Paywall({ children, onNavigate }) {
  const { tier, user } = useAuth();
  const isOwner = user && OWNER_EMAILS.includes(user.email);
  const isPaid = isOwner || tier === 'owner' || tier === 'pro' || tier === 'monthly' || tier === 'weekly' || tier === 'season';

  if (isPaid) return children;

  return (
    <div className="pw-wrap">
      <div className="pw-blurred">{children}</div>
      <div className="pw-overlay">
        <div className="pw-card">
          <div className="pw-icon">🔒</div>
          <h2 className="pw-title">Pro Feature</h2>
          <p className="pw-desc">
            Upgrade to unlock full projections, player prop cards, slip builder, and all advanced tools.
          </p>
          <button className="pw-cta" onClick={() => onNavigate('pricing')}>
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
}
