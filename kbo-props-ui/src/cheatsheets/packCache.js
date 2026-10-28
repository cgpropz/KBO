// Cheatsheet sport tabs reuse a pack that already loaded. The sheet is built
// from the same feeds as the boards; this only skips the rebuild and the
// waiting flash when the member switches back.

const TTL_MS = 5 * 60 * 1000
const packs = new Map()

export function cachedLivePack(sportId, now = Date.now()) {
  const hit = packs.get(sportId)
  if (!hit) return null
  if (now - hit.at > TTL_MS) {
    packs.delete(sportId)
    return null
  }
  return hit.pack
}

export function rememberLivePack(sportId, pack, at = Date.now()) {
  if (!sportId || !pack) return
  packs.set(sportId, { at, pack })
}

export function clearLivePacks() {
  packs.clear()
}
