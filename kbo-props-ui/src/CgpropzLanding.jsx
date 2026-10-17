import { useAuth } from './AuthContext';
import { sportAccess } from './entitlements';
import MemberCommandCenter from './MemberCommandCenter';
import PublicLanding from './PublicLanding';

/*
 * Front door after login.
 * Paid members keep the Sports Hub. Free and Discord-only accounts see the
 * same public landing as logged-out visitors.
 *
 * Props:
 *   onEnterSport(sport)  → 'kbo' | 'wnba' | 'nfl' | 'nhl'
 *   onNavigate(view)     → e.g. 'pricing'
 */

export default function CgpropzLanding({ onEnterSport, onNavigate, initialPanel = 'today' }) {
  const { user, tier, signOut } = useAuth();
  const access = sportAccess(tier);
  const isPaid = access.kbo || access.wnba || access.nfl || access.nhl;

  if (isPaid) {
    return <MemberCommandCenter onEnterSport={onEnterSport} onNavigate={onNavigate} initialPanel={initialPanel} />;
  }

  return (
    <PublicLanding
      user={user}
      onOpenBoard={onEnterSport}
      onSignOut={signOut}
      onGetStarted={() => onNavigate('pricing')}
      onLogin={() => onNavigate('pricing')}
    />
  );
}
