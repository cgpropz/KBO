/* Shared top-level sport switcher (KBO ⚾ / WNBA 🏀). */
export default function SportSwitcher({ sport, setSport }) {
  return (
    <div className="sport-switcher">
      <button className={sport === 'kbo' ? 'active' : ''} onClick={() => setSport('kbo')}>⚾ KBO</button>
      <button className={sport === 'wnba' ? 'active' : ''} onClick={() => setSport('wnba')}>🏀 WNBA</button>
    </div>
  );
}
