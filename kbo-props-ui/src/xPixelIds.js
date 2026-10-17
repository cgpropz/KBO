// X (Twitter) Ads identifiers for the CGPropz ad account.
// Defaults are the live Events Manager ids (base pixel pul9k, event
// "Purchase Tracker"). Override at build time:
//   VITE_X_PIXEL_ID=pul9k
//   VITE_X_PURCHASE_EVENT_ID=tw-pul9k-pul9m
// An explicit empty value disables that piece (no base code, or no Purchase
// event). A missing variable keeps the default so the pixel that is already
// on the site does not go dark.

export const DEFAULT_X_PIXEL_ID = 'pul9k';
export const DEFAULT_X_PURCHASE_EVENT_ID = 'tw-pul9k-pul9m';

export function resolveXPixelId(value) {
  if (value == null) return DEFAULT_X_PIXEL_ID;
  return String(value).trim();
}

export function resolveXPurchaseEventId(value) {
  if (value == null) return DEFAULT_X_PURCHASE_EVENT_ID;
  return String(value).trim();
}

function envObject(env) {
  if (env && typeof env === 'object') return env;
  const proc = globalThis.process;
  return proc && proc.env ? proc.env : {};
}

export function pixelIdFromEnv(env) {
  const source = envObject(env);
  if (!Object.prototype.hasOwnProperty.call(source, 'VITE_X_PIXEL_ID')) return resolveXPixelId(undefined);
  return resolveXPixelId(source.VITE_X_PIXEL_ID);
}

export function purchaseEventIdFromEnv(env) {
  const source = envObject(env);
  if (!Object.prototype.hasOwnProperty.call(source, 'VITE_X_PURCHASE_EVENT_ID')) return resolveXPurchaseEventId(undefined);
  return resolveXPurchaseEventId(source.VITE_X_PURCHASE_EVENT_ID);
}

// Vite inlines import.meta.env. Node tests have no Vite env object.
export function readViteEnv(name) {
  try {
    const env = import.meta.env;
    if (!env || typeof env !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(env, name)) return undefined;
    return env[name];
  } catch {
    return undefined;
  }
}

export function activeXPixelId() {
  return resolveXPixelId(readViteEnv('VITE_X_PIXEL_ID'));
}

export function activeXPurchaseEventId() {
  return resolveXPurchaseEventId(readViteEnv('VITE_X_PURCHASE_EVENT_ID'));
}
