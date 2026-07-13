import { useState, useEffect } from 'react'
import { fetchWnbaData } from './wnbaData'
import { posColor } from './utils/formatters'

const TEAM_COLORS = {
  LVA: '#C9A84C', MIN: '#236192', IND: '#C8102E', PHX: '#E56020',
  NYL: '#6ECEB2', SEA: '#2C5234', GSV: '#FFC72C', CON: '#F47321',
  DAL: '#C4D600', LAS: '#702F8A', ATL: '#418FDE', CHI: '#5D76A9',
  WAS: '#002B5C', TOR: '#CE1141', PDX: '#E03A3E',
}

const STATUS_CONFIG = {
  expected:     { label: null,   dot: '#22c55e',  badge: null },
  questionable: { label: 'QUES', dot: '#f59e0b',  badge: '#f59e0b20', badgeText: '#f59e0b' },
  gtd:          { label: 'GTD',  dot: '#fb923c',  badge: '#fb923c20', badgeText: '#fb923c' },
  out:          { label: 'OUT',  dot: '#ef4444',  badge: '#ef444420', badgeText: '#ef4444' },
}

function statusCfg(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.expected
}

function PosBadge({ pos }) {
  const p = (pos || '').toUpperCase()
  const color = posColor(p === 'G' ? 'Guard' : p === 'F' ? 'Forward' : p === 'C' ? 'Center' : pos)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 24, height: 24, borderRadius: 6,
      background: color + '22',
      color, fontSize: 11, fontWeight: 800,
      flexShrink: 0,
    }}>{p || '—'}</span>
  )
}

function StatusDot({ status }) {
  const cfg = statusCfg(status)
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%',
      background: cfg.dot,
      display: 'inline-block', flexShrink: 0,
      boxShadow: `0 0 5px ${cfg.dot}80`,
    }} />
  )
}

function StatusBadge({ status }) {
  const cfg = statusCfg(status)
  if (!cfg.label) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 800,
      background: cfg.badge,
      color: cfg.badgeText,
      padding: '2px 6px', borderRadius: 5,
      letterSpacing: '0.5px',
      flexShrink: 0,
    }}>{cfg.label}</span>
  )
}

function PlayerRow({ player }) {
  const isOut = player.status === 'out'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 0',
      borderBottom: '1px solid #151515',
      opacity: isOut ? 0.5 : 1,
    }}>
      <PosBadge pos={player.pos} />
      <span style={{
        flex: 1, fontSize: 13, fontWeight: 500, color: isOut ? '#6b7280' : 'white',
        textDecoration: isOut ? 'line-through' : 'none',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{player.name}</span>
      <StatusBadge status={player.status} />
      <StatusDot status={player.status} />
    </div>
  )
}

function TeamColumn({ team, side }) {
  const tc = TEAM_COLORS[team.abbr] || '#FF6900'
  const expected = (team.players || []).filter(p => p.status !== 'out')
  const out = [
    ...(team.players || []).filter(p => p.status === 'out'),
    ...(team.inactive || []),
  ].filter((v, i, a) => a.findIndex(x => x.name === v.name) === i)

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Team header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: tc + '18',
        borderBottom: `2px solid ${tc}55`,
        borderRadius: side === 'visitor' ? '10px 0 0 0' : '0 10px 0 0',
      }}>
        <div style={{
          width: 36, height: 36,
          background: tc + '30',
          border: `2px solid ${tc}`,
          borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 900, fontSize: 13, color: tc, letterSpacing: '-0.5px',
          flexShrink: 0,
        }}>{team.abbr || '—'}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'white', lineHeight: 1.2 }}>
            {team.name || team.abbr}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {side === 'visitor' ? 'Away' : 'Home'}
          </div>
        </div>
      </div>

      {/* Expected lineup */}
      <div style={{ padding: '8px 16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: 6, marginTop: 4,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
            display: 'inline-block', flexShrink: 0,
            boxShadow: '0 0 5px #22c55e80',
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Expected Lineup
          </span>
        </div>
        {expected.length > 0
          ? expected.map((p, i) => <PlayerRow key={p.name + i} player={p} />)
          : <div style={{ color: '#4b5563', fontSize: 12, padding: '8px 0', fontStyle: 'italic' }}>
              Lineup not yet available
            </div>
        }
      </div>

      {/* May not play */}
      {out.length > 0 && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
              display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              May Not Play
            </span>
          </div>
          {out.map((p, i) => <PlayerRow key={p.name + i} player={p} />)}
        </div>
      )}
    </div>
  )
}

function GameCard({ game }) {
  const vColor = TEAM_COLORS[game.visitor?.abbr] || '#FF6900'
  const hColor = TEAM_COLORS[game.home?.abbr]    || '#FF6900'

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
      {/* Game header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'linear-gradient(135deg, #0f0f0f 0%, #161616 100%)',
        borderBottom: '1px solid #222',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#FF6900', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {game.gameTime || 'TBD'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: vColor }}>{game.visitor?.abbr}</span>
          <span style={{ color: '#4b5563', fontSize: 11 }}>@</span>
          <span style={{ color: hColor }}>{game.home?.abbr}</span>
        </div>
      </div>

      {/* Two-column lineup */}
      <div style={{ display: 'flex' }}>
        <TeamColumn team={game.visitor} side="visitor" />
        <div style={{ width: 1, background: '#1f1f1f', flexShrink: 0 }} />
        <TeamColumn team={game.home} side="home" />
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: '10px 16px', background: '#0f0f0f', borderBottom: '1px solid #222', height: 40 }} />
      <div style={{ display: 'flex', minHeight: 280 }}>
        {[0, 1].map(i => (
          <div key={i} style={{ flex: 1, padding: 16 }}>
            <div style={{ height: 60, background: '#161616', borderRadius: 8, marginBottom: 12, animation: 'wnbaPulseOrange 1.5s ease-in-out infinite' }} />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} style={{ height: 30, background: '#111', borderRadius: 6, marginBottom: 6, opacity: 1 - j * 0.12, animation: 'wnbaPulseOrange 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Lineups() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const json = await fetchWnbaData('wnba/lineups.json')
        if (cancelled) return
        setData(Array.isArray(json) ? json : [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'white', margin: '0 0 4px' }}>
          WNBA Daily Lineups
        </h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          {today} · Expected starting lineups scraped from RotoWire
        </p>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 18, flexWrap: 'wrap',
        marginBottom: 20,
        padding: '10px 16px',
        background: '#0f0f0f',
        borderRadius: 10,
        border: '1px solid #1f1f1f',
      }}>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>
              {cfg.label || 'Expected'}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {[['G', 'Guard'], ['F', 'Forward'], ['C', 'Center']].map(([abbr, full]) => (
            <div key={abbr} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 20, height: 20, borderRadius: 5,
                background: posColor(full) + '22', color: posColor(full),
                fontSize: 10, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{abbr}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{full}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          padding: '16px 20px',
          background: '#1a0a0a',
          border: '1px solid #3b1a1a',
          borderRadius: 10, color: '#f87171', fontSize: 13, marginBottom: 20,
        }}>
          ⚠ Could not load lineups: {error}. The page will retry on next load.
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !data && (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {/* Games */}
      {data && data.length === 0 && !loading && (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          color: '#4b5563', fontSize: 14,
          background: '#0f0f0f', borderRadius: 12, border: '1px solid #1f1f1f',
        }}>
          No lineups available for today's slate yet. Check back closer to game time.
        </div>
      )}

      {data && data.map((game, i) => (
        <GameCard key={i} game={game} />
      ))}
    </div>
  )
}
