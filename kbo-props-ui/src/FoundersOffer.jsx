import { useEffect, useState } from 'react';
import './FoundersOffer.css';
import {
  FOUNDERS_CAP,
  formatFoundersCountdown,
  foundersCardCopy,
  foundersCountdown,
  foundersOfferState,
} from './foundersOffer';

function useFoundersOffer() {
  const [sold, setSold] = useState(null);
  const [serverReason, setServerReason] = useState(null);
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
        const founders = data?.founders;
        const count = founders?.sold;
        if (Number.isFinite(count)) setSold(count);
        else if (founders?.reason === 'sold_out') setSold(FOUNDERS_CAP);
        else if (founders?.reason === 'expired') setSold(0);
        if (founders?.reason === 'sold_out' || founders?.reason === 'expired') {
          setServerReason(founders.reason);
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
    serverReason,
    countdown: formatFoundersCountdown(foundersCountdown(now)),
  };
}

export default function FoundersOffer({ onClaim, busy = false, compact = false }) {
  const offer = useFoundersOffer();
  const [override, setOverride] = useState(null);
  const reason = override || offer.serverReason || (offer.open ? null : offer.reason);
  const copy = foundersCardCopy({
    spotsLeft: offer.spotsLeft,
    cap: offer.cap,
    soldKnown: offer.soldKnown,
    reason,
    compact,
  });

  const claim = async (event) => {
    event.stopPropagation();
    try {
      await onClaim?.();
    } catch (err) {
      if (err?.reason === 'sold_out' || err?.reason === 'expired') setOverride(err.reason);
    }
  };

  return (
    <div className="sub-founders">
      <div className="sub-founders-kicker">FOUNDERS PRICE</div>
      <div className="sub-founders-price">$99.99 <span>once</span></div>
      <p className="sub-founders-meta">{copy.meta}</p>
      {copy.showBuy ? (
        <>
          <p className="sub-founders-count" aria-label={`Time left: ${offer.countdown}`}>
            {offer.countdown}
          </p>
          <button
            type="button"
            className="founders-cta"
            disabled={busy}
            onClick={claim}
          >
            {busy ? 'Opening checkout…' : 'Claim Founders — $99.99'}
          </button>
        </>
      ) : (
        <p className="founders-closed" role="status">{copy.closedLabel}</p>
      )}
    </div>
  );
}
