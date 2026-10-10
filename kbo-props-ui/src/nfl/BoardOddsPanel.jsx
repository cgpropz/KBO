import { useEffect, useMemo, useRef, useState } from 'react'
import { boardSide, findSharpOdds, indexSharpOdds, oddsPanelMessage, usableSharpOdds } from '../boardOdds'
import { BASELINES, BookStrip } from './BookOddsStrip'
import './bookOddsStrip.css'

export function useBoardOdds(load) {
  const loadRef = useRef(load)
  const [records, setRecords] = useState([])
  const [oddsState, setOddsState] = useState('loading')

  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    let active = true
    loadRef.current()
      .then(({ records: next, preview }) => {
        if (!active) return
        setRecords(Array.isArray(next) ? next : [])
        setOddsState(preview ? 'preview' : 'ready')
      })
      .catch(() => {
        if (!active) return
        setRecords([])
        setOddsState('error')
      })
    return () => { active = false }
  }, [])

  const index = useMemo(() => indexSharpOdds(records), [records])
  return { index, oddsState }
}

export function OddsChevron({ open, player, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      className={`nfl-odds-toggle${open ? ' open' : ''}`}
      aria-expanded={open ? 'true' : 'false'}
      aria-label={`${open ? 'Hide' : 'Show'} sportsbook odds for ${player}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        if (!disabled) onToggle()
      }}
    >
      <i className={`nfl-odds-chevron${open ? ' open' : ''}`} />
    </button>
  )
}

function stripItem(item, odds) {
  const side = boardSide(item?.projection, item?.line)
  const recommendation = side === 'under' ? 'UNDER' : side === 'over' ? 'OVER' : odds?.recommendation
  if (odds) return { ...odds, recommendation }
  return {
    pp_line: item?.line,
    prop: item?.prop,
    recommendation,
    book_prices: [],
    line_match: 'none',
  }
}

export function BoardOddsPanel({ item, odds, oddsState, seen = false }) {
  const [mode, setMode] = useState('flex')
  const baseline = BASELINES[mode] || BASELINES.flex
  const message = oddsPanelMessage(odds, oddsState, seen)
  return (
    <div className="nfl-board-odds">
      <div className="nfl-sharp-baseline" role="group" aria-label="PrizePicks juice">
        {Object.values(BASELINES).map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={mode === choice.id ? 'active' : ''}
            aria-pressed={mode === choice.id}
            onClick={() => setMode(choice.id)}
          >
            {choice.label} ({choice.american > 0 ? `+${choice.american}` : choice.american})
          </button>
        ))}
      </div>
      <BookStrip
        item={stripItem(item, odds)}
        mode={mode}
        baselineAmerican={baseline.american}
        emptyMessage={message || undefined}
      />
    </div>
  )
}

export function boardOddsFor(index, item) {
  const record = findSharpOdds(index, item)
  return { odds: usableSharpOdds(record), seen: !!record }
}
