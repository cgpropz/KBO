// Run work after the visitor scrolls a section into view, or once the hero
// has had time to paint. requestIdleCallback on a quiet page runs in the same
// turn as `load`, which still starts every deferred /api/data call inside the
// initial burst. A gap after `load` leaves the hero request as the only data
// fetch while the largest text paints.

export const AFTER_LOAD_MS = 3000

export function onPageIdle(cb, timeout = AFTER_LOAD_MS) {
  if (typeof window === 'undefined') return () => {}
  let cancelInner = () => {}
  let finished = false
  const run = () => {
    if (finished) return
    finished = true
    cb()
  }
  const arm = () => {
    const id = setTimeout(run, timeout)
    cancelInner = () => clearTimeout(id)
  }
  if (document.readyState === 'complete') arm()
  else window.addEventListener('load', arm, { once: true })
  return () => {
    finished = true
    cancelInner()
    window.removeEventListener('load', arm)
  }
}

export function whenVisibleOrIdle(ids, cb) {
  let ran = false
  let observer = null
  const nodes = () => ids.map((id) => document.getElementById(id)).filter(Boolean)
  const inView = () => nodes().some((node) => {
    const rect = node.getBoundingClientRect()
    return rect.top < window.innerHeight + 160 && rect.bottom > -160
  })
  const cleanup = () => {
    observer?.disconnect()
    window.removeEventListener('scroll', onScroll)
    cancelIdle()
  }
  const run = () => {
    if (ran) return
    ran = true
    cleanup()
    cb()
  }
  // A section already on screen still waits out the hero. A real scroll
  // starts the work immediately. Ignore the scroll event some browsers emit
  // while the first layout settles, or every dataset starts on load.
  let scrolled = false
  const originY = window.scrollY
  function onScroll() {
    if (Math.abs(window.scrollY - originY) < 24) return
    scrolled = true
    if (inView()) run()
  }
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (!scrolled) return
      if (entries.some((entry) => entry.isIntersecting)) run()
    }, { rootMargin: '160px 0px' })
    nodes().forEach((node) => observer.observe(node))
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  const cancelIdle = onPageIdle(run)
  return cleanup
}
