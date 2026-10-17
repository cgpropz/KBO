import { PHONE_BOARD_QUERY } from './src/phoneBoardQuery.js'

// mobile.css writes @media (--phone-board) so the menu, the cards, and
// usePhoneBoard cannot drift onto two copies of the query.
export const PHONE_BOARD_MEDIA_TOKEN = '@media (--phone-board)'

export function applyPhoneBoardMedia(code) {
  if (typeof code !== 'string' || !code.includes(PHONE_BOARD_MEDIA_TOKEN)) return code
  return code.replaceAll(PHONE_BOARD_MEDIA_TOKEN, `@media ${PHONE_BOARD_QUERY}`)
}

export function phoneMediaPlugin() {
  return {
    name: 'phone-board-media',
    enforce: 'pre',
    transform(code, id) {
      if (typeof code !== 'string' || typeof id !== 'string') return null
      if (!id.split('?')[0].endsWith('.css')) return null
      if (!code.includes(PHONE_BOARD_MEDIA_TOKEN)) return null
      return { code: applyPhoneBoardMedia(code), map: null }
    },
  }
}
