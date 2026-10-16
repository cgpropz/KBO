import { authErrorMessage } from './authErrors.js';

// Path the recovery email returns to. Built from the page origin
// (window.location.origin), never from the Supabase Site URL.
export const SET_PASSWORD_PATH = '/set-password';

export function recoveryRedirectUrl(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${SET_PASSWORD_PATH}`;
}

export function isPasswordRecoveryLocation(search = '', hash = '', pathname = '') {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path === SET_PASSWORD_PATH) return true;
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
