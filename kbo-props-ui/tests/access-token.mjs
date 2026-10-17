// HS256 access tokens for API unit tests. Production verifies the project's
// ES256 JWKS; these tests set SUPABASE_JWT_SECRET so the same helper accepts
// a local signature. Names that are not in the map are returned unchanged
// (forged tokens stay unsigned).
import { createHmac } from 'node:crypto';

export const TEST_JWT_SECRET = 'cgpropz-unit-test-jwt-secret';

const USERS = {
  'tok-free': { sub: 'u-free' },
  'tok-kbo': { sub: 'u-kbo', email: 'kbo@example.com' },
  'tok-owner': { sub: 'u-owner', email: 'CGPropz@gmail.com' },
  'tok-combined': { sub: 'u-comb' },
  'tok-noprofile': { sub: 'u-none' },
  'tok-fan': { sub: 'u-fan', email: 'fan@example.com' },
  'tok-weekly': { sub: 'u-weekly', email: 'weekly@example.com' },
  'tok-member': { sub: 'u-member', email: 'member@example.com' },
  'tok-monthly': { sub: 'u-monthly', email: 'monthly@example.com' },
  'tok-discord': { sub: 'u-discord', email: 'discord@example.com' },
  'tok-noemail': { sub: 'u-noemail' },
  tok: { sub: 'u-owner', email: 'owner@example.com' },
};

export function installJwtSecret() {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signAccessToken(claims = {}, secret = TEST_JWT_SECRET) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url(claims);
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function bearerFor(name, claims = {}) {
  if (!Object.hasOwn(USERS, name)) return name;
  const user = USERS[name];
  const base = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return signAccessToken({
    aud: 'authenticated',
    role: 'authenticated',
    sub: user.sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(user.email ? { email: user.email } : {}),
    ...(base ? { iss: `${base}/auth/v1` } : {}),
    ...claims,
  });
}
