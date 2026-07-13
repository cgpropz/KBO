import { fmt1, posBadgeClass } from '../utils/formatters'

const FALLBACK_AVATAR = (name = '') => {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function PlayerCard({ player, ppLines = null, onSelect }) {
  const {
    name = '', team = '', position = 'N/A', image = null,
    teamColor = '#FF6900',
    pts = 0, reb = 0, ast = 0, gp = 0,
  } = player

  // Only show PP row if at least one of the three main stats has a line
  const ppRow = ppLines
    ? [
        { label: 'PTS', line: ppLines['Points'] ?? null },
        { label: 'REB', line: ppLines['Rebounds'] ?? null },
        { label: 'AST', line: ppLines['Assists'] ?? null },
      ]
    : null
  const hasPpLine = ppRow && ppRow.some(s => s.line != null)

  return (
    <div
      onClick={() => onSelect?.(name)}
      className="card"
      style={{
        cursor: 'pointer',
        padding: '20px',
        transition: 'all 0.2s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = teamColor + '60'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `0 8px 24px ${teamColor}18`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#222'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Team color accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3, background: teamColor, opacity: 0.8,
      }} />

      {/* Header: avatar + name + team */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
        {/* Avatar */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: image ? 'transparent' : teamColor + '22',
          border: `2px solid ${teamColor}40`,
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: teamColor,
          overflow: 'hidden',
        }}>
          {image
            ? <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
            : FALLBACK_AVATAR(name)
          }
        </div>

        {/* Name + team + position */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'white', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: teamColor,
              background: teamColor + '18',
              padding: '2px 7px', borderRadius: 20,
              letterSpacing: '0.4px',
            }}>{team}</span>
            <span className={posBadgeClass(position)}>{position}</span>
          </div>
        </div>

        {/* GP badge */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>{gp || '—'}</p>
          <p className="stat-label" style={{ marginTop: 2 }}>GP</p>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 1,
        background: '#1a1a1a',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #1f1f1f',
      }}>
        {[['PTS', pts], ['REB', reb], ['AST', ast]].map(([label, val]) => (
          <div key={label} style={{ padding: '10px 0', textAlign: 'center', background: '#131313' }}>
            <p className="stat-value" style={{ fontSize: 17 }}>{fmt1(val)}</p>
            <p className="stat-label" style={{ marginTop: 2 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* PrizePicks lines row */}
      {hasPpLine && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 1, marginTop: 6,
          background: '#1a1a1a', borderRadius: 8, overflow: 'hidden',
          border: '1px solid #1f1f1f',
        }}>
          {ppRow.map(({ label, line }) => (
            <div key={label} style={{ padding: '7px 0', textAlign: 'center', background: '#0e0e0e' }}>
              {line != null ? (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#7efc6a', lineHeight: 1.2 }}>{line}</p>
              ) : (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#2a2a2a', lineHeight: 1.2 }}>—</p>
              )}
              <p className="stat-label" style={{ marginTop: 2, color: '#3d5c4a' }}>PP {label}</p>
            </div>
          ))}
        </div>
      )}

      {/* View arrow */}
      <div style={{
        position: 'absolute', bottom: 14, right: 16,
        color: '#333', fontSize: 16, transition: 'color 0.2s',
      }}>›</div>
    </div>
  )
}
