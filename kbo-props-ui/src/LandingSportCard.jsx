import { landingSportOpens } from './entitlements';
import './SportCardLock.css';

function LockIcon() {
  return (
    <svg className="sport-card-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function LandingSportCard({ variant, sport, nbaOpen, onOpen }) {
  const prefix = variant === 'hub' ? 'cg' : 'pl';
  const Heading = variant === 'hub' ? 'h2' : 'h3';
  const locked = sport.id === 'nba' && nbaOpen !== true;
  const open = () => {
    if (!landingSportOpens(sport.id, nbaOpen)) return;
    onOpen(sport.id);
  };

  return (
    <button
      type="button"
      className={`${prefix}-sport-card${locked ? ' is-locked' : ''}`}
      style={{ '--accent': sport.accent, '--glow': sport.glow }}
      aria-disabled={locked || undefined}
      aria-label={locked ? `${sport.name}, coming soon, locked` : undefined}
      data-sport={sport.id}
      data-nba-locked={sport.id === 'nba' ? String(locked) : undefined}
      onClick={open}
    >
      <div className={`${prefix}-sport-art`}>
        <img
          src={sport.portrait}
          alt={sport.portraitAlt}
          width="960"
          height="720"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className={`${prefix}-sport-body`}>
        <div className={`${prefix}-sport-head`}>
          <Heading className={`${prefix}-sport-name`}>{sport.name}</Heading>
          <span className={`${prefix}-sport-full`}>{sport.full}</span>
        </div>
        <p className={`${prefix}-sport-tagline`}>{sport.tagline}</p>
        <ul className={`${prefix}-sport-features`}>
          {sport.features.map((feature) => (
            <li key={feature}><span className={`${prefix}-dot`} />{feature}</li>
          ))}
        </ul>
        {variant === 'hub' && (
          <span className="cg-sport-enter">{locked ? 'Locked' : `Enter ${sport.name} →`}</span>
        )}
      </div>
      {locked && (
        <span className="sport-card-lock">
          <LockIcon />
          <span className="sport-card-lock-title">Coming soon</span>
          <span className="sport-card-lock-sub">Locked</span>
        </span>
      )}
    </button>
  );
}
