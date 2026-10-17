// Member dashboards and boards open on CG Score, highest first.
// A saved choice or an explicit ?sort= value wins when it is one of the
// options on that board.

export function boardSortStorageKey(sport) {
  return `cg_board_sort:${sport}`
}

export function explicitSortFromSearch(search) {
  const value = new URLSearchParams(search || '').get('sort')
  return value ? value : ''
}

export function readSavedBoardSort(storage, sport) {
  if (!storage || typeof storage.getItem !== 'function') return ''
  try {
    return storage.getItem(boardSortStorageKey(sport)) || ''
  } catch {
    return ''
  }
}

export function writeSavedBoardSort(storage, sport, sortBy) {
  if (!storage || typeof storage.setItem !== 'function') return
  if (!sortBy) return
  try { storage.setItem(boardSortStorageKey(sport), sortBy) } catch { /* ignore */ }
}

export function resolveBoardSort(options, { explicit = '', saved = '' } = {}) {
  const list = Array.isArray(options) ? options : []
  if (explicit && list.includes(explicit)) return explicit
  if (saved && list.includes(saved)) return saved
  if (list.includes('CG Score')) return 'CG Score'
  return list[0] || 'CG Score'
}

export function initialBoardSort(sport, options, { search, storage } = {}) {
  const liveSearch = search !== undefined
    ? search
    : (typeof window === 'undefined' ? '' : window.location.search)
  const liveStorage = storage !== undefined
    ? storage
    : (typeof localStorage === 'undefined' ? null : localStorage)
  return resolveBoardSort(options, {
    explicit: explicitSortFromSearch(liveSearch),
    saved: readSavedBoardSort(liveStorage, sport),
  })
}

export function rememberBoardSort(sport, sortBy, storage) {
  const live = storage !== undefined
    ? storage
    : (typeof localStorage === 'undefined' ? null : localStorage)
  writeSavedBoardSort(live, sport, sortBy)
}

export function withDefaultSort(filters, sport, options, env) {
  return { ...filters, sortBy: initialBoardSort(sport, options, env) }
}
