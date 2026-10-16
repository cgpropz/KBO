import { useEffect, useState } from 'react'
import { boardStatusLine, cheatsheetWarningLine, isBoardStale } from './boardFreshness'
import './boardStatus.css'

export default function BoardStatus({ sport, updatedAt, injuriesCheckedAt = null }) {
  const line = boardStatusLine({ sport, updatedAt, injuriesCheckedAt })
  const [sheetWarning, setSheetWarning] = useState('')

  useEffect(() => {
    let active = true
    const url = `${import.meta.env.BASE_URL}cheatsheet_warnings.json`
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (active) setSheetWarning(cheatsheetWarningLine(payload, sport))
      })
      .catch(() => { if (active) setSheetWarning('') })
    return () => { active = false }
  }, [sport])

  if (!line && !sheetWarning) return null
  const stale = isBoardStale(updatedAt, sport)
  return (
    <>
      {line ? (
        <p className={`board-status${stale ? ' is-stale' : ''}`} data-testid={`board-status-${sport}`}>
          {line}
        </p>
      ) : null}
      {sheetWarning ? (
        <p className="board-status is-stale" data-testid={`cheatsheet-warning-${sport}`}>
          {sheetWarning}
        </p>
      ) : null}
    </>
  )
}
