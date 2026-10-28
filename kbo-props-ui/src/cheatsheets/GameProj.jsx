import { STANDARD_LINE } from '../responsibleGambling'
import { filterRows, sortRows } from './boardControls.js'
import {
  chartPct,
  edgeLabel,
  format1,
  formatStat,
  heatColor,
  hitColor,
  moneyline,
  signed1,
} from './gameProjFormat.js'

function Banner({ label }) {
  if (!label) return null
  return (
    <div className="gp-banner" role="status" data-testid="game-proj-banner">
      {label}
    </div>
  )
}

function LayoutToggle({ layout, onLayout }) {
  return (
    <div className="gp-tog" role="group" aria-label="Game projection layout">
      <button
        type="button"
        className={layout === 'standard' ? 'on' : ''}
        aria-pressed={layout === 'standard'}
        data-testid="game-proj-toggle-standard"
        onClick={() => onLayout('standard')}
      >
        Standard
      </button>
      <button
        type="button"
        className={layout === 'pro' ? 'on' : ''}
        aria-pressed={layout === 'pro'}
        data-testid="game-proj-toggle-pro"
        onClick={() => onLayout('pro')}
      >
        Pro
      </button>
    </div>
  )
}

function SortHead({ scope, label, sortKey, sort, onSort, align = '' }) {
  const on = sort?.key === sortKey
  const arrow = on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th className={align} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={on ? 'on' : ''}
        data-testid={`sort-${scope}-${sortKey}`}
        onClick={() => onSort(sortKey)}
      >
        {label}{arrow}
      </button>
    </th>
  )
}

function GameBoard({ games, selectedId, sort, onSort, onSelect, projectionOnly = false }) {
  return (
    <div className="gp-board" role="tablist" aria-label="Games" data-testid="cheatsheet-game-board">
      <table className="gp-tbl gp-games">
        <caption className="gp-sr">Games</caption>
        <thead>
          <tr>
            <SortHead scope="games" label="Game" sortKey="game" sort={sort} onSort={onSort} />
            <SortHead scope="games" label="Kick" sortKey="kick" sort={sort} onSort={onSort} />
            <SortHead scope="games" label="Total" sortKey="total" sort={sort} onSort={onSort} align="r" />
            {projectionOnly
              ? <th className="r">Spread</th>
              : <SortHead scope="games" label="Edge" sortKey="edge" sort={sort} onSort={onSort} align="r" />}
          </tr>
        </thead>
        <tbody>
          {games.map((game) => {
            const selected = game.id === selectedId
            return (
              <tr
                key={game.id}
                className={selected ? 'on' : ''}
                data-testid={`cheatsheet-game-${game.id}`}
                onClick={() => onSelect(game.id)}
              >
                <td>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className="gp-game-tab"
                    onClick={() => onSelect(game.id)}
                  >
                    {game.game.away.abbr} @ {game.game.home.abbr}
                  </button>
                </td>
                <td>{game.listKick}</td>
                <td className="r">{format1(projectionOnly ? game.cg.total : game.market.total)}</td>
                <td className={projectionOnly ? 'r' : 'r gp-hi'}>{projectionOnly ? signed1(game.cg.side_proj) : signed1(game.cg.total_edge)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!games.length && <p className="gp-empty" data-testid="cheatsheet-no-games">No games match this filter.</p>}
    </div>
  )
}

function marketCaption(market) {
  if (market?.bookName) return market.bookName
  if (market?.books) return `${market.books} BOOKS`
  return 'MARKET'
}

function MarketStrip({ game }) {
  const { market } = game
  const away = game.game.away.abbr
  const home = game.game.home.abbr
  const spread = market.spread || {}
  const totalLabel = market.bookName || market.books ? `TOTAL · ${marketCaption(market)}` : 'TOTAL'
  return (
    <div className="gp-mkt">
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">{totalLabel}</div>
        <div className="gp-mkt-v">{format1(market.total)}</div>
        <div className="gp-mkt-s">{market.total == null ? 'no posted line' : 'O/U market'}</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">SPREAD</div>
        <div className="gp-mkt-v">{spread.favorite || '—'} {format1(spread.line)}</div>
        <div className="gp-mkt-s">{spread.line == null ? 'no posted line' : 'favorite'}</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">ML {home}</div>
        <div className="gp-mkt-v">{moneyline(market.ml?.[home])}</div>
        <div className="gp-mkt-s">{market.ml?.[home] == null ? 'no posted line' : 'home'}</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">ML {away}</div>
        <div className="gp-mkt-v">{moneyline(market.ml?.[away])}</div>
        <div className="gp-mkt-s">{market.ml?.[away] == null ? 'no posted line' : 'away'}</div>
      </div>
    </div>
  )
}

function TotalsChart({ game, chart, example }) {
  const line = game.market.total
  const floor = chart?.floor
  const span = chart?.span
  return (
    <div>
      <div className="gp-chart" role="img" aria-label={`Last 10 combined totals versus ${format1(line)}`}>
        {game.historical_totals.map((bar, index) => (
          <div
            key={`${bar.label}-${index}`}
            className={`gp-bar ${bar.total > line ? 'over' : 'under'}`}
            style={{ '--h': `${chartPct(bar.total, floor, span)}%` }}
            title={String(bar.total)}
          />
        ))}
        <div className="gp-oline" style={{ bottom: `${chartPct(line, floor, span)}%` }}>
          <em>O/U {format1(line)}</em>
        </div>
      </div>
      <div className="gp-chart-key">
        <span>older</span>
        <span>{example ? 'EXAMPLE bars' : 'combined'}</span>
        <span>recent</span>
      </div>
    </div>
  )
}

function MatchupTable({ title, rows, sort, onSort, scope }) {
  return (
    <section className="gp-card">
      <p className="gp-kick">{title}</p>
      <table className="gp-tbl">
        <thead>
          <tr>
            <SortHead scope={scope} label="Stat" sortKey="stat" sort={sort} onSort={onSort} />
            <SortHead scope={scope} label="Off" sortKey="off" sort={sort} onSort={onSort} align="r" />
            <SortHead scope={scope} label="Def" sortKey="def" sort={sort} onSort={onSort} align="r" />
            <SortHead scope={scope} label="Edge" sortKey="edge" sort={sort} onSort={onSort} align="r" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stat} data-testid={`matchup-row-${scope}`}>
              <td>{row.stat}</td>
              <td className="r">{formatStat(row.stat, row.off)} <span className="gp-mid">#{row.off_rk}</span></td>
              <td className="r">{formatStat(row.stat, row.def)} <span className="gp-mid">#{row.def_rk}</span></td>
              <td className="r gp-edge-cell">
                <span className="gp-track" aria-hidden="true">
                  <i className={row.edge < 0 ? 'neg' : ''} style={{ width: `${Math.min(100, Math.abs(row.edge))}%` }} />
                </span>
                <span className="gp-hi">{edgeLabel(row.edge)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="gp-empty" data-testid={`matchup-empty-${scope}`}>No stats match this filter.</p>}
    </section>
  )
}

function Heat({ game, footer = null }) {
  const { dvp } = game
  const labels = dvp.labels
  return (
    <section className="gp-card">
      <p className="gp-kick">POSITIONAL HEAT · DvP</p>
      <div className="gp-heat" style={{ gridTemplateColumns: `56px repeat(${labels.length}, minmax(0, 1fr))` }}>
        <span />
        {labels.map((label) => <span key={label} className="gp-hd">{label}</span>)}
        <span className="gp-lab">{game.game.away.abbr} DEF</span>
        {dvp.away_def.map((value, index) => (
          <span key={`away-${labels[index]}`} className="gp-cell" style={{ background: heatColor(value) }}>{value}</span>
        ))}
        <span className="gp-lab">{game.game.home.abbr} DEF</span>
        {dvp.home_def.map((value, index) => (
          <span key={`home-${labels[index]}`} className="gp-cell" style={{ background: heatColor(value) }}>{value}</span>
        ))}
      </div>
      <p className="gp-note">{dvp.note}</p>
      {footer}
    </section>
  )
}

function Pace({ game }) {
  const { pace } = game
  const away = game.game.away.abbr
  const home = game.game.home.abbr
  return (
    <section className="gp-card">
      <p className="gp-kick">PACE & SITUATIONAL</p>
      <div className="gp-pace">
        {pace.metrics.map((metric) => (
          <div key={metric.label}>
            <div className="gp-mid gp-mini">{metric.label}</div>
            <div className="gp-mono">{away} {format1(metric.away)}</div>
            <div className="gp-mono gp-hi">{home} {format1(metric.home)}</div>
          </div>
        ))}
        <div>
          <div className="gp-mid gp-mini">{pace.expected_label}</div>
          <div className="gp-exp">{format1(pace.expected)}</div>
        </div>
      </div>
      <div className="gp-mid gp-mini gp-sit-k">{pace.situational_label}</div>
      {pace.situational.map((row) => (
        <div key={row.sit} className="gp-sit">
          <span className="gp-mid">{row.sit}</span>
          <span>{away} {format1(row.away)}</span>
          <span className="gp-hi">{home} {format1(row.home)}</span>
        </div>
      ))}
    </section>
  )
}

function Components({ game }) {
  return (
    <section className="gp-card">
      <p className="gp-kick">MODEL COMPONENTS</p>
      <div className="gp-comp gp-comp-h">
        <span>DRIVER</span>
        <span>{game.game.away.abbr}</span>
        <span>{game.game.home.abbr}</span>
      </div>
      {game.components.map((row) => (
        <div key={row.name} className={`gp-comp${row.name === 'Final' ? ' final' : ''}`}>
          <span>{row.name}</span>
          <span>{format1(row.away)}</span>
          <span>{format1(row.home)}</span>
        </div>
      ))}
    </section>
  )
}

function HitChips({ game, compact = false }) {
  if (!game.hit_rates_over?.length) return null
  return (
    <div className={compact ? 'gp-hits' : 'gp-hr'}>
      {game.hit_rates_over.map((item) => (
        <div key={item.window} className={compact ? 'gp-hb' : 'gp-hr-box'}>
          <div className="w">{item.window}</div>
          <div className="v" style={{ color: hitColor(item.rate) }}>{item.rate}%</div>
        </div>
      ))}
    </div>
  )
}

function TeamBadge({ abbr, color, small = false }) {
  return (
    <div className={`gp-team${small ? ' sm' : ''}`} style={{ background: color }}>{abbr}</div>
  )
}

function ScorePill({ value }) {
  if (value == null) return null
  return <span className="gp-score">CG {format1(value)}</span>
}

function DetailNote({ note }) {
  if (!note) return null
  return <p className="gp-note gp-detail-note" data-testid="cheatsheet-detail-note">{note}</p>
}

function rowsFor(game, side, rowMode, sort) {
  const source = game?.matchups?.[side] || []
  return sortRows(filterRows(source, rowMode), sort)
}

function StandardView({ pack, game, games, gameSort, onGameSort, onSelectGame, rowSort, onRowSort, rowMode, layout, onLayout }) {
  const { cg, market } = game
  const away = game.game.away.abbr
  const home = game.game.home.abbr
  const awayRows = rowsFor(game, 'away_off', rowMode, rowSort.away)
  const homeRows = rowsFor(game, 'home_off', rowMode, rowSort.home)
  const exampleTag = pack.example ? ' · EXAMPLE' : ''
  const projectionOnly = pack.projectionOnly === true
  return (
    <div data-testid="game-proj-standard">
      <header className="gp-top">
        <div className="gp-wm">cg<span>propz</span></div>
        <span className="gp-pill mute">Game Proj</span>
        <LayoutToggle layout={layout} onLayout={onLayout} />
        <span className="gp-pill mute">{pack.weekLabel}</span>
        <span className="gp-rg">{STANDARD_LINE}</span>
      </header>
      <div className="gp-hero">
        <div className="gp-hero-main">
          <div className="gp-hero-head">
            <div>
              <p className="gp-kick">{projectionOnly ? 'PROJECTION ONLY' : 'CG MODEL VS MARKET'}</p>
              <h2 className="gp-match" data-testid="game-proj-match">{away} <span>@</span> {home}</h2>
              <p className="gp-meta">
                {[game.game.away.record, game.game.home.record, game.game.kickoff, game.game.venue].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="gp-hero-flags">
              <Banner label={pack.label} />
              <span className="gp-primary">PRIMARY VIEW</span>
            </div>
          </div>
          <div className="gp-edges">
            <article className="gp-edge">
              <p className="lab">{projectionOnly ? 'PROJ TOTAL' : 'TOTAL EDGE'}</p>
              <p className="big">{projectionOnly ? format1(cg.total) : signed1(cg.total_edge)}</p>
              <p className="sub">{projectionOnly
                ? <>Model total <b>{format1(cg.total)}</b>{market.total == null ? ' · no posted line' : <> vs market <b>{format1(market.total)}</b></>}</>
                : <>CG <b>{format1(cg.total)}</b> vs market <b>{format1(market.total)}</b></>}</p>
              <div className="row">
                {!projectionOnly && cg.total_lean ? <span className="gp-pill over">{cg.total_lean}</span> : null}
                {!projectionOnly ? <ScorePill value={cg.cg_score_total} /> : null}
              </div>
            </article>
            <article className="gp-edge">
              <p className="lab">{projectionOnly ? 'PROJ SPREAD' : 'SPREAD EDGE'}</p>
              <p className="big">{projectionOnly ? signed1(cg.side_proj) : signed1(cg.side_edge)}</p>
              <p className="sub">{projectionOnly
                ? <>Home minus away <b>{signed1(cg.side_proj)}</b></>
                : <>CG <b>{cg.side_lean} {format1(cg.side_proj)}</b> vs mkt {market.spread?.favorite || '—'} {format1(market.spread?.line)}</>}</p>
              <div className="row">
                {!projectionOnly && cg.side_lean ? <span className="gp-pill side">{cg.side_lean} SIDE</span> : null}
                {!projectionOnly ? <ScorePill value={cg.cg_score_spread} /> : null}
              </div>
            </article>
          </div>
          <div className="gp-scoreline">
            <div className="team">
              <TeamBadge abbr={away} color={game.game.away.color} />
              <div className="n">{format1(cg.away_score)}</div>
              <div className="gp-mid gp-mini">{away}</div>
            </div>
            <div className="vs">{projectionOnly ? 'PROJ' : 'CG PROJ'}</div>
            <div className="team">
              <TeamBadge abbr={home} color={game.game.home.color} />
              <div className="n">{format1(cg.home_score)}</div>
              <div className="gp-mid gp-mini">{home}</div>
            </div>
            <div className="tot">
              <p className="gp-kick">{projectionOnly ? 'PROJ TOTAL' : 'CG TOTAL'}</p>
              <div className="n">{format1(cg.total)}</div>
              <HitChips game={game} compact />
            </div>
          </div>
        </div>
        <div className="gp-rail">
          <section className="gp-card">
            <p className="gp-kick">{projectionOnly && market.total == null ? `MARKET · NO POSTED LINE${exampleTag}` : `MARKET · ${marketCaption(market)}${exampleTag}`}</p>
            <MarketStrip game={game} />
          </section>
          {game.historical_totals?.length ? (
            <section className="gp-card gp-grow">
              <p className="gp-kick">LAST 10 COMBINED · VS {format1(market.total)}</p>
              <TotalsChart game={game} chart={pack.chart} example={pack.example} />
            </section>
          ) : null}
          <section className="gp-card">
            <p className="gp-kick">THIS WEEK{exampleTag}</p>
            <GameBoard games={games} selectedId={game.id} sort={gameSort} onSort={onGameSort} onSelect={onSelectGame} projectionOnly={projectionOnly} />
          </section>
        </div>
      </div>
      <div className="gp-sec-label">
        <span className="gp-kick">MATCHUP DETAIL{exampleTag}</span>
        <span className="line" />
      </div>
      <div className="gp-sec">
        {game.matchups ? (
          <>
            <MatchupTable title={`${away} OFF vs ${home} DEF`} rows={awayRows} sort={rowSort.away} onSort={(key) => onRowSort('away', key)} scope="away" />
            <MatchupTable title={`${home} OFF vs ${away} DEF`} rows={homeRows} sort={rowSort.home} onSort={(key) => onRowSort('home', key)} scope="home" />
          </>
        ) : <DetailNote note={pack.detailNote} />}
        {game.dvp ? <Heat game={game} /> : null}
        {game.pace ? <Pace game={game} /> : null}
        {game.components ? <Components game={game} /> : null}
      </div>
    </div>
  )
}

function PanelTabs({ panel, onPanel, score }) {
  const tabs = [
    ['overview', 'Overview'],
    ['totals', 'Totals'],
    ['pace', 'Pace'],
  ]
  return (
    <div className="gp-tabs" role="tablist" aria-label="Projection section">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={panel === id}
          className={panel === id ? 'on' : ''}
          data-testid={`game-proj-panel-${id}`}
          onClick={() => onPanel(id)}
        >
          {label}
        </button>
      ))}
      <ScorePill value={score} />
    </div>
  )
}

function ProView({ pack, game, games, gameSort, onGameSort, onSelectGame, rowSort, onRowSort, rowMode, layout, onLayout, panel, onPanel }) {
  const { cg, market } = game
  const away = game.game.away
  const home = game.game.home
  const awayRows = rowsFor(game, 'away_off', rowMode, rowSort.away)
  const homeRows = rowsFor(game, 'home_off', rowMode, rowSort.home)
  const exampleTag = pack.example ? ' · EXAMPLE' : ''
  const projectionOnly = pack.projectionOnly === true
  const showOverview = panel === 'overview'
  const showTotals = panel === 'overview' || panel === 'totals'
  const showPace = panel === 'overview' || panel === 'pace'
  return (
    <div className="gp-pro" data-testid="game-proj-pro" data-panel={panel}>
      <header className="gp-top gp-top-pro">
        <div className="gp-wm">cg<span>propz</span></div>
        <div className="gp-fake-nav" aria-hidden="true">
          <span>Board</span>
          <span className="on">Game Proj</span>
          <span>DvP</span>
          <span>Slip</span>
          <span>Results</span>
        </div>
        <LayoutToggle layout={layout} onLayout={onLayout} />
        <span className="gp-pro-badge">PRO / ADVANCED</span>
        <Banner label={pack.label} />
        <PanelTabs panel={panel} onPanel={onPanel} score={projectionOnly ? null : cg.cg_score_total} />
      </header>
      <div className="gp-pro-body">
        <aside className="gp-pro-rail">
          <p className="gp-kick">THIS WEEK{exampleTag}</p>
          <GameBoard games={games} selectedId={game.id} sort={gameSort} onSort={onGameSort} onSelect={onSelectGame} projectionOnly={projectionOnly} />
        </aside>
        <div className="gp-pro-main">
          <section className="gp-card gp-pro-head">
            <div className="gp-club">
              <TeamBadge abbr={away.abbr} color={away.color} small />
              <div>
                <div className="gp-club-name">{[away.city, away.name].filter(Boolean).join(' ')}</div>
                {away.record ? <div className="gp-mid gp-mono">{away.record}</div> : null}
              </div>
            </div>
            <div className="gp-at">@</div>
            <div className="gp-club">
              <TeamBadge abbr={home.abbr} color={home.color} small />
              <div>
                <div className="gp-club-name">{[home.city, home.name].filter(Boolean).join(' ')}</div>
                {home.record ? <div className="gp-mid gp-mono">{home.record}</div> : null}
              </div>
            </div>
            <div className="gp-kickoff">
              <p className="gp-kick">{pack.weekLabel}</p>
              <div className="gp-mono">{game.game.kickoff}</div>
              {(game.game.venue || game.game.surface) ? (
                <div className="gp-mid gp-mono">{[game.game.venue, game.game.surface].filter(Boolean).join(' · ')}</div>
              ) : null}
            </div>
          </section>
          {showTotals && (
            <div className="gp-row1">
              <section className="gp-card">
                <MarketStrip game={game} />
              </section>
              <section className="gp-card">
                <p className="gp-kick">{projectionOnly ? 'FULL-GAME PROJECTION' : 'CG FULL-GAME PROJECTION'}</p>
                <div className="gp-proj">
                  <div className="team">
                    <TeamBadge abbr={away.abbr} color={away.color} />
                    <div className="n">{format1(cg.away_score)}</div>
                    <div className="gp-mid gp-mini">{away.abbr}{away.record ? ` · ${away.record}` : ''}</div>
                  </div>
                  <div className="mid">
                    <div className="tot">{format1(cg.total)}</div>
                    <div className="gp-mid gp-mini">{projectionOnly ? 'PROJ TOTAL' : 'CG TOTAL'}</div>
                    <div className="pills">
                      {!projectionOnly && cg.total_lean ? <span className="gp-pill over">{cg.total_lean} {signed1(cg.total_edge)} vs {format1(market.total)}</span> : null}
                      {!projectionOnly && cg.side_lean ? <span className="gp-pill side">{cg.side_lean} SIDE</span> : null}
                    </div>
                  </div>
                  <div className="team">
                    <TeamBadge abbr={home.abbr} color={home.color} />
                    <div className="n">{format1(cg.home_score)}</div>
                    <div className="gp-mid gp-mini">{home.abbr}{home.record ? ` · ${home.record}` : ''}</div>
                  </div>
                </div>
                <div className="gp-sidebar">
                  {projectionOnly ? (
                    <span>Proj spread <b>{signed1(cg.side_proj)}</b>{market.spread?.line == null ? ' · no posted line' : <> vs mkt {market.spread?.favorite || '—'} {format1(market.spread?.line)}</>}</span>
                  ) : (
                    <span>Side proj <b>{cg.side_lean} {format1(cg.side_proj)}</b> vs mkt {market.spread?.favorite || '—'} {format1(market.spread?.line)} · edge <b className="gp-hi">{signed1(cg.side_edge)}</b></span>
                  )}
                  {!projectionOnly ? <ScorePill value={cg.cg_score_total} /> : null}
                </div>
              </section>
            </div>
          )}
          {showTotals && (game.hit_rates_over || game.historical_totals || game.components) && (
            <div className="gp-row2">
              {game.hit_rates_over ? (
                <section className="gp-card">
                  <p className="gp-kick">OVER HIT RATES{exampleTag}</p>
                  <HitChips game={game} />
                </section>
              ) : null}
              {game.historical_totals?.length ? (
                <section className="gp-card">
                  <p className="gp-kick">LAST 10 COMBINED · VS {format1(market.total)}</p>
                  <TotalsChart game={game} chart={pack.chart} example={pack.example} />
                </section>
              ) : null}
              {game.components ? <Components game={game} /> : null}
            </div>
          )}
          {(showOverview || showPace) && (
            <div className="gp-row3">
              {showOverview && game.matchups ? (
                <>
                  <MatchupTable title={`${away.abbr} OFF vs ${home.abbr} DEF`} rows={awayRows} sort={rowSort.away} onSort={(key) => onRowSort('away', key)} scope="away" />
                  <MatchupTable title={`${home.abbr} OFF vs ${away.abbr} DEF`} rows={homeRows} sort={rowSort.home} onSort={(key) => onRowSort('home', key)} scope="home" />
                </>
              ) : null}
              {showPace && game.pace ? <Pace game={game} /> : null}
              {showOverview && game.dvp ? <Heat game={game} footer={<p className="gp-rg gp-rg-in">{STANDARD_LINE}</p>} /> : null}
              {!game.matchups && showOverview ? <DetailNote note={pack.detailNote} /> : null}
              {panel === 'pace' && !game.pace ? <DetailNote note={pack.detailNote} /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyBoard({ pack }) {
  const filtered = pack?.status === 'live' && pack.games?.length
  const message = pack?.status === 'waiting'
    ? 'Loading the live board.'
    : filtered
      ? 'No games match this filter.'
      : (pack?.detailNote || 'No live games on this sheet.')
  return (
    <div className="gp-empty-board" data-testid="cheatsheet-empty-board" data-status={pack?.status || 'empty'}>
      <p>{message}</p>
    </div>
  )
}

export default function GameProj({
  pack,
  game,
  games,
  gameSort,
  onGameSort,
  onSelectGame,
  rowSort,
  onRowSort,
  rowMode,
  layout,
  onLayout,
  panel,
  onPanel,
}) {
  return (
    <div className={`gp${layout === 'pro' ? ' is-pro' : ''}`} data-layout={layout}>
      {!game ? <EmptyBoard pack={pack} /> : layout === 'pro' ? (
        <ProView
          pack={pack}
          game={game}
          games={games}
          gameSort={gameSort}
          onGameSort={onGameSort}
          onSelectGame={onSelectGame}
          rowSort={rowSort}
          onRowSort={onRowSort}
          rowMode={rowMode}
          layout={layout}
          onLayout={onLayout}
          panel={panel}
          onPanel={onPanel}
        />
      ) : (
        <StandardView
          pack={pack}
          game={game}
          games={games}
          gameSort={gameSort}
          onGameSort={onGameSort}
          onSelectGame={onSelectGame}
          rowSort={rowSort}
          onRowSort={onRowSort}
          rowMode={rowMode}
          layout={layout}
          onLayout={onLayout}
        />
      )}
    </div>
  )
}
