import { useEffect, useState } from 'react'
import { BOOT_LINES, BOOT_SLOW_MS, bootElapsed, bootShowsLoader } from './bootPhase.js'
import './bootScreen.css'

function PickSkeleton() {
  return (
    <div className="cg-pick" aria-hidden="true">
      <span className="cg-rank cg-shimmer" />
      <span className="cg-lines">
        <i className="cg-shimmer" />
        <i className="cg-shimmer" />
      </span>
      <span className="cg-stat cg-shimmer" />
    </div>
  )
}

export function BoardSkeleton({ rows = 6, label = 'Loading the board' }) {
  return (
    <div className="cg-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="cg-row" key={index} aria-hidden="true">
          <span className="cg-avatar cg-shimmer" />
          <span className="cg-lines">
            <i className="cg-shimmer" />
            <i className="cg-shimmer" />
          </span>
          <span className="cg-mini">
            <b /><b /><b /><b /><b />
          </span>
        </div>
      ))}
    </div>
  )
}

function LoaderStage() {
  return (
    <div className="cg-boot-stage">
      <div className="cg-glow" aria-hidden="true" />
      <div className="cg-boot-mark">cg<span>propz</span></div>
      <div className="cg-bars" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ '--i': i }} />)}
        <i />
      </div>
      <p className="cg-boot-copy">
        {BOOT_LINES.map((line) => <span key={line}>{line}</span>)}
      </p>
    </div>
  )
}

export default function BootScreen({ inset = false }) {
  const [slow, setSlow] = useState(() => bootShowsLoader(bootElapsed(), { inset }))
  useEffect(() => {
    if (inset || slow) return undefined
    const wait = Math.max(0, BOOT_SLOW_MS - bootElapsed())
    const timer = setTimeout(() => setSlow(true), wait)
    return () => clearTimeout(timer)
  }, [inset, slow])

  return (
    <div
      className={`cg-boot${inset ? ' is-inset' : ''}${slow ? ' is-slow' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading cgpropz"
    >
      <div className="cg-boot-skeleton">
        <header className="cg-boot-top">
          <div className="cg-boot-mark">cg<span>propz</span></div>
          <nav className="cg-boot-nav" aria-hidden="true">
            <span>NFL</span>
          </nav>
        </header>
        <p className="cg-kicker">Today’s NFL free top 3</p>
        <div className="cg-picks">
          <PickSkeleton />
          <PickSkeleton />
          <PickSkeleton />
        </div>
        <p className="cg-kicker">Board</p>
        <BoardSkeleton rows={5} />
      </div>
      <LoaderStage />
    </div>
  )
}
