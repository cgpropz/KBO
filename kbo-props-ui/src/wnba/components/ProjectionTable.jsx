import { useState, useMemo } from 'react'
import { fmt1, posBadgeClass, dvpLabel, teamColor, ratingLabel } from '../utils/formatters'

const COLS = [
  { key: 'rank', label: '#', sortKey: null, width: 36 },
  { key: 'name', label: 'Player', sortKey: 'name', width: 180 },
  { key: 'team', label: 'Team', sortKey: 'team', width: 72 },
  { key: 'position', label: 'Pos', sortKey: 'position', width: 80 },
  { key: 'avgMins', label: 'MIN', sortKey: 'avgMins', width: 60 },
  { key: 'l3ppm_pts', label: 'L3 PPM', sortKey: 'l3ppm_pts', width: 72, group: 'PPM' },
  { key: 'l7ppm_pts', label: 'L7 PPM', sortKey: 'l7ppm_pts', width: 72, group: 'PPM' },
  { key: 'l15ppm_pts', label: 'L15 PPM', sortKey: 'l15ppm_pts', width: 72, group: 'PPM' },
  { key: 'projPts', label: 'PROJ PTS', sortKey: 'projPts', width: 90, highlight: true },
  { key: 'projReb', label: 'PROJ REB', sortKey: 'projReb', width: 90, highlight: true },
  { key: 'projAst', label: 'PROJ AST', sortKey: 'projAst', width: 90, highlight: true },
  { key: 'projFg3m', label: 'PROJ 3PM', sortKey: 'projFg3m', width: 90, highlight: true },
  { key: 'dvpFactor', label: 'DVP', sortKey: 'dvpFactor', width: 72 },
  { key: 'ppPts', label: 'PP LINE', sortKey: 'ppPts', width: 80, pp: true },
  { key: 'ppRating', label: 'RATING', sortKey: 'ppRating', width: 90, pp: true },
  { key: 'ppAllProps', label: 'ALL PROPS', sortKey: null, width: 360, pp: true },
]

const PP_LABEL_TO_KEY = {
  Points: 'pts',
  Rebounds: 'reb',
  Assists: 'ast',
  '3-PT Made': 'fg3m',
}

function SortIcon({ direction }) {
  if (!direction) return <span style={{ color: '#333', fontSize: 10, marginLeft: 4 }}>⇅</span>
  return <span style={{ color: '#FF6900', fontSize: 10, marginLeft: 4 }}>{direction === 'desc' ? '↓' : '↑'}</span>
}

function RatingBadge({ rating }) {
  if (rating == null) return <span style={{ color: '#333', fontSize: 12 }}>—</span>
  const { label, color } = ratingLabel(rating)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{
        fontWeight: 800,
        fontSize: 15,
        color,
        fontFamily: 'monospace',
        letterSpacing: '-0.5px',
      }}>{rating.toFixed(1)}</span>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        color,
        background: color + '18',
        padding: '1px 6px',
        borderRadius: 20,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>{label}</span>
    </div>
  )
}

export default function ProjectionTable({ data = [], loading = false, selectedPropType = 'All', onSelectPlayer }) {
  const [sortKey, setSortKey] = useState('projPts')
  const [sortDir, setSortDir] = useState('desc')

  const flatData = useMemo(() => data.map(p => ({
    ...p,
    l3ppm_pts: p.l3ppm?.pts ?? 0,
    l7ppm_pts: p.l7ppm?.pts ?? 0,
    l15ppm_pts: p.l15ppm?.pts ?? 0,
    ppPts: selectedPropType === 'All'
      ? (p.ppLines?.pts ?? null)
      : ((p.ppAllProps || []).find(prop => prop?.stat === selectedPropType)?.line ?? null),
    ppRating: (() => {
      const key = PP_LABEL_TO_KEY[selectedPropType]
      if (!key) return selectedPropType === 'All' ? (p.ppRating?.pts ?? null) : null
      return p.ppRating?.[key] ?? null
    })(),
  })), [data, selectedPropType])

  const sorted = useMemo(() => {
    if (!sortKey) return flatData
    return [...flatData].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = b[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const aNum = parseFloat(av)
      const bNum = parseFloat(bv)
      if (!isNaN(aNum) && !isNaN(bNum)) return sortDir === 'desc' ? bNum - aNum : aNum - bNum
      return sortDir === 'desc'
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv))
    })
  }, [flatData, sortKey, sortDir])

  function handleSort(key) {
    if (!key) return
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: '#4b5563', fontSize: 14 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
        Computing projections...
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            {COLS.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.sortKey)}
                className={sortKey === col.sortKey ? 'sorted' : ''}
                style={{
                  width: col.width,
                  background: col.pp ? '#0d1a0d' : col.highlight ? '#141414' : '#111',
                  color: col.pp ? '#22c55e' : col.highlight ? '#FF6900' : undefined,
                  borderLeft: col.pp && col.key === 'ppPts' ? '2px solid #22c55e22' : undefined,
                }}
              >
                {col.label}
                {col.sortKey && <SortIcon direction={sortKey === col.sortKey ? sortDir : null} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const tc = teamColor(p.team)
            const dvp = dvpLabel(p.dvpFactor ?? 1)
            const ppLine = p.ppPts
            const ppRating = p.ppRating

            return (
              <tr
                key={`${p.name}-${i}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectPlayer?.(p.name)}
              >
                <td style={{ color: '#4b5563', fontWeight: 600 }}>{i + 1}</td>

                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: tc + '22',
                      border: `1.5px solid ${tc}40`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: tc,
                      flexShrink: 0,
                    }}>
                      {p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </div>
                    <span style={{ fontWeight: 600, color: 'white', fontSize: 13 }}>{p.name}</span>
                  </div>
                </td>

                <td>
                  <span style={{
                    color: tc,
                    fontWeight: 700,
                    fontSize: 12,
                    background: tc + '15',
                    padding: '2px 7px',
                    borderRadius: 20,
                  }}>{p.team}</span>
                </td>

                <td><span className={posBadgeClass(p.position)}>{p.position}</span></td>

                <td style={{ color: '#9ca3af' }}>{fmt1(p.avgMins)}</td>

                <td style={{ color: '#FF6900', fontFamily: 'monospace', fontSize: 12 }}>{(p.l3ppm_pts ?? 0).toFixed(4)}</td>
                <td style={{ color: '#3b82f6', fontFamily: 'monospace', fontSize: 12 }}>{(p.l7ppm_pts ?? 0).toFixed(4)}</td>
                <td style={{ color: '#22c55e', fontFamily: 'monospace', fontSize: 12 }}>{(p.l15ppm_pts ?? 0).toFixed(4)}</td>

                <td style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{fmt1(p.projPts)}</td>
                <td style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{fmt1(p.projReb)}</td>
                <td style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{fmt1(p.projAst)}</td>
                <td style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{fmt1(p.projFg3m)}</td>

                <td>
                  <span style={{
                    color: dvp.color,
                    background: dvp.color + '18',
                    padding: '2px 8px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 700,
                  }}>{dvp.label} ({(p.dvpFactor ?? 1).toFixed(2)}x)</span>
                </td>

                <td style={{ borderLeft: '2px solid #22c55e22' }}>
                  {ppLine != null ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#22c55e' }}>{ppLine}</span>
                      <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PP PTS</span>
                    </div>
                  ) : <span style={{ color: '#333', fontSize: 12 }}>—</span>}
                </td>

                <td><RatingBadge rating={ppRating} /></td>

                <td>
                  {Array.isArray(p.ppAllProps) && p.ppAllProps.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                      {p.ppAllProps.map(prop => (
                        <span
                          key={`${p.name}-${prop.stat}`}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: selectedPropType === prop.stat ? '#bbf7d0' : '#86efac',
                            background: selectedPropType === prop.stat ? '#166534bb' : '#14532d66',
                            border: selectedPropType === prop.stat ? '1px solid #4ade80' : '1px solid #22c55e33',
                            borderRadius: 999,
                            padding: '2px 8px',
                            whiteSpace: 'nowrap',
                            letterSpacing: '0.2px',
                          }}
                          title={`${prop.stat}: ${prop.line}`}
                        >
                          {prop.stat} {prop.line}
                        </span>
                      ))}
                    </div>
                  ) : <span style={{ color: '#333', fontSize: 12 }}>—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
