import { useNbaOpen } from './useNbaOpen';

const SPORTS = [
  { id: 'kbo', icon: '⚾', label: 'KBO' },
  { id: 'wnba', icon: '🏀', label: 'WNBA' },
  { id: 'nfl', icon: '🏈', label: 'NFL' },
  { id: 'nhl', icon: '🏒', label: 'NHL' },
];

/* Shared top-level sport switcher. NBA appears only for full access. NHL is live. */
export default function SportSwitcher({ sport, setSport }) {
  const { open: nbaOpen } = useNbaOpen();
  const items = nbaOpen ? [...SPORTS, { id: 'nba', icon: '🏀', label: 'NBA' }] : SPORTS;
  return (
    <div className="sport-switcher" role="tablist" aria-label="Sport">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={sport === item.id}
          className={sport === item.id ? 'active' : ''}
          onClick={() => setSport(item.id)}
        >
          <span className="sport-switcher-icon" aria-hidden="true">{item.icon}</span>
          <span className="sport-switcher-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
