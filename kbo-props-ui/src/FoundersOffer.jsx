import { useEffect, useState } from 'react';
import './FoundersOffer.css';
import {
  FOUNDERS_CAP,
  FOUNDERS_DEADLINE_LABEL,
  formatFoundersCountdown,
  foundersCountdown,
  foundersOfferState,
} from './foundersOffer';

function useFoundersOffer() {
  const [sold, setSold] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/subscriber-count')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const count = data?.founders?.sold;
        if (Number.isFinite(count)) setSold(count);
        else if (data?.founders?.reason === 'sold_out' || data?.founders?.reason === 'expired') {
          setSold(data.founders.reason === 'sold_out' ? FOUNDERS_CAP : 0);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const state = foundersOfferState({ now, sold: sold ?? 0 });
  const visible = sold == null ? now < state.deadlineMs : state.open;
  return {
    ...state,
    open: visible,
    soldKnown: sold != null,
    countdown: formatFoundersCountdown(foundersCountdown(now)),
  };
}

export default function FoundersOffer({ onClaim, busy = false }) {
  const offer = useFoundersOffer();
  if (!offer.open) return null;
  const spots = offer.soldKnown
    ? `${offer.spotsLeft} of ${offer.cap} spots left`
    : `Limited to ${FOUNDERS_CAP} buyers`;

  return (
    <div className="sub-founders">
      <div className="sub-founders-kicker">FOUNDERS PRICE</div>
      <div className="sub-founders-price">$99.99 <span>once</span></div>
      <p className="sub-founders-meta">
        {spots}. Ends {FOUNDERS_DEADLINE_LABEL}.
      </p>
      <p className="sub-founders-count" aria-label={`Time left: ${offer.countdown}`}>
        {offer.countdown}
      </p>
      <button
        type="button"
        className="founders-cta"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onClaim?.();
        }}
      >
        {busy ? 'Opening checkout…' : 'Claim Founders — $99.99'}
      </button>
    </div>
  );
}
