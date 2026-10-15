import { useCallback, useEffect, useRef, useState } from 'react';
import { AgeGateContext } from './ageGateContext.js';
import {
  isAgeConfirmed,
  isStripeCheckoutHref,
  readAgeConfirmation,
  rememberAgeConfirmation,
} from './ageConfirmation.js';
import { OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling.js';
import './AgeGate.css';

export function AgeGateProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState(() => readAgeConfirmation()?.confirmedAt || null);
  const waiters = useRef([]);

  const settle = useCallback((allowed) => {
    const pending = waiters.current;
    waiters.current = [];
    setOpen(false);
    setChecked(false);
    pending.forEach((resolve) => resolve(allowed));
  }, []);

  const requireAge = useCallback(() => {
    if (isAgeConfirmed()) return Promise.resolve(true);
    setChecked(false);
    setOpen(true);
    return new Promise((resolve) => {
      waiters.current.push(resolve);
    });
  }, []);

  useEffect(() => {
    const onClick = (event) => {
      if (isAgeConfirmed()) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || !isStripeCheckoutHref(anchor.href)) return;
      event.preventDefault();
      event.stopPropagation();
      const newTab = anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey;
      waiters.current.push((allowed) => {
        if (!allowed) return;
        // Read the href at confirm time so a weekly link can pick up the
        // XWEEK Checkout Session if it arrives while the gate is open.
        const href = anchor.href;
        if (!isStripeCheckoutHref(href)) return;
        if (newTab) {
          const opened = window.open(href, '_blank', 'noopener');
          if (!opened) window.location.assign(href);
          else window.dispatchEvent(new CustomEvent('cg-stripe-checkout'));
        } else {
          window.location.assign(href);
        }
      });
      setChecked(false);
      setOpen(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const confirm = () => {
    if (!checked) return;
    const savedAt = rememberAgeConfirmation();
    setConfirmedAt(savedAt);
    settle(true);
  };

  const value = {
    requireAge,
    confirmed: Boolean(confirmedAt),
    confirmedAt,
  };

  return (
    <AgeGateContext.Provider value={value}>
      {children}
      {open && (
        <div className="age-gate" role="presentation">
          <div
            className="age-gate-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="age-gate-title"
          >
            <p className="age-gate-kicker">Age check</p>
            <h2 id="age-gate-title">Confirm you are 21 or older</h2>
            <p>{OPERATOR_DISCLAIMER}</p>
            <p className="age-gate-standard">{STANDARD_LINE}</p>
            <label className="age-gate-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />
              <span>I confirm I am 21 or older.</span>
            </label>
            <p className="age-gate-links">
              <a href="/states-not-available">Where CGPropz is not available</a>
              <a href="/responsible-gaming">Responsible gaming</a>
            </p>
            <div className="age-gate-actions">
              <button type="button" className="age-gate-continue" disabled={!checked} onClick={confirm}>
                Continue
              </button>
              <button type="button" className="age-gate-dismiss" onClick={() => settle(false)}>
                Not now
              </button>
            </div>
            <p className="age-gate-note">This confirmation is saved in this browser.</p>
          </div>
        </div>
      )}
    </AgeGateContext.Provider>
  );
}
