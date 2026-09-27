import { useEffect, useState } from 'react';
import { SPORTS } from './sportsMeta';
import './TrustStrip.css';

// Real subscriber count + a "live now" sport row — shared trust signal for
// both landing surfaces. No fabricated ratings/review-platform badges.
export default function TrustStrip({ align = 'left' }) {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/subscriber-count')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && Number.isFinite(data?.count)) setCount(data.count);
      })
      .catch(() => {});
    return () => { cancelled = true };
  }, []);

  return (
    <div className={`trust-strip trust-strip-${align}`}>
      {count !== null && (
        <span className="trust-strip-count">
          <span className="trust-strip-dot" aria-hidden="true" />
          Trusted by <strong>{count.toLocaleString()}</strong> subscribers
        </span>
      )}
      <span className="trust-strip-live">
        <span className="trust-strip-live-label">Live now</span>
        {SPORTS.map((s) => (
          <span key={s.id} className="trust-strip-pill">{s.emoji} {s.name}</span>
        ))}
      </span>
    </div>
  );
}
