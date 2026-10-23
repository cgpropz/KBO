// Non-public preview switch for the player-page Splits / Advanced layouts.
// Off by default: nothing renders unless the URL carries ?insights=a|b|c
// (A = tabs next to Hit Rate, B = stacked sections, C = compact table).
// The choice sticks for the browser tab; ?insights=off clears it.

const KEY = 'cgpropz.insightsPreview'
export const INSIGHT_LAYOUTS = ['a', 'b', 'c']

export function readInsightsLayout(search, storage) {
  let stored = null
  try { stored = storage?.getItem(KEY) || null } catch { stored = null }
  const param = new URLSearchParams(search || '').get('insights')
  if (param != null) {
    const value = String(param).trim().toLowerCase()
    if (INSIGHT_LAYOUTS.includes(value)) {
      try { storage?.setItem(KEY, value) } catch { /* private mode */ }
      return value
    }
    try { storage?.removeItem(KEY) } catch { /* private mode */ }
    return null
  }
  return INSIGHT_LAYOUTS.includes(stored) ? stored : null
}

export function insightsLayout() {
  if (typeof window === 'undefined') return null
  let storage = null
  try { storage = window.sessionStorage } catch { storage = null }
  return readInsightsLayout(window.location?.search || '', storage)
}
