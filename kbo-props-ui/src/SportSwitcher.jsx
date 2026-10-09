import { useNbaOpen } from './useNbaOpen';
import { useNhlOpen } from './useNhlOpen';

/* Shared top-level sport switcher. NBA and NHL appear only for full access. */
export default function SportSwitcher({ sport, setSport }) {
  const { open: nbaOpen } = useNbaOpen();
  const { open: nhlOpen } = useNhlOpen();
  return (
    <div className="sport-switcher">
      <button className={sport === 'kbo' ? 'active' : ''} onClick={() => setSport('kbo')}>⚾ KBO</button>
      <button className={sport === 'wnba' ? 'active' : ''} onClick={() => setSport('wnba')}>🏀 WNBA</button>
      <button className={sport === 'nfl' ? 'active' : ''} onClick={() => setSport('nfl')}>🏈 NFL</button>
      {nbaOpen && (
        <button className={sport === 'nba' ? 'active' : ''} onClick={() => setSport('nba')}>🏀 NBA</button>
      )}
      {nhlOpen && (
        <button className={sport === 'nhl' ? 'active' : ''} onClick={() => setSport('nhl')}>🏒 NHL</button>
      )}
    </div>
  );
}
