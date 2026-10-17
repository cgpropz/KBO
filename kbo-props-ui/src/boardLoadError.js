export function isTierPending(error) {
  return !!error && typeof error === 'object' && error.code === 'tier_pending'
}

export function boardErrorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return error.message || 'Request failed'
}
