// Board card headshot sources for an NHL row, in order. The PrizePicks image
// comes first, then the public NHL mug for the player id. A relative path
// (PrizePicks sometimes sends its own /assets/player-placeholder-*.svg) or a
// PrizePicks placeholder is not a headshot: on our domain the path 404s and
// the card showed a broken image. An empty list means initials.
import { fitImage } from '../fitImage.js'
import { nhlHeadshotUrl } from './nhlTeams.js'

const PLACEHOLDER = /(?:^|\/)(?:player-)?placeholder[^/]*$/i

export function usableHeadshotUrl(url) {
  const value = String(url ?? '').trim()
  if (!/^https:\/\/[^/]+\/./i.test(value)) return ''
  const path = value.split(/[?#]/)[0]
  if (PLACEHOLDER.test(path)) return ''
  return value
}

export function nhlAvatarSources(item, cssPx = 42) {
  const sources = []
  const pp = usableHeadshotUrl(item?.imageUrl)
  if (pp) sources.push(fitImage(pp, cssPx))
  const mug = nhlHeadshotUrl(item?.playerId)
  if (mug) sources.push(fitImage(mug, cssPx))
  return [...new Set(sources.filter(Boolean))]
}
