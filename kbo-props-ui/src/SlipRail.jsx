import { useEffect, useMemo, useState } from 'react'
import './SlipRail.css'
import { formatBreakEvenRate } from './prizepicksBreakeven'
import { STANDARD_LINE } from './responsibleGambling'
import { sessionAccessToken } from './supabaseClient'
import { isPromoLine, matchImportedPick } from './slipLines'
import { slipSport, sportDate } from './slipSports'
import {
  PAYOUT_ENTRY,
  RAIL_SPORTS,
  addLeg,
  cardAverage,
  estimateFor,
  l10Text,
  ladderFor,
  markSources,
  railPlayerKey,
  rankedRows,
  rowKey,
  shownCg,
  sideCounts,
  slateLabel,
  unpackSlipLoad,
} from './slipRailModel'

function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function Mark({ sport, row }) {
  const sources = markSources(sport, row, 44)
  const [step, setStep] = useState(sources.head ? 'head' : sources.logo ? 'logo' : 'badge')
  if (step === 'head') {
    return <img className="sr-av" src={sources.head} alt="" width="44" height="44" onError={() => setStep(sources.logo ? 'logo' : 'badge')} />
  }
  if (step === 'logo') {
    return <span className="sr-av"><img src={sources.logo} alt="" onError={() => setStep('badge')} /></span>
  }
  return <span className="sr-av sr-badge" style={{ background: sources.fill, color: sources.ink }}>{sources.abbr}</span>
}

function PayoutPanel({ legs, mode, setMode, onSave, onCopy, saving, notice }) {
  const count = legs.length
  const ladder = ladderFor(mode)
  const estimate = estimateFor(mode, count)
  const avg = cardAverage(legs)
  const counts = sideCounts(legs)
  const altered = legs.some((leg) => isPromoLine(leg))
  return (
    <aside className="sr-side">
      <div className="sr-panel" data-testid="slip-payout">
        <h2>Payout preview</h2>
        <div className="sr-modes" role="group" aria-label="Payout mode">
          <button type="button" className={mode === 'power' ? 'is-on' : ''} onClick={() => setMode('power')}>Power</button>
          <button type="button" className={mode === 'flex' ? 'is-on' : ''} onClick={() => setMode('flex')}>Flex</button>
        </div>
        <div className="sr-ladder">
          {ladder.map((cell) => (
            <div key={cell.picks} className={cell.picks === count ? 'is-on' : ''}>
              <small>{cell.picks} PICKS</small>
              <b>{cell.dollars}</b>
            </div>
          ))}
        </div>
        <div className="sr-stats">
          <div><span>ENTRY</span><b>${PAYOUT_ENTRY}</b></div>
          <div>
            <span>EST. PAYOUT</span>
            <b className="is-good" data-testid="slip-est-pay">{estimate.dollars}</b>
            {estimate.breakeven == null ? null : <small>Break-even {formatBreakEvenRate(estimate.breakeven)}</small>}
          </div>
          <div><span>AVG CG SCORE</span><b className="is-good">{avg == null ? '—' : fmt(avg)}</b></div>
          <div><span>MORE / LESS</span><b>{counts.more} / {counts.less}</b></div>
        </div>
        {altered ? <p className="sr-note">Altered payout</p> : null}
        <div className="sr-actions">
          <button type="button" className="is-save" onClick={onSave} disabled={saving || count === 0}>{saving ? 'Saving…' : 'Save slip'}</button>
          <button type="button" className="is-copy" onClick={onCopy} disabled={count === 0}>Copy</button>
        </div>
        {notice ? <p className="sr-note">{notice}</p> : null}
      </div>
      <p className="sr-rg">{STANDARD_LINE}</p>
    </aside>
  )
}

export default function SlipRail({ sport = 'nfl', onSport }) {
  const config = slipSport(sport)
  const [props, setProps] = useState([])
  const [empty, setEmpty] = useState(null)
  const [loading, setLoading] = useState(true)
  const [legs, setLegs] = useState([])
  const [mode, setMode] = useState('power')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLegs([])
    setNotice('')
    config.loadProps().then((result) => {
      if (cancelled) return
      const unpacked = unpackSlipLoad(result)
      setProps(unpacked.props)
      setEmpty(unpacked.empty)
      if (!config.importKey || typeof localStorage === 'undefined') return
      try {
        const raw = localStorage.getItem(config.importKey)
        if (!raw) return
        localStorage.removeItem(config.importKey)
        const picks = JSON.parse(raw)
        if (!Array.isArray(picks)) return
        let next = []
        for (const pick of picks) {
          const index = matchImportedPick(unpacked.props, pick)
          if (index < 0) continue
          const row = unpacked.props[index]
          const wanted = String(pick?.side || '').toUpperCase()
          const side = isPromoLine(row) || wanted === 'OVER' || wanted === 'MORE' || wanted === '' ? 'MORE' : 'LESS'
          next = addLeg(next, row, side)
        }
        if (next.length) setLegs(next)
      } catch { /* ignore a bad import */ }
    }).catch(() => {
      if (!cancelled) {
        setProps([])
        setEmpty({ title: 'Board unavailable', detail: 'The board did not load.' })
      }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [config])

  const visible = useMemo(() => rankedRows(props), [props])
  const games = slateLabel(visible.length ? visible : props)

  const choose = (row, side) => {
    const next = addLeg(legs, row, side)
    const duplicate = next === legs && legs.some((leg) => leg.key !== rowKey(row) && railPlayerKey(leg) && railPlayerKey(leg) === railPlayerKey(row))
    if (duplicate) setNotice('One prop per player.')
    else if (next !== legs) setNotice('')
    setLegs(next)
  }

  const copyPicks = async () => {
    const text = legs.map((leg) => `${leg.name} · ${leg.prop} ${fmt(leg.line)} · ${leg.side === 'LESS' ? 'Less' : 'More'} · CG ${fmt(shownCg(leg))}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Picks copied.')
    } catch {
      setNotice(text)
    }
  }

  const saveSlip = async () => {
    if (!legs.length) return
    const token = await sessionAccessToken().catch(() => null)
    if (!token) {
      setNotice('Sign in to save this slip.')
      return
    }
    setSaving(true)
    try {
      const avg = cardAverage(legs)
      const response = await fetch('/api/saved-slips', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_date: sportDate(config.timeZone),
          confidence: avg == null ? null : Math.round(avg),
          legs: legs.map((leg) => ({
            name: leg.name, team: leg.team, opponent: leg.opponent, prop: leg.prop,
            line: leg.line, projection: leg.projection,
            side: leg.side === 'LESS' ? 'UNDER' : 'OVER', odds_type: leg.odds_type,
          })),
        }),
      })
      setNotice(response.ok ? 'Slip saved.' : 'The slip could not be saved.')
    } catch {
      setNotice('The slip could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="sr" data-testid="slip-rail">
      <div className="sr-pills" role="tablist" aria-label="Sport">
        {RAIL_SPORTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={item.id === config.id ? 'sr-pill is-on' : 'sr-pill'}
            aria-selected={item.id === config.id}
            data-testid={`slip-pill-${item.id}`}
            onClick={() => onSport?.(item.id)}
          >
            <i />
            {item.label}
          </button>
        ))}
      </div>
      <div className="sr-lay">
        <nav className="sr-rail" aria-label="Sport">
          {RAIL_SPORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === config.id ? 'sr-sport is-on' : 'sr-sport'}
              aria-current={item.id === config.id ? 'true' : undefined}
              data-testid={`slip-rail-${item.id}`}
              onClick={() => onSport?.(item.id)}
            >
              <i />
              {item.label}
            </button>
          ))}
        </nav>
        <main className="sr-main">
          <h1 className="sr-title">{config.id.toUpperCase()} <span>slip</span></h1>
          {games ? <small className="sr-game">{games}</small> : null}
          {loading ? <p className="sr-loading">Loading the board…</p> : null}
          {!loading && empty ? (
            <section className="sr-empty" data-testid="slip-empty-slate">
              <h2>{empty.title}</h2>
              <p>{empty.detail}</p>
            </section>
          ) : null}
          {!loading && !empty && visible.length === 0 ? (
            <section className="sr-empty" data-testid="slip-empty-slate">
              <h2>No live lines</h2>
              <p>Started and unavailable lines stay off this board.</p>
            </section>
          ) : null}
          {!loading && visible.length > 0 ? (
            <div className="sr-board">
              {visible.map((row) => {
                const key = rowKey(row)
                const leg = legs.find((item) => item.key === key)
                const score = shownCg(row)
                const promo = isPromoLine(row)
                return (
                  <article key={key} className="sr-row" data-testid="slip-row">
                    <div className="sr-who">
                      <Mark sport={config.id} row={row} />
                      <div>
                        <b className="sr-name">{row.name}</b>
                        <small className="sr-meta">{[row.team, row.position].filter(Boolean).join(' ')}{row.position || row.team ? ' · ' : ''}{row.prop} {fmt(row.line)}</small>
                      </div>
                    </div>
                    <div className="sr-play">
                      <div className="sr-metrics">
                        <span className="sr-cg"><small>CG</small>{fmt(score)}</span>
                        <span className="sr-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, score || 0))}%` }} /></span>
                        <span className="sr-line">LINE <b>{fmt(row.line)}</b></span>
                      </div>
                      <div className="sr-sub">PROJ <b>{fmt(row.projection)}</b> · L10 <b>{l10Text(row)}</b></div>
                      <div className="sr-sides">
                        <button type="button" className={leg?.side === 'MORE' ? 'is-more' : ''} onClick={() => choose(row, 'MORE')}>More</button>
                        <button type="button" className={leg?.side === 'LESS' ? 'is-less' : ''} disabled={promo} title={promo ? 'More only' : undefined} onClick={() => choose(row, 'LESS')}>Less</button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </main>
        <PayoutPanel legs={legs} mode={mode} setMode={setMode} onSave={saveSlip} onCopy={copyPicks} saving={saving} notice={notice} />
      </div>
    </section>
  )
}
