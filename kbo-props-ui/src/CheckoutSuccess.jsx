import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { cleanCheckoutParams, readCheckoutReturn, trackPurchaseOnce } from './tracking';
import './FreeFunnel.css';

const PLAN_LABELS = {
  weekly: 'Weekly All-Access',
  monthly: 'Monthly All-Access',
  lifetime: 'Lifetime All-Access',
};

async function lookupSession(sessionId) {
  const res = await fetch(`/api/checkout-session?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('application/json')) throw new Error(`lookup ${res.status}`);
  return res.json();
}

/*
 * Checkout-success screen. Stripe Payment Links redirect paying customers to
 * /?checkout=success&session_id={CHECKOUT_SESSION_ID}. We verify the session
 * server-side (api/checkout-session.js returns amount/currency/plan only), fire
 * the X purchase event once with conversion_id = session id, clean the URL and
 * welcome the customer, prompting log-in/sign-up if they are not signed in.
 */
export default function CheckoutSuccess({ onSignUp, onLogin }) {
  const { user, refreshTier } = useAuth();
  const [checkout] = useState(() => readCheckoutReturn());
  const [status, setStatus] = useState(checkout ? 'verifying' : 'idle'); // verifying | confirmed | unverified | closed
  const [details, setDetails] = useState(null);

  useEffect(() => {
    if (!checkout) return undefined;
    cleanCheckoutParams();
    if (!checkout.sessionId) {
      Promise.resolve().then(() => setStatus('unverified'));
      return undefined;
    }
    let active = true;
    const verify = async (attempt = 0) => {
      try {
        const info = await lookupSession(checkout.sessionId);
        if (!active) return;
        if (info?.paid) {
          trackPurchaseOnce({ sessionId: checkout.sessionId, value: info.amount, plan: info.plan });
          setDetails(info);
          setStatus('confirmed');
        } else {
          setStatus('unverified');
        }
      } catch {
        if (!active) return;
        if (attempt < 2) setTimeout(() => verify(attempt + 1), 1500 * (attempt + 1));
        else setStatus('unverified');
      }
    };
    verify();
    return () => { active = false; };
  }, [checkout]);

  // Signed-in buyers: re-check their tier a few times while the webhook lands
  // (fetchTier also self-heals from Stripe via /api/sync-subscription).
  useEffect(() => {
    if (!checkout || !user?.id) return undefined;
    const timers = [0, 4000, 12000].map((ms) => setTimeout(() => refreshTier?.(), ms));
    return () => timers.forEach(clearTimeout);
  }, [checkout, user?.id, refreshTier]);

  if (!checkout || status === 'idle' || status === 'closed') return null;

  const close = () => setStatus('closed');
  const planLabel = PLAN_LABELS[details?.plan] || 'All-Access';
  const price = details?.amount ? `$${Number(details.amount).toFixed(2)}` : null;

  return (
    <div className="ff-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-success-title">
      <div className="ff-modal">
        {status === 'verifying' ? (
          <>
            <div className="ff-modal-icon" aria-hidden="true">⏳</div>
            <h2 id="ff-success-title">Confirming your payment…</h2>
            <p>This only takes a second.</p>
          </>
        ) : (
          <>
            <div className="ff-modal-icon" aria-hidden="true">✅</div>
            <h2 id="ff-success-title">You're in. Welcome to CGPropz!</h2>
            {status === 'confirmed' ? (
              <p className="ff-modal-plan">{planLabel}{price ? ` · ${price}` : ''}</p>
            ) : (
              <p className="ff-modal-plan">Thanks for your purchase.</p>
            )}
            {user ? (
              <>
                <p>Your plan is unlocking now: KBO, WNBA and NFL boards, projections and tools.</p>
                <button className="ff-btn ff-btn-primary ff-btn-block" onClick={close}>Start browsing</button>
              </>
            ) : (
              <>
                <p>
                  One last step: <strong>create your account (or log in) with the same email you used at checkout</strong>.
                  Your plan unlocks automatically.
                </p>
                <button className="ff-btn ff-btn-primary ff-btn-block" onClick={() => { close(); onSignUp?.(); }}>Create my account</button>
                <button className="ff-btn ff-btn-ghost ff-btn-block" onClick={() => { close(); onLogin?.(); }}>I already have an account: log in</button>
              </>
            )}
            {status === 'unverified' && (
              <p className="ff-modal-note">
                We couldn't confirm the payment details yet. If your access hasn't unlocked in a few minutes, log in with your checkout email.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
