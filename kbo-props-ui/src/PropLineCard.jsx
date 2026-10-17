import { Fragment } from 'react'

// The free mobile board and every member dashboard share this card.
// At 768px and up the same cells stay in the desktop table.
export function BoardLine({ phone, className, onClick, rowRef, cells, after }) {
  const items = cells || []
  if (phone) {
    return (
      <article
        className={`prop-line-card${className ? ` ${className}` : ''}`}
        data-testid="prop-line-card"
        onClick={onClick}
        ref={rowRef}
      >
        {items.map((cell, index) => (
          cell.className || cell.style || cell.onClick
            ? (
              <div key={index} className={cell.className} style={cell.style} onClick={cell.onClick}>
                {cell.node}
              </div>
            )
            : <Fragment key={index}>{cell.node}</Fragment>
        ))}
        {after}
      </article>
    )
  }
  return (
    <>
      <tr className={className} onClick={onClick} ref={rowRef}>
        {items.map((cell, index) => (
          <td key={index} className={cell.className} style={cell.style} onClick={cell.onClick}>
            {cell.node}
          </td>
        ))}
      </tr>
      {after}
    </>
  )
}

export function BoardSurface({ phone, wrapClass, wrapRef, tableClass, head, children, overlay }) {
  if (phone) {
    return (
      <div className={`${wrapClass || ''} prop-line-cards`.trim()} data-testid="prop-line-cards" ref={wrapRef}>
        {children}
        {overlay}
      </div>
    )
  }
  return (
    <div className={wrapClass} ref={wrapRef}>
      <table className={tableClass} data-testid="prop-line-table">
        <thead><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {overlay}
    </div>
  )
}

export function LockedPlaceholder({ phone, className }) {
  if (phone) {
    return (
      <article className={`prop-line-card locked ${className || ''}`} data-testid="prop-line-card" aria-hidden="true">
        <span className="nfl-placeholder-bar" />
      </article>
    )
  }
  return (
    <tr className={className} aria-hidden="true">
      <td colSpan={6}><span className="nfl-placeholder-bar" /></td>
    </tr>
  )
}
