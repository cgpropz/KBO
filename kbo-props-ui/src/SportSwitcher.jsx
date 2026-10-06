import { useAuth } from './AuthContext';
import { canSeeNba } from './entitlements';

/* Shared top-level sport switcher. NBA stays hidden until the owner email. */
export default function SportSwitcher({ sport, setSport }) {
  const { user } = useAuth();
  return (
    <div className="sport-switcher">
      <button className={sport === 'kbo' ? 'active' : ''} onClick={() => setSport('kbo')}>⚾ KBO</button>
      <button className={sport === 'wnba' ? 'active' : ''} onClick={() => setSport('wnba')}>🏀 WNBA</button>
      <button className={sport === 'nfl' ? 'active' : ''} onClick={() => setSport('nfl')}>🏈 NFL</button>
      {canSeeNba(user) && (
        <button className={sport === 'nba' ? 'active' : ''} onClick={() => setSport('nba')}>🏀 NBA</button>
      )}
    </div>
  );
}
