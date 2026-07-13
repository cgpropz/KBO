import { useMemo, useState, useEffect } from 'react'
import { fetchWnbaData } from './wnbaData'
import L10HitRateChart from './components/L10HitRateChart'

const EXCLUDED_PROP_LABELS = new Set(['Points - 1st 3 Minutes'])

const PROP_PROJECTION = {
  Points: p => p.projPts,
  Rebounds: p => p.projReb,
  Assists: p => p.projAst,
  '3-PT Made': p => p.projFg3m,
  Steals: p => p.projStl,
  Blocks: p => p.projBlk,
  Turnovers: p => p.projTov,
  'Offensive Rebounds': p => p.projOreb,
  'Defensive Rebounds': p => p.projDreb,
  'Fantasy Score': p => p.projFantasy,
  'Reb+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Rebs+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs': p => (p.projPts ?? 0) + (p.projReb ?? 0),
  'Pts+Asts': p => (p.projPts ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs+Asts': p => (p.projPts ?? 0) + (p.projReb ?? 0) + (p.projAst ?? 0),
  'Double-Double': p => p.projDoubleDouble,
  'Triple-Double': p => p.projTripleDouble,
}

// Compute a game's actual value for a prop so we can derive L10 hit rates client-side.
const GAME_STAT_VALUE = {
  Points: g => g.pts ?? 0,
  Rebounds: g => g.reb ?? 0,
  Assists: g => g.ast ?? 0,
  '3-PT Made': g => g.fg3m ?? 0,
  Steals: g => g.stl ?? 0,
  Blocks: g => g.blk ?? 0,
  Turnovers: g => g.tov ?? 0,
  'Offensive Rebounds': g => g.oreb ?? 0,
  'Defensive Rebounds': g => g.dreb ?? 0,
  'Fantasy Score': g => g.fantasy ?? 0,
  'Reb+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Rebs+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Pts+Rebs': g => (g.pts ?? 0) + (g.reb ?? 0),
  'Pts+Asts': g => (g.pts ?? 0) + (g.ast ?? 0),
  'Pts+Rebs+Asts': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
}

const STAT_CHIPS = ['All', 'Points', 'Rebounds', 'Assists', '3-PT Made', 'Fantasy Score', 'Pts+Rebs+Asts']

function fmtScore(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(1)
}

function spreadColor(spread) {
  if (spread == null || Number.isNaN(spread)) return '#4b5563'
  const abs = Math.abs(spread)
  const to3 = [34, 197, 94], mid5 = [229, 229, 229], from7 = [239, 68, 68]
  const lerp = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const [f, t_, pct] = abs <= 5 ? [to3, mid5, (abs - 3) / 2] : [mid5, from7, (abs - 5) / 2]
  return `rgb(${lerp(f[0], t_[0], pct)},${lerp(f[1], t_[1], pct)},${lerp(f[2], t_[2], pct)})`
}

function fmtSpread(spread) {
  if (spread == null || Number.isNaN(spread)) return 'Spread —'
  return `Spread ${spread > 0 ? '+' : ''}${spread.toFixed(1)}`
}

function fmtDvpFactor(value) {
  if (value == null || Number.isNaN(value)) return '1.00x'
  return `${value.toFixed(2)}x`
}

function hitColor(pct) {
  if (pct == null) return '#4b5563'
  const from = [239, 68, 68], mid = [180, 180, 180], to = [34, 197, 94]
  const lerp = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const [f, t_, p] = pct <= 50 ? [from, mid, pct / 50] : [mid, to, (pct - 50) / 50]
  return `rgb(${lerp(f[0], t_[0], p)},${lerp(f[1], t_[1], p)},${lerp(f[2], t_[2], p)})`
}

function computeHit(recentGames, stat, line) {
  const getter = GAME_STAT_VALUE[stat]
  const numericLine = Number(line)
  if (!getter || !Number.isFinite(numericLine)) return null
  const slice = (recentGames || []).slice(0, 10)
  if (!slice.length) return null
  let hits = 0
  let counted = 0
  slice.forEach(g => {
    const v = getter(g)
    if (v == null) return
    counted += 1
    if (v > numericLine) hits += 1
  })
  if (!counted) return null
  return { hits, total: counted, pct: (hits / counted) * 100 }
}

function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2) || '?'
}

// ── Small presentational pieces ───────────────────────────────────────────────
function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <p className="stat-label" style={{ margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color, margin: '6px 0 2px', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{sub}</p>}
    </div>
  )
}

function InsightPanel({ title, kicker, accent, children }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, boxShadow: `0 0 10px ${accent}` }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'white', letterSpacing: 0.2 }}>{title}</h3>
        {kicker && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{kicker}</span>}
      </div>
      {children}
    </div>
  )
}

function MiniRow({ rank, player, stat, side, primary, primaryColor, sub, onClick, last }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 0', cursor: 'pointer',
        borderBottom: last ? 'none' : '1px solid #161616',
      }}
    >
      <span style={{ width: 16, fontSize: 11, fontWeight: 800, color: rank === 1 ? primaryColor : '#4b5563', textAlign: 'center' }}>{rank}</span>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: '#12231f', border: '1px solid #1f3f3d',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 800, color: '#7efc6a',
      }}>
        {player.image
          ? <img src={player.image} alt={player.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
          : initials(player.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b94a9' }}>{player.team}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa' }}>{stat}</span>
          {side && (
            <span style={{ fontSize: 9, fontWeight: 800, color: side === 'OVER' ? '#22c55e' : '#ef4444' }}>{side}</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: primaryColor }}>{primary}</p>
        {sub && <p style={{ margin: 0, fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard({ onSelectPlayer, onNavigate }) {
  const [projections, setProjections] = useState(null)
  const [players, setPlayers] = useState(null)
  const [projLoading, setProjLoading] = useState(true)

  const [statFilter, setStatFilter] = useState('All')
  const [sideFilter, setSideFilter] = useState('All')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setProjLoading(true)
      try {
        const [pr, pl] = await Promise.all([
          fetchWnbaData('wnba/projections_standard.json'),
          fetchWnbaData('wnba/players.json'),
        ])
        if (cancelled) return
        setProjections(Array.isArray(pr) ? pr : [])
        setPlayers(Array.isArray(pl) ? pl : [])
      } catch {
        if (!cancelled) { setProjections([]); setPlayers([]) }
      } finally {
        if (!cancelled) setProjLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const totalPlayers = players?.length ?? 0
  const totalGames = projections ? projections.reduce((s, p) => s + (p.gp ?? 0), 0) : 0

  // Flatten every prop into a scored row (score = projection / line × 50), mirroring the Projections page.
  const allRows = useMemo(() => {
    if (!projections) return []
    const rows = []
    projections.forEach(player => {
      const props = (player.ppAllProps || []).filter(prop => !EXCLUDED_PROP_LABELS.has(prop?.stat))
      props.forEach(prop => {
        const line = Number(prop.line)
        const projectionFn = PROP_PROJECTION[prop.stat]
        const projection = prop.projection ?? (projectionFn ? projectionFn(player) : null)
        if (projection == null || !Number.isFinite(line) || line <= 0) return
        const score = (projection / line) * 50
        const standardLine = prop.standardLine ?? line
        rows.push({
          key: `${player.name}-${prop.stat}`,
          player,
          stat: prop.stat,
          line,
          standardLine,
          versus: prop.versus ?? null,
          opponent: prop.opponent ?? null,
          projection,
          score,
          side: projection > line ? 'OVER' : projection < line ? 'UNDER' : 'PUSH',
          edgePct: ((projection - line) / line) * 100,
          hit: computeHit(player.recentGames, prop.stat, standardLine),
          spread: player.spread ?? null,
          recentGames: player.recentGames || [],
        })
      })
    })
    return rows
  }, [projections])

  // De-dupe helper: keep only each player's single best row for a given ordering.
  const dedupePlayers = (rows, limit) => {
    const seen = new Set()
    const out = []
    for (const row of rows) {
      if (seen.has(row.player.name)) continue
      seen.add(row.player.name)
      out.push(row)
      if (out.length === limit) break
    }
    return out
  }

  const q = search.trim().toLowerCase()
  const matchesSearch = row => !q || row.player.name.toLowerCase().includes(q)

  // Board: top plays, filtered by stat + side + search, best prop per player.
  const topPlays = useMemo(() => {
    const filtered = allRows.filter(r =>
      matchesSearch(r) &&
      (statFilter === 'All' || r.stat === statFilter) &&
      (sideFilter === 'All' || r.side === sideFilter)
    )
    filtered.sort((a, b) => b.score - a.score)
    return dedupePlayers(filtered, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, statFilter, sideFilter, q])

  const hotStreaks = useMemo(() => {
    const filtered = allRows
      .filter(r => matchesSearch(r) && r.hit && r.hit.total >= 5)
      .sort((a, b) => (b.hit.pct - a.hit.pct) || (b.score - a.score))
    return dedupePlayers(filtered, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, q])

  const bestValue = useMemo(() => {
    const filtered = allRows
      .filter(r => matchesSearch(r) && r.side === 'OVER')
      .sort((a, b) => b.edgePct - a.edgePct)
    return dedupePlayers(filtered, 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, q])

  const slate = useMemo(() => {
    const seen = new Map()
    allRows.forEach(r => {
      const a = (r.player.team || '').toUpperCase()
      const b = (r.opponent || '').toUpperCase()
      if (!a || !b) return
      const [t1, t2] = [a, b].sort()
      const key = `${t1}_${t2}`
      const entry = seen.get(key) || { key, label: `${t1} vs ${t2}`, count: 0 }
      entry.count += 1
      seen.set(key, entry)
    })
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 8)
  }, [allRows])

  const avgTopScore = useMemo(() => {
    if (!allRows.length) return null
    const top = [...allRows].sort((a, b) => b.score - a.score).slice(0, 10)
    return top.reduce((s, r) => s + r.score, 0) / top.length
  }, [allRows])

  const goPlayer = name => onSelectPlayer?.(name)
  const goProjections = () => onNavigate?.('projections')

  return (
    <div className="fade-in">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 18, padding: '26px 28px', marginBottom: 20,
        background: 'linear-gradient(120deg, rgba(255,105,0,0.14) 0%, rgba(8,14,16,0.6) 42%, rgba(126,252,106,0.10) 100%)',
        border: '1px solid #1c2b26',
        boxShadow: 'inset 0 0 0 1px rgba(126,252,106,0.06), 0 12px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: '#7efc6a' }}>
              WNBA 2026 · Daily Edge
            </p>
            <h1 style={{
              margin: '6px 0 0', fontSize: 38, fontWeight: 900, lineHeight: 1.05,
              background: 'linear-gradient(135deg, #fff 0%, #9ca3af 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Today's Best <span style={{ WebkitTextFillColor: '#FF6900' }}>Player Props</span>
            </h1>
            <p style={{ margin: '8px 0 0', color: '#9aa4b2', fontSize: 13 }}>
              Ranked by projection edge · one prop per player · standard PrizePicks lines
            </p>
          </div>
          <button className="btn-orange" onClick={goProjections}>
            View All Projections →
          </button>
        </div>

        {/* Search + category chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
            <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7efc6a" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="edge-search"
              style={{ width: '100%', padding: '10px 12px 10px 34px', fontSize: 13 }}
              placeholder="Search players on the board..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STAT_CHIPS.map(chip => {
              const active = statFilter === chip
              return (
                <button
                  key={chip}
                  onClick={() => setStatFilter(chip)}
                  style={{
                    padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: '1px solid', transition: 'all 0.15s',
                    borderColor: active ? '#7efc6a' : '#1f3f3d',
                    background: active ? 'rgba(126,252,106,0.14)' : 'rgba(11,18,24,0.6)',
                    color: active ? '#7efc6a' : '#8b94a9',
                  }}
                >{chip === 'Pts+Rebs+Asts' ? 'PRA' : chip}</button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── KPI strip ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Active Players" value={totalPlayers} sub="2025–2026 roster" color="#FF6900" />
        <KpiCard label="Games Logged" value={projLoading ? '…' : totalGames.toLocaleString()} sub="combined 2025+2026" color="#3b82f6" />
        <KpiCard label="Props on Board" value={projLoading ? '…' : allRows.length.toLocaleString()} sub="scored & rated" color="#a855f7" />
        <KpiCard label="Avg Top Score" value={avgTopScore != null ? avgTopScore.toFixed(1) : '…'} sub="top 10 plays" color="#22c55e" />
      </div>

      {/* ── Today's Top Plays ────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>Today's Top Plays</h2>
          <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{topPlays.length} shown</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All', 'OVER', 'UNDER'].map(v => {
            const active = sideFilter === v
            const c = v === 'OVER' ? '#22c55e' : v === 'UNDER' ? '#ef4444' : '#FF6900'
            return (
              <button
                key={v}
                onClick={() => setSideFilter(v)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  border: '1px solid', letterSpacing: 0.4,
                  borderColor: active ? c : '#222',
                  background: active ? `${c}18` : 'transparent',
                  color: active ? c : '#6b7280',
                }}
              >{v === 'All' ? 'ALL' : v}</button>
            )
          })}
        </div>
      </div>

      <div className="edge-grid" style={{ marginBottom: 28 }}>
        {projLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={`skeleton-${i}`} className="edge-card" style={{ minHeight: 222, opacity: 0.55 }} />
        ))}

        {!projLoading && topPlays.map(card => {
          const { player, line, standardLine, projection, stat, score, spread, opponent, versus, recentGames } = card
          const matchupTag = opponent ? `vs ${opponent}` : (versus || 'vs —')
          return (
            <article
              key={card.key}
              className="edge-card"
              onClick={() => goPlayer(player.name)}
            >
              <div className="edge-chip-row">
                <span className="edge-chip">{(player.avgMins ?? 0).toFixed(1)} min</span>
                <span className="edge-chip" style={{ color: spreadColor(spread) }}>{fmtSpread(spread)}</span>
              </div>

              <div className="edge-player">
                {player.image ? (
                  <img src={player.image} alt={player.name} className="edge-headshot" loading="lazy" />
                ) : (
                  <div className="edge-headshot" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    background: '#12231f',
                    border: '1px solid #1f3f3d',
                    color: '#7efc6a',
                    fontSize: 22,
                    fontWeight: 800,
                  }}>
                    {initials(player.name)}
                  </div>
                )}
                <div>
                  <p className="edge-name">{player.name}</p>
                  <div className="edge-tags">
                    <span className="edge-team-tag">{player.team}</span>
                    <span className="edge-vs-tag" title={versus || matchupTag}>{matchupTag}</span>
                  </div>
                </div>
              </div>

              <div className="edge-prop-pill">{stat}</div>

              <div className="edge-stats-row">
                <div>
                  <p className="edge-stat-label">Line</p>
                  <p className="edge-stat-value">{line}</p>
                </div>
                <div>
                  <p className="edge-stat-label">Projection</p>
                  <p className="edge-stat-value">{projection != null ? projection.toFixed(1) : '—'}</p>
                </div>
                <div>
                  <p className="edge-stat-label">Score</p>
                  <p className="edge-stat-value edge-score">{fmtScore(score)}</p>
                </div>
                <div>
                  <p className="edge-stat-label">{String(player.position || 'DVP').charAt(0).toUpperCase()} DVP</p>
                  <p className="edge-stat-value">{fmtDvpFactor(player.dvpFactor)}</p>
                </div>
              </div>

              <L10HitRateChart games={recentGames} stat={stat} line={standardLine ?? line} />
            </article>
          )
        })}

        {!projLoading && topPlays.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: '#8b94a9', gridColumn: '1 / -1' }}>
            No props match these filters. Try clearing the search or switching stat/side.
          </div>
        )}
      </div>

      {/* ── Insight panels ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <InsightPanel title="Hottest Streaks" kicker="L10 hit rate" accent="#22c55e">
          {projLoading
            ? Array(5).fill(0).map((_, i) => <div key={i} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : hotStreaks.length
              ? hotStreaks.map((r, i) => (
                  <MiniRow
                    key={r.key} rank={i + 1} player={r.player} stat={r.stat} side="OVER"
                    primary={`${r.hit.pct.toFixed(0)}%`} primaryColor={hitColor(r.hit.pct)}
                    sub={`${r.hit.hits}/${r.hit.total} · line ${r.standardLine}`}
                    onClick={() => goPlayer(r.player.name)}
                    last={i === hotStreaks.length - 1}
                  />
                ))
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>Not enough game history yet.</p>}
        </InsightPanel>

        <InsightPanel title="Best Value Edges" kicker="proj vs line" accent="#FF6900">
          {projLoading
            ? Array(5).fill(0).map((_, i) => <div key={i} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : bestValue.length
              ? bestValue.map((r, i) => (
                  <MiniRow
                    key={r.key} rank={i + 1} player={r.player} stat={r.stat} side="OVER"
                    primary={`+${r.edgePct.toFixed(0)}%`} primaryColor="#FF6900"
                    sub={`proj ${r.projection.toFixed(1)} · line ${r.line}`}
                    onClick={() => goPlayer(r.player.name)}
                    last={i === bestValue.length - 1}
                  />
                ))
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No value edges available.</p>}
        </InsightPanel>

        <InsightPanel title="Today's Slate" kicker={`${slate.length} matchups`} accent="#3b82f6">
          {projLoading
            ? Array(5).fill(0).map((_, i) => <div key={i} style={{ height: 36, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : slate.length
              ? slate.map((m, i) => (
                  <div
                    key={m.key}
                    onClick={goProjections}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '9px 0', borderBottom: i === slate.length - 1 ? 'none' : '1px solid #161616',
                    }}
                  >
                    <span style={{ width: 16, fontSize: 11, fontWeight: 800, color: '#4b5563', textAlign: 'center' }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: 0.3 }}>{m.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', background: '#3b82f618', padding: '2px 9px', borderRadius: 999 }}>{m.count} props</span>
                  </div>
                ))
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No matchups posted yet.</p>}
        </InsightPanel>
      </div>
    </div>
  )
}
