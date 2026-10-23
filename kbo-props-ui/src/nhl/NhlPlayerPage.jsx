import { useEffect, useMemo, useState } from 'react'
import { AltLinesRow, LinePlot } from '../LineSlider'
import { useChartLine } from '../useChartLine'
import { overHitRate } from '../hitRateStrip'
import { formatLineValue, offeredLinesForStat, rateTextColor } from '../lineSlider'
import { cgScore } from '../cgScore'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreNote } from '../CgScoreExplainer'
import { fetchApiDataset } from '../apiData'
import { fetchNhlDvp } from './nhlData'
import { nhlHeadshotUrl, teamLogoUrl } from './nhlTeams'
import { fitImage } from '../fitImage.js'
import GameDateLogo from '../GameDateLogo'

const RANGES = [
  { id: 'season', label: '2026-27', rate: 'seasonHitRate', games: 'seasonGames' },
  { id: 'prior', label: '2025-26', rate: 'priorSeasonHitRate', games: 'priorSeasonGames' },
  { id: 'h2h', label: 'H2H', rate: 'h2hHitRate', games: 'h2hGames' },
  { id: 'l5', label: 'L5', rate: 'hitRateL5', games: 'gamesL5' },
  { id: 'l10', label: 'L10', rate: 'hitRate', games: 'gamesL10' },
  { id: 'l20', label: 'L20', rate: 'hitRateL20', games: 'gamesL20' },
  { id: 'l30', label: 'L30', rate: 'hitRateL30', games: 'gamesL30' },
]

const DVP_SOURCE = {
  F: { ds: 'nhl_dvp_f', file: 'nhl/dvp_f.json' },
  D: { ds: 'nhl_dvp_d', file: 'nhl/dvp_d.json' },
  G: { ds: 'nhl_dvp_g', file: 'nhl/dvp_g.json' },
}

const LINE_LABEL = {
  F1: 'Line 1', F2: 'Line 2', F3: 'Line 3', F4: 'Line 4',
  D1: 'Pair 1', D2: 'Pair 2', D3: 'Pair 3',
}

const STAT = {
  toi: { label: 'TOI', hint: 'All situations', format: 'ice' },
  ppToi: { label: 'PP TOI', hint: 'Power play', format: 'ice' },
  sog60: { label: 'Shots/60', format: 'rate' },
  attempts: { label: 'Shot att.', hint: 'Corsi / game', format: 'rate' },
  missed: { label: 'Missed', hint: 'Per game', format: 'rate' },
  blockedAttempts: { label: 'Blocked att.', hint: 'Own shots blocked', format: 'rate' },
  ixg: { label: 'ixG', hint: 'Per game', format: 'rate' },
  shPct: { label: 'Shooting %', format: 'pct' },
  pts60: { label: 'Points/60', format: 'rate' },
  ppp: { label: 'PPP/G', format: 'rate' },
  blocks: { label: 'Blocks', hint: 'Per game', format: 'rate' },
  hits: { label: 'Hits', hint: 'Per game', format: 'rate' },
  sa: { label: 'SA/G', format: 'rate' },
  saves: { label: 'Saves', hint: 'Per game', format: 'rate' },
  svPct: { label: 'SV%', format: 'sv' },
  gsax: { label: 'GSAx', hint: 'Per game', format: 'signed' },
}

const SPLITS = [
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'season', label: 'Season' },
]

// Same flip as the pipeline: fewer missed shots and fewer blocked attempts rank higher.
const LOWER_IS_BETTER = new Set(['missed', 'blockedAttempts'])

const SCALE = [
  { color: '#22c55e', label: '80+' },
  { color: '#4ade80', label: '60–79' },
  { color: '#d4d4d8', label: '40–59' },
  { color: '#fca5a5', label: '20–39' },
  { color: '#f87171', label: '<20' },
]

function chartWindow(item, range) {
  const values = Array.isArray(item.log) && item.log.length ? item.log : (Array.isArray(item.recent) ? item.recent : [])
  const dates = Array.isArray(item.logDates) && item.logDates.length ? item.logDates : (Array.isArray(item.gameDates) ? item.gameDates : [])
  const seasons = Array.isArray(item.logSeasons) ? item.logSeasons : (Array.isArray(item.chartSeasons) ? item.chartSeasons : [])
  const opponents = Array.isArray(item.logOpponents) ? item.logOpponents : []
  const teams = Array.isArray(item.logTeams) ? item.logTeams : []
  const indexes = []
  values.forEach((_, index) => {
    if (range === 'season' && seasons[index] !== '2026-27') return
    if (range === 'prior' && seasons[index] !== '2025-26') return
    if (range === 'h2h' && opponents[index] !== item.opponent) return
    indexes.push(index)
  })
  const windowIndexes = range === 'l5' || range === 'l10' || range === 'l20' || range === 'l30'
    ? indexes.slice(-(range === 'l5' ? 5 : range === 'l20' ? 20 : range === 'l30' ? 30 : 10))
    : indexes
  return windowIndexes.map((index) => ({
    value: values[index],
    date: dates[index] || '',
    season: seasons[index] || '',
    team: teams[index] || '',
    opponent: opponents[index] || '',
  }))
}

function initials(name) {
  return String(name || '').split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function finiteNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatCount(value) {
  const number = finiteNumber(value)
  if (number == null) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function formatRate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toFixed(1)
}

function formatIce(seconds) {
  const number = Number(seconds)
  if (!Number.isFinite(number)) return '—'
  const total = Math.max(0, Math.round(number))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatStat(format, value) {
  if (value == null || value === '') return '—'
  if (format === 'ice') return formatIce(value)
  if (format === 'pct') {
    const number = Number(value)
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '—'
  }
  if (format === 'sv') {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    return number.toFixed(3).replace(/^0/, '')
  }
  if (format === 'signed') {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    if (Math.abs(number) < 0.005) return '0.00'
    const text = number.toFixed(2)
    return number > 0 ? `+${text}` : text
  }
  return formatRate(value)
}

function percentileColor(pct) {
  const value = Number(pct)
  if (!Number.isFinite(value)) return null
  if (value >= 80) return '#22c55e'
  if (value >= 60) return '#4ade80'
  if (value >= 40) return '#d4d4d8'
  if (value >= 20) return '#fca5a5'
  return '#f87171'
}

function ordinal(rank) {
  const value = Number(rank)
  if (!Number.isFinite(value)) return '—'
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  switch (value % 10) {
    case 1: return `${value}st`
    case 2: return `${value}nd`
    case 3: return `${value}rd`
    default: return `${value}th`
  }
}

function mix(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount))
  const channel = (index) => Math.round(from[index] + (to[index] - from[index]) * t)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

// Rank 1 is the toughest matchup for the over. Rank 32 is the easiest.
function dvpColor(rank) {
  const value = Number(rank)
  if (!Number.isFinite(value)) return null
  const t = (Math.min(32, Math.max(1, value)) - 1) / 31
  return t < 0.5
    ? mix([248, 113, 113], [161, 161, 170], t / 0.5)
    : mix([161, 161, 170], [74, 222, 128], (t - 0.5) / 0.5)
}

function positionGroup(item) {
  if (item?.position === 'G' || item?.prop === 'Goalie Saves') return 'G'
  if (item?.position === 'D') return 'D'
  return 'F'
}

function dvpStat(position, prop) {
  if (position === 'G') return 'shots'
  if (prop === 'Shots On Goal') return 'sog'
  return 'points'
}

function statKeys(position, prop) {
  if (position === 'G') return ['sa', 'saves', 'svPct', 'gsax']
  const defense = position === 'D' ? ['blocks', 'hits'] : []
  if (prop === 'Power Play Points') return ['ppToi', 'ppp', 'toi', 'pts60', 'ixg', ...defense]
  if (prop === 'Points') return ['toi', 'ppToi', 'pts60', 'ixg', 'sog60', 'shPct', 'attempts', ...defense]
  return ['toi', 'ppToi', 'sog60', 'attempts', 'missed', 'blockedAttempts', 'ixg', ...defense]
}

function profileTitle(position, prop) {
  if (position === 'G') return 'Save profile'
  if (prop === 'Power Play Points') return 'Power-play profile'
  if (prop === 'Points') return 'Point profile'
  return 'Shot profile'
}

function profileNote(position, prop) {
  if (position === 'G') {
    return 'Saves follow how many shots he faces and how many he stops. GSAx is goals saved above MoneyPuck expected goals.'
  }
  if (prop === 'Power Play Points') {
    return 'Power-play time and the unit move this line. PPP/G is the rate on that ice.'
  }
  if (prop === 'Points') {
    return 'Points/60 and ixG are the rate and the chance quality. Shooting % is the noisy part of a points line.'
  }
  if (position === 'D') {
    return 'Shots follow ice time and shots/60. Corsi counts attempts that missed or were blocked. Blocks and hits mark a shutdown role.'
  }
  return 'Shots follow ice time and shots/60. Corsi counts attempts that missed the net or were blocked.'
}

function dvpLookup(payload, windowId, stat, opponent) {
  const teams = payload?.windows?.[windowId]?.stats?.[stat]?.teams
  if (!Array.isArray(teams) || !opponent) return null
  return teams.find((row) => row.team === opponent) || null
}

function noLineCopy(prop) {
  if (prop === 'Goalie Saves') return 'No saves line posted yet'
  return 'No line posted yet'
}

function barKind(value, line) {
  const actual = finiteNumber(value)
  const target = finiteNumber(line)
  if (actual == null || target == null) return 'plain'
  if (actual > target) return 'hit'
  if (actual === target) return 'push'
  return 'miss'
}

function PlayerHeadshot({ playerId, imageUrl, name, team }) {
  const nhlSrc = fitImage(nhlHeadshotUrl(playerId), 72)
  const fallbackSrc = fitImage(imageUrl, 72)
  const [failedNhl, setFailedNhl] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)
  const src = !failedNhl && nhlSrc ? nhlSrc : (!failedFallback && fallbackSrc ? fallbackSrc : '')
  const logo = fitImage(teamLogoUrl(team), 26)
  return (
    <div className="nhl-avatar-wrap">
      <div className="nhl-avatar">
        {src ? (
          <img
            src={src}
            alt=""
            onError={() => {
              if (nhlSrc && src === nhlSrc) setFailedNhl(true)
              else setFailedFallback(true)
            }}
          />
        ) : (
          <span>{initials(name)}</span>
        )}
      </div>
      {logo && (
        <img
          className="nhl-avatar-badge"
          src={logo}
          alt=""
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
      )}
    </div>
  )
}

function RoleChip({ label, value, detail, color }) {
  return (
    <div className="nhl-role">
      <span>{label}</span>
      <b style={color ? { color } : undefined}>{value || '—'}</b>
      {detail ? <small className="nhl-role-detail" style={color ? { color } : undefined}>{detail}</small> : null}
    </div>
  )
}

function sameNhlRow(row, source) {
  if (!row || !source) return false
  if (String(row.player || '') !== String(source.player || '')) return false
  const stat = row.prop || row.stat
  if (stat !== source.prop && stat !== source.stat) return false
  if (source.line == null || row.line == null) return true
  return Number(row.line) === Number(source.line)
}

export default function NhlPlayerPage({ item: initialItem, onBack }) {
  const [item, setItem] = useState(initialItem)
  const [range, setRange] = useState('l10')

  useEffect(() => {
    setItem(initialItem)
    const name = initialItem?.player
    if (!name) return undefined
    let active = true
    fetchApiDataset('nhl_projections', { devStaticPath: 'nhl/projections.json', player: name })
      .then((snapshot) => {
        if (!active) return
        const rows = Array.isArray(snapshot.data) ? snapshot.data : []
        const match = rows.find((row) => sameNhlRow(row, initialItem))
        if (match) setItem({ ...initialItem, ...match })
      })
      .catch(() => {})
    return () => { active = false }
  }, [initialItem])
  const [dvpState, setDvpState] = useState({ position: '', payload: null })
  const position = positionGroup(item)
  const dvp = dvpState.position === position ? dvpState.payload : null

  useEffect(() => {
    let active = true
    const source = DVP_SOURCE[position]
    fetchNhlDvp(source.ds, source.file)
      .then(({ payload }) => { if (active) setDvpState({ position, payload }) })
      .catch(() => { if (active) setDvpState({ position, payload: null }) })
    return () => { active = false }
  }, [position])

  const chartInput = useMemo(() => {
    if (!item) return { posted: null, bars: [], values: [], windows: [], offered: null }
    const windows = RANGES.map((option) => {
      const windowBars = chartWindow(item, option.id)
      return {
        id: option.id,
        bars: windowBars,
        values: windowBars.map((bar) => finiteNumber(bar.value)).filter((value) => value != null),
      }
    })
    const selectedWindow = windows.find((option) => option.id === range) || windows[4]
    const posted = finiteNumber(item.line ?? item.pp_line)
    return {
      posted,
      bars: selectedWindow.bars,
      values: selectedWindow.values,
      windows,
      offered: offeredLinesForStat(
        [{ prop: item.prop, stat: item.prop, line: posted, altLines: item.altLines || item.alt_lines || item.alternateLines }],
        item.prop,
      ),
    }
  }, [item, range])

  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: `${item?.playerId || item?.player || ''}|${item?.prop || ''}`,
  })

  if (!item) return null

  const line = chartInput.posted
  const bars = chartInput.bars
  const scaleMax = Math.max(slider.max || 0, 1)
  const chartLine = slider.line
  const chartHit = slider.rate || { hits: 0, games: 0, rate: null }
  const hitColor = rateTextColor(chartHit.rate, chartHit.games)
  const selected = RANGES.find((option) => option.id === range) || RANGES[4]
  const includesPrior = bars.some((bar) => bar.season === '2025-26')
  const profile = item.profile && typeof item.profile === 'object' ? item.profile : null
  const usage = item.usage && typeof item.usage === 'object' ? item.usage : null
  const keys = statKeys(position, item.prop)
  const stat = dvpStat(position, item.prop)
  const seasonDvp = dvpLookup(dvp, 'blend', stat, item.opponent)
  const l10Dvp = dvpLookup(dvp, 'l10', stat, item.opponent)
  const dvpRank = seasonDvp?.rank ?? null
  const lineText = usage?.line ? (LINE_LABEL[usage.line] || usage.line) : null
  const ppText = usage?.ppUnit === 'PP1' || usage?.ppUnit === 'PP2'
    ? usage.ppUnit
    : usage?.ppUnit === 'none'
      ? 'No unit'
      : null
  const linesUnposted = position !== 'G' && usage?.source === 'last_game'
  const starter = item.goalieStatus === 'confirmed'
    ? 'Confirmed'
    : item.goalieStatus === 'probable'
      ? 'Probable'
      : null
  const dvpValue = seasonDvp?.value
  const dvpLabel = position === 'G'
    ? (dvpValue == null ? '—' : `${formatRate(dvpValue)} · ${dvpRank == null ? '—' : ordinal(dvpRank)}`)
    : (dvpRank == null ? '—' : ordinal(dvpRank))

  return (
    <section className="nhl-player-sheet">
      <button className="nhl-back" type="button" onClick={onBack}>← Back</button>
      <div className="nhl-player-head">
        <PlayerHeadshot key={`${item.playerId || item.player}-${item.team}`} playerId={item.playerId} imageUrl={item.imageUrl} name={item.player} team={item.team} />
        <div className="nhl-player-id">
          <h1>
            {item.player}
            <span>{position}</span>
          </h1>
        </div>
      </div>
      <p className="nhl-player-sub">
        {item.team}{item.opponent ? ` vs ${item.opponent}` : ''}.{' '}
        {line == null ? (
          <span className="nhl-no-line">{noLineCopy(item.prop)}.</span>
        ) : (
          <>{item.prop} line <b>{formatCount(line)}</b>.</>
        )}
        {' '}Projection <b>{formatCount(item.projection)}</b>.
        {item.latestGame ? ` Latest game ${item.latestGame}.` : ''}
        {' '}2026-27 is this season only. 2025-26 is last season, including a previous team.
      </p>
      <div className="nfl-player-range-strip">
        {RANGES.map((option) => {
          const window = chartInput.windows.find((entry) => entry.id === option.id)
          const rated = chartLine == null ? null : overHitRate(window?.values || [], chartLine)
          const tone = rateTextColor(rated?.rate, rated?.games)
          return (
            <button key={option.id} type="button" className={range === option.id ? 'active' : ''} onClick={() => setRange(option.id)}>
              <span>{option.label}</span>
              {line != null && <b style={tone ? { color: tone } : undefined}>{rated?.rate == null ? '—' : `${rated.rate}%`}</b>}
              <small>{rated ? `${rated.games} gm` : '—'}</small>
            </button>
          )
        })}
      </div>
      <div className="nhl-chart-card">
        <div className="nhl-chart-head">
          <span>{selected.label}{includesPrior && range !== 'prior' && range !== 'season' ? ' · includes 2025-26' : ''}</span>
          {line == null ? (
            <b className="nhl-no-line">{noLineCopy(item.prop)}</b>
          ) : (
            <b style={hitColor ? { color: hitColor } : undefined}>
              {chartHit.rate == null ? '—' : `${chartHit.rate}% over${slider.moved ? ` ${formatLineValue(chartLine)}` : ''}`}
            </b>
          )}
        </div>
        {bars.length ? (
          <div className="nhl-chart-scroll">
            <div className={`nhl-chart-plot${bars.length <= 10 ? ' is-fit' : ''}`}>
              <LinePlot className="nhl-chart-stage" slider={slider} lineClassName="nhl-chart-line">
                <div className="nhl-chart-bars">
                  {bars.map((bar, index) => {
                    const kind = barKind(bar.value, chartLine)
                    const height = Math.max(4, ((Number(bar.value) || 0) / scaleMax) * 100)
                    const title = [bar.date, bar.opponent && `vs ${bar.opponent}`, bar.team && bar.team !== item.team ? `with ${bar.team}` : '']
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <div className="nhl-chart-col" key={`${bar.date}-${bar.team}-${index}`} title={title}>
                        <div className={`nhl-chart-bar is-${kind}${height < 28 ? ' is-short' : ''}`} style={{ height: `${height}%` }}>
                          <b>{formatCount(bar.value)}</b>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </LinePlot>
              <div className="nhl-chart-dates">
                {bars.map((bar, index) => (
                  <span key={`${bar.date}-d-${index}`}>
                    <GameDateLogo date={bar.date} team={bar.opponent} logo={teamLogoUrl(bar.opponent)} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="nhl-chart-empty">No games in this window.</p>
        )}
        <div className="cg-score-open">
          <CgScoreNote note={buildCgScoreExplainer({
            player: item.player,
            projection: item.projection,
            line: item.line,
            stat: item.prop,
            score: cgScore(item.projection, item.line, item.prop),
            recentValues: item.recent,
          })} />
        </div>
        <AltLinesRow slider={slider} />
      </div>

      <section className="nhl-profile" aria-label={profileTitle(position, item.prop)}>
        <h2>{profileTitle(position, item.prop)}</h2>
        <p className="nhl-profile-note">{profileNote(position, item.prop)}</p>
        <div className="nhl-role-row">
          {position === 'G' ? (
            <RoleChip label="Starter" value={starter} color={item.goalieStatus === 'confirmed' ? '#4ade80' : null} />
          ) : (
            <>
              <RoleChip label="Line" value={lineText} />
              <RoleChip label="PP unit" value={ppText} />
            </>
          )}
          <RoleChip
            label={position === 'G' ? 'Opp shots' : item.prop === 'Shots On Goal' ? 'Opp shot DvP' : 'Opp points DvP'}
            value={position === 'G' ? (dvpValue == null ? null : formatRate(dvpValue)) : dvpLabel}
            detail={position === 'G' && dvpRank != null ? ordinal(dvpRank) : null}
            color={dvpColor(dvpRank)}
          />
          <RoleChip label="L10 DvP" value={l10Dvp?.rank == null ? null : ordinal(l10Dvp.rank)} color={dvpColor(l10Dvp?.rank)} />
        </div>
        {linesUnposted && (
          <p className="nhl-profile-note">Tonight&apos;s lines are not posted, so the line and power-play unit are blank.</p>
        )}
        {profile?.baseline?.label && (
          <div className="nhl-scale">
            <span>vs {profile.baseline.label} {profile.baseline.position} avg</span>
            <span className="nhl-scale-key">
              {SCALE.map((bucket) => (
                <span key={bucket.label}><i style={{ background: bucket.color }} />{bucket.label}</span>
              ))}
            </span>
          </div>
        )}
        {profile?.baseline && keys.some((key) => LOWER_IS_BETTER.has(key)) && (
          <p className="nhl-scale-note">Missed shots and blocked attempts are flipped, so fewer ranks higher.</p>
        )}
        <div className="nhl-profile-scroll">
          <table className="nhl-profile-table">
            <thead>
              <tr>
                <th>Stat</th>
                {SPLITS.map((split) => {
                  const games = profile?.[split.id]?.games
                  return (
                    <th key={split.id}>
                      {split.id === 'season' ? (item.seasonLabel || 'Season') : split.label}
                      <small>{games ? `${games} gm` : '—'}</small>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const meta = STAT[key]
                return (
                  <tr key={key}>
                    <th>
                      {meta.label}
                      {meta.hint && <small>{meta.hint}</small>}
                    </th>
                    {SPLITS.map((split) => {
                      const value = profile?.[split.id]?.[key]
                      const compare = profile?.compare?.[split.id]?.[key]
                      const color = percentileColor(compare?.pct)
                      const title = compare?.pct == null ? undefined : `${ordinal(compare.pct)} percentile`
                      return (
                        <td key={split.id}>
                          <span className="nhl-stat" title={title}>
                            <b className="nhl-stat-value" style={color ? { color } : undefined}>{formatStat(meta.format, value)}</b>
                            {compare?.pct != null && (
                              <span className="nhl-pct-track" aria-hidden="true">
                                <span className="nhl-pct-fill" style={{ width: `${compare.pct}%`, background: color }} />
                                {compare.avgPct != null && (
                                  <span className="nhl-pct-tick" style={{ left: `${compare.avgPct}%` }} />
                                )}
                              </span>
                            )}
                            {compare?.avg != null && (
                              <small className="nhl-lg-avg">Lg avg {formatStat(meta.format, compare.avg)}</small>
                            )}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
