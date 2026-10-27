import { useState } from 'react'
import { createPortal } from 'react-dom'
import { lineWord } from '../lineCount.js'
import {
  GRADE_OPTIONS,
  GAMES_OPTIONS,
  HIT_RATE_OPTIONS,
  NHL_PROP_TABS,
  NHL_SORT_OPTIONS,
  POSITIONS,
} from './nhlBoardFilters.js'

function FilterIcon() {
  return (
    <svg className="nfl-filters-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" /><circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FilterRow({ id, label, value, expandedRow, onToggle, children }) {
  const expanded = expandedRow === id
  return (
    <div className="nfl-filter-row">
      <button type="button" className="nfl-filter-row-head" onClick={() => onToggle(id)}>
        <span>{label}</span>
        <span className="nfl-filter-row-value">{value}</span>
        <i className={`nfl-filter-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded && <div className="nfl-filter-row-body">{children}</div>}
    </div>
  )
}

export function NhlFiltersButton({ open, narrowed, onOpen }) {
  return (
    <button
      type="button"
      className={`nfl-filters-btn${open || narrowed ? ' active' : ''}`}
      data-testid="nhl-filters-open"
      aria-expanded={open}
      onClick={onOpen}
    >
      <FilterIcon /> Filters
    </button>
  )
}

export function NhlFiltersPanel({
  open,
  onClose,
  filters,
  updateFilter,
  resetFilters,
  propTab,
  setPropTab,
  propTabs = NHL_PROP_TABS,
  lineBounds,
  teams,
  matchups,
  resultCount,
}) {
  const [expandedRow, setExpandedRow] = useState(null)
  const toggleRow = (id) => setExpandedRow((current) => (current === id ? null : id))
  if (!open || typeof document === 'undefined') return null
  const bounds = lineBounds || { min: 0, max: 0 }
  return createPortal(
    <div className="nfl-filters-overlay nhl-filters-overlay" onClick={onClose}>
      <div className="nfl-filters-panel" data-testid="nhl-filters-panel" onClick={(event) => event.stopPropagation()}>
        <div className="nfl-filters-head">
          <h2>Filters</h2>
          <button type="button" className="nfl-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="nhl-filters-scroll">
          <div className="nfl-filters-side">
            {['All', 'Overs', 'Unders'].map((option) => (
              <button key={option} type="button" className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
            ))}
          </div>

          <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
            <select aria-label="Sort by" value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
              {NHL_SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </FilterRow>

          <FilterRow id="hitrate" label="Hit Rates" value={`L10 > ${filters.minHitRate}%`} expandedRow={expandedRow} onToggle={toggleRow}>
            <div className="nfl-filter-chip-row">
              {HIT_RATE_OPTIONS.map((option) => (
                <button key={option} type="button" className={filters.minHitRate === option ? 'active' : ''} onClick={() => updateFilter('minHitRate', option)}>{option === 0 ? 'All' : `>${option}%`}</button>
              ))}
            </div>
          </FilterRow>

          <FilterRow id="prop" label="Prop Type" value={propTab} expandedRow={expandedRow} onToggle={toggleRow}>
            <select aria-label="Prop type" value={propTab} onChange={(event) => setPropTab(event.target.value)}>
              {propTabs.map((option) => <option key={option}>{option}</option>)}
            </select>
          </FilterRow>

          <FilterRow id="games" label="Games" value={filters.minGames === 0 ? 'All' : `${filters.minGames}+`} expandedRow={expandedRow} onToggle={toggleRow}>
            <div className="nfl-filter-chip-row">
              {GAMES_OPTIONS.map((option) => (
                <button key={option} type="button" className={filters.minGames === option ? 'active' : ''} onClick={() => updateFilter('minGames', option)}>{option === 0 ? 'All' : `${option}+`}</button>
              ))}
            </div>
          </FilterRow>

          <FilterRow id="position" label="Positions" value={filters.position} expandedRow={expandedRow} onToggle={toggleRow}>
            <div className="nfl-filter-chip-row" role="group" aria-label="Positions">
              {POSITIONS.map((option) => (
                <button key={option} type="button" className={filters.position === option ? 'active' : ''} onClick={() => updateFilter('position', option)}>{option}</button>
              ))}
            </div>
          </FilterRow>

          <FilterRow id="team" label="Team" value={filters.team === 'All' ? 'All teams' : filters.team} expandedRow={expandedRow} onToggle={toggleRow}>
            <select data-testid="nhl-filter-team" aria-label="Team" value={filters.team} onChange={(event) => updateFilter('team', event.target.value)}>
              {(teams || ['All']).map((option) => <option key={option} value={option}>{option === 'All' ? 'All teams' : option}</option>)}
            </select>
          </FilterRow>

          <FilterRow id="matchup" label="Matchup" value={filters.matchup === 'All' ? 'All matchups' : filters.matchup} expandedRow={expandedRow} onToggle={toggleRow}>
            <select data-testid="nhl-filter-matchup" aria-label="Matchup" value={filters.matchup} onChange={(event) => updateFilter('matchup', event.target.value)}>
              {(matchups || ['All']).map((option) => <option key={option} value={option}>{option === 'All' ? 'All matchups' : option}</option>)}
            </select>
          </FilterRow>

          <FilterRow id="edge" label="CG Score" value={filters.edgeMin || filters.edgeMax ? `${filters.edgeMin || '—'} to ${filters.edgeMax || '—'}` : 'All'} expandedRow={expandedRow} onToggle={toggleRow}>
            <div className="nfl-filter-range-row">
              <input type="number" inputMode="decimal" aria-label="CG Score low bound" placeholder="Min" value={filters.edgeMin} onChange={(event) => updateFilter('edgeMin', event.target.value)} />
              <span>to</span>
              <input type="number" inputMode="decimal" aria-label="CG Score high bound" placeholder="Max" value={filters.edgeMax} onChange={(event) => updateFilter('edgeMax', event.target.value)} />
            </div>
          </FilterRow>

          <FilterRow id="lines" label="Lines" value={filters.lineMin || filters.lineMax ? `${filters.lineMin || bounds.min} to ${filters.lineMax || bounds.max}` : `${bounds.min} to ${bounds.max}`} expandedRow={expandedRow} onToggle={toggleRow}>
            <div className="nfl-filter-range-row">
              <input type="number" aria-label="Line low bound" placeholder={String(bounds.min)} value={filters.lineMin} onChange={(event) => updateFilter('lineMin', event.target.value)} />
              <span>to</span>
              <input type="number" aria-label="Line high bound" placeholder={String(bounds.max)} value={filters.lineMax} onChange={(event) => updateFilter('lineMax', event.target.value)} />
            </div>
          </FilterRow>

          <FilterRow id="grade" label="Matchup Grade" value={filters.grade} expandedRow={expandedRow} onToggle={toggleRow}>
            <select aria-label="Matchup grade" value={filters.grade} onChange={(event) => updateFilter('grade', event.target.value)}>
              {GRADE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </FilterRow>
        </div>
        <div className="nfl-filters-footer">
          <button type="button" className="nfl-filters-reset" onClick={resetFilters}>Reset</button>
          <button type="button" className="nfl-filters-apply" onClick={onClose}>Show {resultCount} {lineWord(resultCount)}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
