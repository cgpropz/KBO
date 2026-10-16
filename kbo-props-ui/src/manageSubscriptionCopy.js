export const NO_ACTIVE_PLAN_MESSAGE = 'No active plan on this email. DM @Cgpropz.';

export function noActivePlanNotice(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  if (!value) return NO_ACTIVE_PLAN_MESSAGE;
  return `${NO_ACTIVE_PLAN_MESSAGE}\nSigned in as ${value} — your plan may be under a different email.`;
}
