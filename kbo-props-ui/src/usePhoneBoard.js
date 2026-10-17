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
