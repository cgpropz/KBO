// Supabase Auth surfaces GoTrue rate limits as HTTP 429 and, for reset mail,
// the message "email rate limit exceeded". Callers show this sentence instead.
export const AUTH_RATE_LIMIT_MESSAGE = 'Too many requests, try again in a few minutes or DM @Cgpropz';

function rateLimitText(value) {
  return /email rate limit exceeded/i.test(String(value || ''));
}

export function authErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') {
    return rateLimitText(error) ? AUTH_RATE_LIMIT_MESSAGE : error;
  }
  const status = Number(error.status ?? error.statusCode);
  const message = String(error.message || error.msg || error.error_description || '');
  const code = String(error.code || error.error_code || '');
  if (status === 429 || rateLimitText(message) || code === 'over_email_send_rate_limit') {
    return AUTH_RATE_LIMIT_MESSAGE;
  }
  return message;
}
