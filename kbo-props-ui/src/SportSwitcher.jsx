import { useNbaOpen } from './useNbaOpen';

/* Shared top-level sport switcher. NBA appears only for full NBA access. */
export default function SportSwitcher({ sport, setSport }) {
  const { open: nbaOpen } = useNbaOpen();
  return (
    <div className="sport-switcher">
      <button className={sport === 'kbo' ? 'active' : ''} onClick={() => setSport('kbo')}>⚾ KBO</button>
      <button className={sport === 'wnba' ? 'active' : ''} onClick={() => setSport('wnba')}>🏀 WNBA</button>
      <button className={sport === 'nfl' ? 'active' : ''} onClick={() => setSport('nfl')}>🏈 NFL</button>
      {nbaOpen && (
        <button className={sport === 'nba' ? 'active' : ''} onClick={() => setSport('nba')}>🏀 NBA</button>
      )}
    </div>
  );
}
