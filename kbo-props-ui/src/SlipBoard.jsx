import { useEffect, useMemo, useState } from 'react'
import './SlipBoard.css'
import { sessionAccessToken } from './supabaseClient'
import { correlationSuggestions } from './slipCorrelations'
import { isPromoLine, matchImportedPick } from './slipLines'
import { loadCorrelations, slipSport, sportDate } from './slipSports'
import { playerKey } from './slipRank'
import {
  FLEX_VARIANCE,
  PAIRS_WELL_LABEL,
  SAME_GAME_WARNING,
  SLIP_BETA_FOOTER,
  WORKS_AGAINST_LABEL,
  correlationTooltip,
  slipSharesTeamOrGame,
} from './slipBetaCopy'
import {
  PAYOUT_ENTRY,
  SLIP_RAIL,
  addLeg,
  boardRows,
  cardAverage,
  estimateFor,
  ladderFor,
  l10Text,
  markSources,
  matchupLabel,
  naturalSide,
  rowKey,
  shownCg,
  unpackSlipLoad,
} from './slipBoardModel'

function CorrRow({ item, onAdd }) {
  const games = Number(item?.n)
  return (
    <button type="button" className="b2-corr-row" onClick={() => onAdd(item.idx)}>
      <span className="b2-corr-name">
        {item.name}
        {item.propShort || item.prop ? <span className="b2-corr-prop">{item.propShort || item.prop}</span> : null}
      </span>
      <span className="b2-corr-meta">
        {Number.isFinite(games) ? `${games} games` : null}
        {item.smallSample ? <span className="b2-corr-sample">small sample</span> : null}
      </span>
      <span className="b2-corr-add">Add</span>
    </button>
  )
}

function CorrColumn({ title, rows, empty, onAdd, tooltip, testId }) {
  return (
    <div data-testid={testId}>
      <h3 className="b2-corr-title" title={tooltip}>{title}</h3>
      {rows.length === 0 ? <p className="b2-corr-empty">{empty}</p> : rows.map((item) => (
        <CorrRow key={`${testId}-${item.idx}`} item={item} onAdd={onAdd} />
      ))}
    </div>
  )
}

function CorrelationBlock({ sport, suggestions, mode, onAdd }) {
  const tooltip = correlationTooltip(sport)
  const pairs = suggestions?.pairsWell || []
  const against = suggestions?.worksAgainst || []
  const hasPairs = pairs.length > 0 || against.length > 0
  return (
    <section className="b2-corr" data-testid="slip-correlations" aria-label="Correlated props">
      <p className="b2-corr-note">{tooltip}</p>
      {hasPairs ? <p className="b2-corr-warn" data-testid="same-game-warning">{SAME_GAME_WARNING}</p> : null}
      {mode === 'flex' && hasPairs ? <p className="b2-corr-flex">{FLEX_VARIANCE}</p> : null}
      <div className="b2-corr-cols">
        <CorrColumn
          title={PAIRS_WELL_LABEL}
          rows={pairs}
          empty="No teammates or opponents on today's board hit with these legs often enough."
          onAdd={onAdd}
          tooltip={tooltip}
          testId="slip-pairs-well"
        />
        <CorrColumn
          title={WORKS_AGAINST_LABEL}
          rows={against}
          empty="Nothing on today's board disagrees with these legs often enough."
          onAdd={onAdd}
          tooltip={tooltip}
          testId="slip-works-against"
        />
      </div>
    </section>
  )
}

function fmt(value, digits = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(digits)
}

function fmtCg(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(1) : '—'
}

function Mark({ sport, row, size = 52 }) {
  const sources = markSources(sport, row, size)
  const initial = sources.head ? 'head' : sources.logo ? 'logo' : 'badge'
  const [step, setStep] = useState(initial)
  if (step === 'head') {
    return (
      <img
        className="b2-av"
        src={sources.head}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setStep(sources.logo ? 'logo' : 'badge')}
      />
    )
  }
  if (step === 'logo') {
    return (
      <span className="b2-av b2-logo" data-fallback="logo">
        <img
          src={sources.logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setStep('badge')}
        />
      </span>
    )
  }
  return (
    <span className="b2-av b2-badge" data-fallback="badge" style={{ background: sources.fill, color: sources.ink }}>
      {sources.abbr}
    </span>
  )
}

function SlipSheet({ sport, legs, mode, setMode, onSave, onCopy, saving, notice, suggestions, onAdd }) {
  const altered = legs.some((leg) => isPromoLine(leg))
  const ladder = ladderFor(mode, altered)
  const estimate = estimateFor(mode, legs.length, altered)
  const avg = cardAverage(legs)
  return (
    <div className="b2-sheet" data-testid="slip-drawer">
      <span className="b2-grab" />
      <h2>Your slip · {legs.length} {legs.length === 1 ? 'pick' : 'picks'}</h2>
      {legs.map((leg) => (
        <div className="b2-leg" key={leg.key}>
          <Mark sport={sport} row={leg} size={42} />
          <div>
            <b>{leg.name}</b>
            <small>{leg.prop} {fmt(leg.line)}</small>
          </div>
          <div className="b2-leg-score">
            {fmtCg(shownCg(leg))}
            <em className={leg.side === 'LESS' ? 'b2-side-pill is-less' : 'b2-side-pill is-more'}>
              {leg.side === 'LESS' ? 'Less' : 'More'}
            </em>
          </div>
        </div>
      ))}
      <div className="b2-modes" role="group" aria-label="Payout mode">
        <button type="button" className={mode === 'power' ? 'is-on' : ''} onClick={() => setMode('power')}>Power</button>
        <button type="button" className={mode === 'flex' ? 'is-on' : ''} onClick={() => setMode('flex')}>Flex</button>
      </div>
      <div className="b2-ladder" data-testid="slip-ladder">
        {ladder.map((cell) => (
          <div key={cell.picks} className={cell.picks === legs.length ? 'is-on' : ''}>
            <small>{cell.picks} picks</small>
            {cell.dollars}
          </div>
        ))}
      </div>
      <div className="b2-sum">
        <div><span>ENTRY</span><b>${PAYOUT_ENTRY}</b></div>
        <div><span>AVG CG</span><b className="is-good">{avg == null ? '—' : avg.toFixed(1)}</b></div>
        <div><span>EST. PAY</span><b data-testid="slip-est-pay">{estimate.dollars}</b></div>
      </div>
      {estimate.breakeven == null ? <p className="b2-break">Pick 2 to 6 for a payout</p> : null}
      {altered ? <p className="b2-break"><em>Altered payout</em></p> : null}
      {slipSharesTeamOrGame(legs) ? <p className="b2-corr-warn" data-testid="slip-same-game">{SAME_GAME_WARNING}</p> : null}
      {legs.length > 0 ? (
        <CorrelationBlock sport={sport} suggestions={suggestions} mode={mode} onAdd={onAdd} />
      ) : null}
      <div className="b2-cta">
        <button type="button" className="is-primary" onClick={onSave} disabled={saving || legs.length === 0}>
          {saving ? 'Saving…' : 'Save slip'}
        </button>
        <button type="button" className="is-secondary" onClick={onCopy} disabled={legs.length === 0}>Copy picks</button>
      </div>
      {notice ? <p className="b2-note">{notice}</p> : null}
      <p className="b2-rg">{SLIP_BETA_FOOTER}</p>
    </div>
  )
}

export default function SlipBoard({ sport = 'nhl', onSport, drawer = false }) {
  const config = slipSport(sport)
  const [props, setProps] = useState([])
  const [empty, setEmpty] = useState(null)
  const [loading, setLoading] = useState(true)
  const [legs, setLegs] = useState([])
  const [open, setOpen] = useState(drawer === true)
  const [mode, setMode] = useState('power')
  const [sortDesc, setSortDesc] = useState(true)
  const [sortOpen, setSortOpen] = useState(false)
  const [propId, setPropId] = useState('all')
  const [propOpen, setPropOpen] = useState(false)
  const [moreOnly, setMoreOnly] = useState(false)
  const [standardOnly, setStandardOnly] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [correlations, setCorrelations] = useState({ pairs: [], minShared: config.minShared })

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
      } catch { /* a bad import stays off the slip */ }
    }).catch(() => {
      if (!cancelled) {
        setProps([])
        setEmpty({ title: 'Board unavailable', detail: 'The board did not load.' })
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [config])

  useEffect(() => {
    let cancelled = false
    loadCorrelations(config.id).then((doc) => {
      if (!cancelled) setCorrelations(doc && typeof doc === 'object' ? doc : { pairs: [], minShared: config.minShared })
    })
    return () => { cancelled = true }
  }, [config])

  const visible = useMemo(() => boardRows(props, {
    standardOnly,
    moreOnly,
    propId,
    filters: config.filters,
    sortDesc,
  }), [props, standardOnly, moreOnly, propId, config.filters, sortDesc])

  const selected = useMemo(() => new Set(legs.map((leg) => leg.key)), [legs])
  const suggestions = useMemo(() => {
    const board = props.map((row, idx) => ({ ...row, idx }))
    return correlationSuggestions(legs, board, correlations)
  }, [legs, props, correlations])
  const altered = legs.some((leg) => isPromoLine(leg))
  const estimate = estimateFor(mode, legs.length, altered)
  const avg = cardAverage(legs)
  const games = matchupLabel(visible.length ? visible : props)
  const rail = sport === 'nba' ? [...SLIP_RAIL, { id: 'nba', label: 'NBA' }] : SLIP_RAIL
  const propLabel = config.filters.find((chip) => chip.id === propId)?.label || 'All props'

  const choose = (row, side) => {
    const next = addLeg(legs, row, side)
    const duplicate = next === legs
      && legs.some((leg) => leg.key !== rowKey(row) && playerKey(leg) && playerKey(leg) === playerKey(row))
    if (duplicate) setNotice('One prop per player.')
    else if (next !== legs) setNotice('')
    setLegs(next)
  }

  const addSuggestion = (idx) => {
    const row = props[idx]
    if (row) choose(row, naturalSide(row))
  }

  const copyPicks = async () => {
    const text = legs.map((leg) => (
      `${leg.name} · ${leg.prop} ${fmt(leg.line)} · ${leg.side === 'LESS' ? 'Less' : 'More'} · CG ${fmtCg(shownCg(leg))}`
    )).join('\n')
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
      setOpen(true)
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/saved-slips', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_date: sportDate(config.timeZone),
          confidence: avg == null ? null : Math.round(avg),
          avg_edge: null,
          legs: legs.map((leg) => ({
            name: leg.name,
            team: leg.team,
            opponent: leg.opponent,
            prop: leg.prop,
            line: leg.line,
            projection: leg.projection,
            side: leg.side === 'LESS' ? 'UNDER' : 'OVER',
            odds_type: leg.odds_type,
          })),
        }),
      })
      setNotice(response.ok ? 'Slip saved.' : 'The slip could not be saved.')
      setOpen(true)
    } catch {
      setNotice('The slip could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const sheet = (
    <SlipSheet
      sport={config.id}
      legs={legs}
      mode={mode}
      setMode={setMode}
      onSave={saveSlip}
      onCopy={copyPicks}
      saving={saving}
      notice={notice}
      suggestions={suggestions}
      onAdd={addSuggestion}
    />
  )

  return (
    <section className="b2" data-testid="slip-board">
      <div className="b2-top">
        <div className="b2-rail" role="tablist" aria-label="Sport">
          {rail.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === config.id}
              className={item.id === config.id ? 'b2-pill is-on' : 'b2-pill'}
              onClick={() => onSport?.(item.id)}
            >
              <i />
              {item.label}
            </button>
          ))}
        </div>
        <div className="b2-chips">
          <div style={{ position: 'relative' }}>
            <button type="button" className="b2-chip is-on" aria-expanded={sortOpen} onClick={() => { setSortOpen((value) => !value); setPropOpen(false) }}>
              {sortDesc ? 'CG: high → low ▾' : 'CG: low → high ▾'}
            </button>
            {sortOpen && (
              <div className="b2-menu">
                <button type="button" className={sortDesc ? 'is-on' : ''} onClick={() => { setSortDesc(true); setSortOpen(false) }}>CG: high → low</button>
                <button type="button" className={!sortDesc ? 'is-on' : ''} onClick={() => { setSortDesc(false); setSortOpen(false) }}>CG: low → high</button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button type="button" className={propId === 'all' ? 'b2-chip' : 'b2-chip is-on'} aria-expanded={propOpen} onClick={() => { setPropOpen((value) => !value); setSortOpen(false) }}>
              {propId === 'all' ? 'All props ▾' : `${propLabel} ▾`}
            </button>
            {propOpen && (
              <div className="b2-menu">
                {config.filters.map((chip) => (
                  <button key={chip.id} type="button" className={chip.id === propId ? 'is-on' : ''} onClick={() => { setPropId(chip.id); setPropOpen(false) }}>
                    {chip.id === 'all' ? 'All props' : chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={moreOnly ? 'b2-chip is-on' : 'b2-chip'} aria-pressed={moreOnly} onClick={() => setMoreOnly((value) => !value)}>
            More only
          </button>
          <button type="button" className={standardOnly ? 'b2-chip is-on' : 'b2-chip'} aria-pressed={standardOnly} onClick={() => setStandardOnly((value) => !value)}>
            Standard lines
          </button>
        </div>
      </div>
      <div className="b2-lay">
        <main className="b2-main">
          <div className="b2-hd">
            <h1>{config.id.toUpperCase()} <span>slip</span></h1>
            {games ? <small>{games}</small> : null}
          </div>
          {loading ? <p className="b2-loading">Loading the board…</p> : null}
          {!loading && empty ? (
            <section className="b2-empty" data-testid="slip-empty-slate">
              <h2>{empty.title}</h2>
              <p>{empty.detail}</p>
            </section>
          ) : null}
          {!loading && !empty && props.length === 0 ? (
            <section className="b2-empty" data-testid="slip-empty-slate">
              <h2>No live lines</h2>
              <p>Started and unavailable lines stay off this board.</p>
            </section>
          ) : null}
          {!loading && !empty && props.length > 0 && visible.length === 0 ? (
            <section className="b2-empty">
              <h2>No lines match</h2>
              <p>Turn a filter off to see the rest of the board.</p>
            </section>
          ) : null}
          {notice ? <p className="b2-note">{notice}</p> : null}
          <div className="b2-list">
            {visible.map((row) => {
              const key = rowKey(row)
              const leg = legs.find((item) => item.key === key)
              const score = shownCg(row)
              const promo = isPromoLine(row)
              return (
                <article key={key} className={selected.has(key) ? 'b2-row is-sel' : 'b2-row'} data-testid="slip-row">
                  {leg ? <span className="b2-in">✓ IN SLIP</span> : null}
                  <div className="b2-who">
                    <Mark sport={config.id} row={row} />
                    <div>
                      <b className="b2-name">{row.name}</b>
                      <small className="b2-meta">{[row.team, row.position].filter(Boolean).join(' ')} · {row.prop}</small>
                    </div>
                  </div>
                  <div className="b2-cg">
                    <b>{fmtCg(score)}</b>
                    <span>CG</span>
                    <span className="b2-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(0, Math.min(100, score || 0))}%` }} />
                  </span>
                  </div>
                  <div className="b2-line">
                    LINE <b>{fmt(row.line)}</b>
                    {' · '}
                    PROJ <b className="is-proj">{fmt(row.projection)}</b>
                    {' · '}
                    L10 <b>{l10Text(row)}</b>
                    {promo ? <span className="b2-odds">{row.odds_type}</span> : null}
                  </div>
                  <div className="b2-ml">
                    <button type="button" className={leg?.side === 'MORE' ? 'is-more' : ''} onClick={() => choose(row, 'MORE')}>▲ More</button>
                    <button
                      type="button"
                      className={leg?.side === 'LESS' ? 'is-less' : ''}
                      disabled={promo}
                      title={promo ? 'More only' : undefined}
                      onClick={() => choose(row, 'LESS')}
                    >
                      ▼ Less
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          <p className="b2-rg">{SLIP_BETA_FOOTER}</p>
        </main>
        <aside className="b2-side">{sheet}</aside>
      </div>
      {open ? <button type="button" className="b2-scrim" aria-label="Close slip" onClick={() => setOpen(false)} /> : null}
      {open ? <div className="b2-sheet-pop">{sheet}</div> : null}
      <div className="b2-dock">
        <span className="b2-grab" />
        <button type="button" className="b2-dock-main" onClick={() => setOpen(true)} data-testid="slip-dock">
          <span className="b2-stat"><span>PICKS</span><b>{legs.length}</b></span>
          <span className="b2-stat"><span>AVG CG</span><b className="is-good">{avg == null ? '—' : avg.toFixed(1)}</b></span>
          <span className="b2-stat"><span>EST. PAY</span><b>{estimate.dollars}</b></span>
        </button>
        <button type="button" className="b2-save" onClick={saveSlip}>Save</button>
      </div>
    </section>
  )
}
