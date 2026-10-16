// Deferred landing work starts only after the visitor scrolls a data section
// into view. A timer fetches the other boards while a slow hero request is
// still open, and parsing those payloads is one long main-thread task.

export function afterPaint() {
  return new Promise((resolve) => {
    const finish = () => setTimeout(resolve, 0)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    else finish()
  })
}

export function whenVisible(ids, cb) {
  if (typeof window === 'undefined') return () => {}
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
  }
  const run = () => {
    if (ran) return
    ran = true
    cleanup()
    cb()
  }
  // Ignore the scroll event some browsers emit while the first layout
  // settles. A real scroll of a data section starts the work.
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
  return cleanup
}
