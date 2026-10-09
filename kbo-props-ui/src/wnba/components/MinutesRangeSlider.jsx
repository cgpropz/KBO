import { useRef } from 'react'
import { MINUTES_STEP, clampMinutes } from '../chartFilters'

// Two-handle range. Pointer events cover mouse and iPhone touch. The track is
// the drag target so a thumb does not have to be hit exactly.
export default function MinutesRangeSlider({ min, max, low, high, onChange }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const span = max - min
  const disabled = !(span > 0)
  const leftPct = disabled ? 0 : ((low - min) / span) * 100
  const rightPct = disabled ? 100 : ((high - min) / span) * 100
  const handlesTogether = !disabled && high - low <= MINUTES_STEP

  const valueFromClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return low
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return clampMinutes(min + ratio * span, min, max)
  }

  const nearestHandle = (value) => (
    Math.abs(value - low) <= Math.abs(value - high) ? 'low' : 'high'
  )

  const apply = (handle, value) => {
    if (handle === 'low') onChange(Math.min(value, high), high)
    else onChange(low, Math.max(value, low))
  }

  const onPointerDown = (event) => {
    if (disabled) return
    if (event.button != null && event.button !== 0) return
    const explicit = event.target?.dataset?.handle
    const nextValue = valueFromClientX(event.clientX)
    const handle = explicit || nearestHandle(nextValue)
    dragRef.current = handle
    trackRef.current?.setPointerCapture?.(event.pointerId)
    if (!explicit) apply(handle, nextValue)
  }

  const onPointerMove = (event) => {
    if (!dragRef.current) return
    apply(dragRef.current, valueFromClientX(event.clientX))
  }

  const endDrag = () => { dragRef.current = null }

  const onKeyDown = (handle) => (event) => {
    if (disabled) return
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1
      : 0
    if (!direction) return
    event.preventDefault()
    const current = handle === 'low' ? low : high
    apply(handle, clampMinutes(current + direction * MINUTES_STEP, min, max))
  }

  return (
    <div
      className={`wnba-minutes-range${disabled ? ' is-disabled' : ''}`}
      ref={trackRef}
      data-testid="minutes-range"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div className="wnba-minutes-range-rail" />
      <div
        className="wnba-minutes-range-fill"
        style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
      />
      <button
        type="button"
        className="wnba-minutes-thumb"
        data-handle="low"
        style={{ left: `${leftPct}%`, zIndex: handlesTogether ? 3 : 2 }}
        role="slider"
        aria-label="Minimum minutes"
        aria-valuemin={min}
        aria-valuemax={high}
        aria-valuenow={low}
        aria-valuetext={`${low} minutes`}
        aria-orientation="horizontal"
        disabled={disabled}
        onKeyDown={onKeyDown('low')}
      />
      <button
        type="button"
        className="wnba-minutes-thumb"
        data-handle="high"
        style={{ left: `${rightPct}%`, zIndex: handlesTogether ? 2 : 3 }}
        role="slider"
        aria-label="Maximum minutes"
        aria-valuemin={low}
        aria-valuemax={max}
        aria-valuenow={high}
        aria-valuetext={`${high} minutes`}
        aria-orientation="horizontal"
        disabled={disabled}
        onKeyDown={onKeyDown('high')}
      />
    </div>
  )
}
