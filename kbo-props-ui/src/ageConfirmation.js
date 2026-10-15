// 21+ confirmation remembered in this browser. Checkout URL building is
// untouched: this only decides whether a signup or Stripe navigation may proceed.

export const AGE_CONFIRMATION_KEY = 'cg_age_21_confirmed_at';

const STRIPE_CHECKOUT_HOSTS = new Set(['buy.stripe.com', 'checkout.stripe.com']);

function defaultStorage() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function readAgeConfirmation(storage = defaultStorage()) {
  try {
    const confirmedAt = String(storage?.getItem(AGE_CONFIRMATION_KEY) || '').trim();
    return confirmedAt ? { confirmedAt } : null;
  } catch {
    return null;
  }
}

export function isAgeConfirmed(storage = defaultStorage()) {
  return Boolean(readAgeConfirmation(storage));
}

export function rememberAgeConfirmation(storage = defaultStorage(), now = new Date()) {
  const confirmedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  storage?.setItem(AGE_CONFIRMATION_KEY, confirmedAt);
  return confirmedAt;
}

export function isStripeCheckoutHref(href) {
  try {
    const url = new URL(String(href || ''), 'https://www.cgpropz.com');
    return url.protocol === 'https:' && STRIPE_CHECKOUT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
