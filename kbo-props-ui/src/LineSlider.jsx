import { useRef } from 'react'
import { formatGameCount, formatHitRate, hitRatePillStyle, HIT_RATE_NEUTRAL_BG, HIT_RATE_NEUTRAL_TEXT } from './hitRateStrip'
import { formatLineValue, snapLine } from './lineSlider'
import './lineSlider.css'

function valueFromClientY(clientY, plot, scaleMax) {
  const rect = plot?.getBoundingClientRect()
  if (!rect || rect.height <= 0) return null
  const ratio = 1 - (clientY - rect.top) / rect.height
  return Math.min(1, Math.max(0, ratio)) * scaleMax
}

export function DraggableChartLine({ plotRef, lineClassName, slider }) {
  const { line, postedLine, min, max, step, moved, setLine, nudge } = slider
  const scaleMax = Math.max(max || 0, 1)
  const pct = Math.min(100, Math.max(0, (line / scaleMax) * 100))
  const postedPct = postedLine == null ? null : Math.min(100, Math.max(0, (postedLine / scaleMax) * 100))
  const dragging = useRef(false)

  const moveTo = (clientY) => {
    const raw = valueFromClientY(clientY, plotRef.current, scaleMax)
    if (raw == null) return
    const next = snapLine(raw, step, min, max)
    if (next != null) setLine(next)
  }

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    dragging.current = true
    event.currentTarget.classList.add('is-dragging')
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.querySelector('.line-slider-handle')?.focus()
    moveTo(event.clientY)
  }

  const onPointerMove = (event) => {
    if (!dragging.current) return
    moveTo(event.clientY)
  }

  const endDrag = (event) => {
    dragging.current = false
    event.currentTarget.classList.remove('is-dragging')
  }

  const onKeyDown = (event) => {
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1
      : 0
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (event.key === 'Home') setLine(min)
    else if (event.key === 'End') setLine(max)
    else nudge(direction)
  }

  return (
    <>
      {moved && postedPct != null && (
        <div className="line-slider-ghost" style={{ bottom: `${postedPct}%` }} aria-hidden="true">
          <span>PrizePicks {formatLineValue(postedLine)}</span>
        </div>
      )}
      <div
        className={`${lineClassName} line-slider-line${moved ? ' is-moved' : ''}`}
        style={{ bottom: `${pct}%` }}
        data-testid="line-slider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          className="line-slider-handle"
          role="slider"
          aria-label="Prop line"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={line}
          aria-valuetext={formatLineValue(line)}
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
        >
          <span className="line-slider-grip" aria-hidden="true">⋮⋮</span>
          {formatLineValue(line)}
        </button>
      </div>
    </>
  )
}

export function LinePlot({ className, slider, lineClassName, children }) {
  const plotRef = useRef(null)
  return (
    <div className={className} ref={plotRef}>
      {slider?.line != null && (
        <DraggableChartLine plotRef={plotRef} lineClassName={lineClassName} slider={slider} />
      )}
      {children}
    </div>
  )
}

function altTone(item) {
  return hitRatePillStyle(item) || {
    thin: true,
    background: HIT_RATE_NEUTRAL_BG,
    borderColor: 'rgba(161, 161, 170, 0.45)',
    color: HIT_RATE_NEUTRAL_TEXT,
  }
}

export function AltLinesRow({ slider }) {
  if (!slider?.alts?.length || slider.line == null) return null
  const { alts, line, postedLine, moved, setLine, reset } = slider
  return (
    <div className="alt-lines" data-testid="alt-lines" aria-label="Alternate lines">
      <span className="alt-lines-label">Alt lines</span>
      {alts.map((item) => {
        const tone = altTone(item)
        const active = Math.abs(item.line - line) < 1e-9
        const games = formatGameCount(item.games, item.pushes)
        return (
          <button
            key={item.line}
            type="button"
            className={`alt-line${active ? ' is-on' : ''}`}
            aria-pressed={active}
            onClick={() => setLine(item.line)}
          >
            <b>{formatLineValue(item.line)}</b>
            <span
              className={tone.thin ? 'hit-rate-pill is-thin' : 'hit-rate-pill'}
              style={{ background: tone.background, borderColor: tone.borderColor, color: tone.color }}
            >
              <span className="hit-rate-pill-k">OVER</span>
              <span className="hit-rate-pill-v">{formatHitRate(item.rate) || '—'}</span>
              {games ? <span className="hit-rate-pill-n">{games}</span> : null}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        className="alt-line-reset"
        data-testid="line-slider-reset"
        onClick={reset}
        disabled={!moved}
      >
        Reset to {formatLineValue(postedLine)}
      </button>
    </div>
  )
}
