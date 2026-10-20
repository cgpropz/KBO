import { PHONE_BOARD_QUERY } from './phoneBoardQuery.js'

/*
 * Phone table cards. mobile.css turns every member table in a sport app into
 * one card per row and hides the header row, so on a phone each value lost
 * its column name. This copies each column header onto its cells as
 * data-label, which the phone stylesheet prints above the value. It only adds
 * attributes: no cell, value, or order changes. It runs only while the phone
 * board query matches, so iPad and desktop keep the plain table.
 *
 * A table opts out with data-card-table="off". The hit-rate board and the
 * PrizePicks line table have their own phone cards and are skipped.
 */

export const CARD_TABLE_SELECTOR = ':is(.kbo-app-root, .nfl-root, .wnba-root) table:not(.hit-rate-board):not([data-testid="prop-line-table"]):not([data-card-table="off"])'

// Arrows (U+2190-21FF) and the small triangles (U+25B2-25BF) used as sort icons.
const SORT_GLYPHS = /[\u2190-\u21FF\u25B2-\u25BF]/g

// Header text without sort arrows or extra spaces.
export function cleanHeaderLabel(text) {
  return String(text || '').replace(SORT_GLYPHS, ' ').replace(/\s+/g, ' ').trim()
}

// The player (or name) cell heads the card on its own line, unlabeled, like
// an empty header (a pick checkbox). A first column called Stat (a stat-name
// row header) heads the card too.
export function isHeadLabel(label, column = -1) {
  return label === '' || /^(player|name)$/i.test(label) || (column === 0 && /^stat$/i.test(label))
}

function headerText(th) {
  if (th.dataset.label != null) return cleanHeaderLabel(th.dataset.label)
  const copy = th.cloneNode(true)
  copy.querySelectorAll('.sort-icon, .gt-sort').forEach((node) => node.remove())
  // Join text pieces with a space so a header and its <small> note
  // ("L5" + "5 gm") do not run together.
  const parts = []
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue)
  return cleanHeaderLabel(parts.join(' '))
}

function setAttr(node, name, value) {
  if (value == null) {
    if (node.hasAttribute(name)) node.removeAttribute(name)
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value)
  }
}

export function columnLabels(table) {
  const rows = table.tHead?.rows
  if (!rows || rows.length === 0) return null
  const labels = []
  for (const th of rows[rows.length - 1].cells) {
    const label = headerText(th)
    const span = Math.max(1, th.colSpan || 1)
    for (let i = 0; i < span; i += 1) labels.push(label)
  }
  return labels
}

export function labelTable(table) {
  const labels = columnLabels(table)
  if (!labels) return
  setAttr(table, 'data-card-table', 'on')
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      const cells = row.cells
      // A detail row (one cell across the table) spans the whole grid.
      if (cells.length === 1 && (cells[0].colSpan || 1) > 1) {
        setAttr(row, 'data-card-row', 'full')
        setAttr(cells[0], 'data-label', null)
        setAttr(cells[0], 'data-card-head', null)
        continue
      }
      setAttr(row, 'data-card-row', 'card')
      let column = 0
      for (const cell of cells) {
        const label = labels[column] ?? ''
        const head = isHeadLabel(label, column)
        column += Math.max(1, cell.colSpan || 1)
        setAttr(cell, 'data-card-head', head ? '' : null)
        setAttr(cell, 'data-label', head ? null : label)
      }
    }
  }
}

export function labelCardTables(root = document) {
  root.querySelectorAll(CARD_TABLE_SELECTOR).forEach(labelTable)
}

function touchesTable(record) {
  if (!record.addedNodes.length) return false
  const target = record.target
  if (target.nodeType === 1 && target.closest('table')) return true
  for (const node of record.addedNodes) {
    if (node.nodeType === 1 && (node.tagName === 'TABLE' || node.querySelector('table'))) return true
  }
  return false
}

// Watches the page while the phone query matches. Safe to call once at boot.
export function startTableCardLabels() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof MutationObserver !== 'function') return () => {}
  const media = window.matchMedia(PHONE_BOARD_QUERY)
  let observer = null
  const apply = () => {
    if (media.matches && !observer) {
      // Mutation records arrive in one batch per task, before the browser
      // paints, so new rows show up already labeled.
      observer = new MutationObserver((records) => {
        if (records.some(touchesTable)) labelCardTables(document)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      labelCardTables(document)
    } else if (!media.matches && observer) {
      observer.disconnect()
      observer = null
    }
  }
  apply()
  media.addEventListener('change', apply)
  return () => {
    media.removeEventListener('change', apply)
    if (observer) observer.disconnect()
  }
}
