import { useState } from 'react'

export function usePageMenu() {
  const [open, setOpen] = useState(false)
  return {
    open,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  }
}

export function PageMenuButton({ open, onToggle }) {
  return (
    <button
      type="button"
      className="cg-menu-btn"
      aria-expanded={open}
      aria-controls="cg-page-menu"
      onClick={onToggle}
    >
      <span className="cg-menu-bars" aria-hidden="true" />
      <span className="cg-menu-label">Menu</span>
    </button>
  )
}

export function PageMenu({ open, children }) {
  return (
    <div id="cg-page-menu" className={open ? 'cg-page-menu is-open' : 'cg-page-menu'}>
      {children}
    </div>
  )
}
