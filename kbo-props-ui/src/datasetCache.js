// Session cache for /api/data responses. A filter or tab click should reuse
// the board already on screen. fresh and retried requests skip the read and
// replace the entry. Previews that are a paid-tier miss are not stored.

export const DATASET_CACHE_TTL_MS = 5 * 60 * 1000

export function datasetCacheKey(ds, { player = '', showAllLines = false } = {}) {
  return `${ds}\0${player || ''}\0${showAllLines ? 'all' : 'play'}`
}

export function createDatasetCache({ ttlMs = DATASET_CACHE_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map()
  return {
    read(key) {
      const hit = entries.get(key)
      if (!hit) return null
      if (now() - hit.at > ttlMs) {
        entries.delete(key)
        return null
      }
      return hit.value
    },
    write(key, value) {
      entries.set(key, { at: now(), value })
    },
    clear() {
      entries.clear()
    },
  }
}

export const datasetCache = createDatasetCache()
