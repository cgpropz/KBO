import { authErrorMessage } from './authErrors.js';

// Query flag the reset email returns to. The hash `type=recovery` covers a
// link whose redirect allow-list falls back to the site origin.
export function recoveryRedirectUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/?recovery=1`;
}

export function isPasswordRecoveryLocation(search = '', hash = '') {
  const query = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (query.get('recovery') === '1' || query.get('type') === 'recovery') return true;
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return fragment.get('type') === 'recovery';
}

// Sets the password on the recovery session. Does not sign the user out;
// updateUser keeps the session that the recovery link created.
export async function applyNewPassword(supabase, password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, message: authErrorMessage(error), signedIn: false };
  }
  return {
    ok: true,
    message: "Password updated. You're signed in.",
    signedIn: true,
    user: data?.user ?? null,
  };
}
