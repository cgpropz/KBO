import { useEffect, useState } from 'react'

export const PHONE_BOARD_QUERY = '(max-width: 767px)'

function phoneNow() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PHONE_BOARD_QUERY).matches
}

// One listener per board, not per row. Desktop stays on the table.
export function usePhoneBoard() {
  const [phone, setPhone] = useState(phoneNow)
  useEffect(() => {
    const media = window.matchMedia(PHONE_BOARD_QUERY)
    const apply = () => setPhone(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return phone
}

// First phone paint is a short window so the first card is not stuck behind
// a commit of the whole board. The rest follow on the next frame. The count
// only grows, so a later filter does not snap back to the window.
export const PHONE_FIRST_PAINT = 12

export function usePhonePaintCount(phone, total) {
  const [shown, setShown] = useState(PHONE_FIRST_PAINT)
  useEffect(() => {
    if (!phone || total <= shown) return undefined
    const frame = requestAnimationFrame(() => setShown(total))
    return () => cancelAnimationFrame(frame)
  }, [phone, total, shown])
  if (!phone) return total
  return Math.min(total, shown)
}
