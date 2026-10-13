import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GAME_FILTER_EVENT,
  filterRows,
  listGames,
  readGameParam,
  resolveGameId,
  writeGameParam,
} from './gameFilter.js'

export function useGameParam() {
  const [param, setParam] = useState(() => (
    typeof window === 'undefined' ? '' : readGameParam(window.location.search)
  ))

  useEffect(() => {
    const sync = () => setParam(readGameParam(window.location.search))
    window.addEventListener('popstate', sync)
    window.addEventListener(GAME_FILTER_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(GAME_FILTER_EVENT, sync)
    }
  }, [])

  return param
}

export function useGameFilter(rows) {
  const param = useGameParam()
  const games = useMemo(() => listGames(rows), [rows])
  const selected = resolveGameId(param, games)
  const setSelected = useCallback((id) => {
    const next = id && games.some((game) => game.id === id) ? id : ''
    writeGameParam(next)
  }, [games])
  const filtered = useMemo(() => filterRows(rows, selected), [rows, selected])
  return { games, selected, setSelected, filtered }
}
