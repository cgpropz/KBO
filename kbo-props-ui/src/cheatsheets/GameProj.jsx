import { STANDARD_LINE } from '../responsibleGambling'
import example from './gameProjExample.json'
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

const EXAMPLE_LABEL = example.label

function Banner() {
  return (
    <div className="gp-banner" role="status" data-testid="game-proj-banner">
      {EXAMPLE_LABEL}
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

function MarketStrip() {
  const { market } = example
  const books = market.books
  return (
    <div className="gp-mkt">
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">TOTAL · {books} BOOKS</div>
        <div className="gp-mkt-v">{format1(market.total)}</div>
        <div className="gp-mkt-s">O/U market</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">SPREAD</div>
        <div className="gp-mkt-v">{market.spread.favorite} {format1(market.spread.line)}</div>
        <div className="gp-mkt-s">favorite</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">ML {example.game.home.abbr}</div>
        <div className="gp-mkt-v">{moneyline(market.ml.PHI)}</div>
        <div className="gp-mkt-s">home</div>
      </div>
      <div className="gp-mkt-b">
        <div className="gp-mkt-l">ML {example.game.away.abbr}</div>
        <div className="gp-mkt-v">{moneyline(market.ml.DAL)}</div>
        <div className="gp-mkt-s">away</div>
      </div>
    </div>
  )
}

function TotalsChart() {
  const line = example.market.total
  return (
    <div>
      <div className="gp-chart" role="img" aria-label={`Example last 10 combined totals versus ${format1(line)}`}>
        {example.historical_totals.map((bar) => (
          <div
            key={bar.label}
            className={`gp-bar ${bar.total > line ? 'over' : 'under'}`}
            style={{ '--h': `${chartPct(bar.total)}%` }}
            title={String(bar.total)}
          />
        ))}
        <div className="gp-oline" style={{ bottom: `${chartPct(line)}%` }}>
          <em>O/U {format1(line)}</em>
        </div>
      </div>
      <div className="gp-chart-key">
        <span>older</span>
        <span>EXAMPLE bars</span>
        <span>recent</span>
      </div>
    </div>
  )
}

function MatchupTable({ title, rows }) {
  return (
    <section className="gp-card">
      <p className="gp-kick">{title}</p>
      <table className="gp-tbl">
        <thead>
          <tr>
            <th>Stat</th>
            <th className="r">Off</th>
            <th className="r">Def</th>
            <th className="r">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stat}>
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
    </section>
  )
}

function Heat({ footer = null }) {
  const labels = example.dvp.labels.map((label) => label.replace(/^vs\s+/i, ''))
  return (
    <section className="gp-card">
      <p className="gp-kick">POSITIONAL HEAT · DvP</p>
      <div className="gp-heat">
        <span />
        {labels.map((label) => <span key={label} className="gp-hd">{label}</span>)}
        <span className="gp-lab">{example.game.away.abbr} DEF</span>
        {example.dvp.dal_def.map((value, index) => (
          <span key={`dal-${labels[index]}`} className="gp-cell" style={{ background: heatColor(value) }}>{value}</span>
        ))}
        <span className="gp-lab">{example.game.home.abbr} DEF</span>
        {example.dvp.phi_def.map((value, index) => (
          <span key={`phi-${labels[index]}`} className="gp-cell" style={{ background: heatColor(value) }}>{value}</span>
        ))}
      </div>
      <p className="gp-note">Higher = softer matchup for that position (EXAMPLE)</p>
      {footer}
    </section>
  )
}

function Pace() {
  const { pace } = example
  return (
    <section className="gp-card">
      <p className="gp-kick">PACE & SITUATIONAL</p>
      <div className="gp-pace">
        <div>
          <div className="gp-mid gp-mini">SECS/PLAY</div>
          <div className="gp-mono">{example.game.away.abbr} {format1(pace.secs_per_play.DAL)}</div>
          <div className="gp-mono gp-hi">{example.game.home.abbr} {format1(pace.secs_per_play.PHI)}</div>
        </div>
        <div>
          <div className="gp-mid gp-mini">PLAYS/G</div>
          <div className="gp-mono">{example.game.away.abbr} {format1(pace.plays_per_game.DAL)}</div>
          <div className="gp-mono gp-hi">{example.game.home.abbr} {format1(pace.plays_per_game.PHI)}</div>
        </div>
        <div>
          <div className="gp-mid gp-mini">EXP PLAYS</div>
          <div className="gp-exp">{format1(pace.expected_plays)}</div>
        </div>
      </div>
      <div className="gp-mid gp-mini gp-sit-k">SECS/PLAY BY SITUATION</div>
      {pace.situational.map((row) => (
        <div key={row.sit} className="gp-sit">
          <span className="gp-mid">{row.sit}</span>
          <span>{example.game.away.abbr} {format1(row.dal)}</span>
          <span className="gp-hi">{example.game.home.abbr} {format1(row.phi)}</span>
        </div>
      ))}
    </section>
  )
}

function Components() {
  return (
    <section className="gp-card">
      <p className="gp-kick">MODEL COMPONENTS</p>
      <div className="gp-comp gp-comp-h">
        <span>DRIVER</span>
        <span>{example.game.away.abbr}</span>
        <span>{example.game.home.abbr}</span>
      </div>
      {example.components.map((row) => (
        <div key={row.name} className={`gp-comp${row.name === 'Final' ? ' final' : ''}`}>
          <span>{row.name}</span>
          <span>{format1(row.away)}</span>
          <span>{format1(row.home)}</span>
        </div>
      ))}
    </section>
  )
}

function Slate({ stacked = false }) {
  const { game } = example
  return (
    <div className={stacked ? '' : 'gp-card'}>
      <p className="gp-kick">THIS WEEK · EXAMPLE</p>
      <div className="gp-slate on">
        <span>{game.away.abbr} @ {game.home.abbr}</span>
        <span className="t">LIVE</span>
      </div>
      {example.slate.map((item) => (
        <div key={`${item.away}-${item.home}`} className="gp-slate">
          <span>{item.away} @ {item.home}</span>
          <span className="t">{item.kick} · {format1(item.total)}</span>
        </div>
      ))}
    </div>
  )
}

function HitChips({ compact = false }) {
  return (
    <div className={compact ? 'gp-hits' : 'gp-hr'}>
      {example.hit_rates_over.map((item) => (
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

function StandardView({ week, onLayout }) {
  const { game, cg, market } = example
  return (
    <div data-testid="game-proj-standard">
      <header className="gp-top">
        <div className="gp-wm">cg<span>propz</span></div>
        <span className="gp-pill mute">Game Proj</span>
        <LayoutToggle layout="standard" onLayout={onLayout} />
        <span className="gp-pill mute">{week}</span>
        <span className="gp-rg">{STANDARD_LINE}</span>
      </header>
      <div className="gp-hero">
        <div className="gp-hero-main">
          <div className="gp-hero-head">
            <div>
              <p className="gp-kick">CG MODEL VS MARKET</p>
              <h2 className="gp-match">{game.away.abbr} <span>@</span> {game.home.abbr}</h2>
              <p className="gp-meta">
                {game.away.record} · {game.home.record} · {game.kickoff} · {game.venue}
              </p>
            </div>
            <div className="gp-hero-flags">
              <Banner />
              <span className="gp-primary">PRIMARY VIEW</span>
            </div>
          </div>
          <div className="gp-edges">
            <article className="gp-edge">
              <p className="lab">TOTAL EDGE</p>
              <p className="big">{signed1(cg.total_edge)}</p>
              <p className="sub">CG <b>{format1(cg.total)}</b> vs market <b>{format1(market.total)}</b></p>
              <div className="row">
                <span className="gp-pill over">{cg.total_lean}</span>
                <span className="gp-score">CG {format1(cg.cg_score_total)}</span>
              </div>
            </article>
            <article className="gp-edge">
              <p className="lab">SPREAD EDGE</p>
              <p className="big">{signed1(cg.side_edge)}</p>
              <p className="sub">CG <b>{cg.side_lean} {format1(cg.side_proj)}</b> vs mkt {market.spread.favorite} {format1(market.spread.line)}</p>
              <div className="row">
                <span className="gp-pill side">{cg.side_lean} SIDE</span>
                <span className="gp-score">CG {format1(cg.cg_score_spread)}</span>
              </div>
            </article>
          </div>
          <div className="gp-scoreline">
            <div className="team">
              <TeamBadge abbr={game.away.abbr} color={game.away.color} />
              <div className="n">{format1(cg.away_score)}</div>
              <div className="gp-mid gp-mini">{game.away.abbr}</div>
            </div>
            <div className="vs">CG PROJ</div>
            <div className="team">
              <TeamBadge abbr={game.home.abbr} color={game.home.color} />
              <div className="n">{format1(cg.home_score)}</div>
              <div className="gp-mid gp-mini">{game.home.abbr}</div>
            </div>
            <div className="tot">
              <p className="gp-kick">CG TOTAL</p>
              <div className="n">{format1(cg.total)}</div>
              <HitChips compact />
            </div>
          </div>
        </div>
        <div className="gp-rail">
          <section className="gp-card">
            <p className="gp-kick">MARKET · {market.books} BOOKS · EXAMPLE</p>
            <MarketStrip />
          </section>
          <section className="gp-card gp-grow">
            <p className="gp-kick">LAST 10 COMBINED · VS {format1(market.total)}</p>
            <TotalsChart />
          </section>
          <section className="gp-card">
            <Slate stacked />
          </section>
        </div>
      </div>
      <div className="gp-sec-label">
        <span className="gp-kick">MATCHUP DETAIL · EXAMPLE</span>
        <span className="line" />
      </div>
      <div className="gp-sec">
        <MatchupTable title={`${game.away.abbr} OFF vs ${game.home.abbr} DEF`} rows={example.matchups.dal_off_vs_phi_def} />
        <MatchupTable title={`${game.home.abbr} OFF vs ${game.away.abbr} DEF`} rows={example.matchups.phi_off_vs_dal_def} />
        <Heat />
        <Pace />
        <Components />
      </div>
    </div>
  )
}

function ProView({ week, onLayout }) {
  const { game, cg, market } = example
  return (
    <div className="gp-pro" data-testid="game-proj-pro">
      <header className="gp-top gp-top-pro">
        <div className="gp-wm">cg<span>propz</span></div>
        <div className="gp-fake-nav" aria-hidden="true">
          <span>Board</span>
          <span className="on">Game Proj</span>
          <span>DvP</span>
          <span>Slip</span>
          <span>Results</span>
        </div>
        <LayoutToggle layout="pro" onLayout={onLayout} />
        <span className="gp-pro-badge">PRO / ADVANCED</span>
        <Banner />
        <div className="gp-tabs" aria-hidden="true">
          <span className="on">Overview</span>
          <span>Totals</span>
          <span>Pace</span>
          <span className="gp-score">CG {format1(cg.cg_score_total)}</span>
        </div>
      </header>
      <div className="gp-pro-body">
        <aside className="gp-pro-rail">
          <Slate />
        </aside>
        <div className="gp-pro-main">
          <section className="gp-card gp-pro-head">
            <div className="gp-club">
              <TeamBadge abbr={game.away.abbr} color={game.away.color} small />
              <div>
                <div className="gp-club-name">{game.away.city} {game.away.name}</div>
                <div className="gp-mid gp-mono">{game.away.record}</div>
              </div>
            </div>
            <div className="gp-at">@</div>
            <div className="gp-club">
              <TeamBadge abbr={game.home.abbr} color={game.home.color} small />
              <div>
                <div className="gp-club-name">{game.home.city} {game.home.name}</div>
                <div className="gp-mid gp-mono">{game.home.record}</div>
              </div>
            </div>
            <div className="gp-kickoff">
              <p className="gp-kick">{week}</p>
              <div className="gp-mono">{game.kickoff}</div>
              <div className="gp-mid gp-mono">{game.venue} · {game.surface}</div>
            </div>
          </section>
          <div className="gp-row1">
            <section className="gp-card">
              <MarketStrip />
            </section>
            <section className="gp-card">
              <p className="gp-kick">CG FULL-GAME PROJECTION</p>
              <div className="gp-proj">
                <div className="team">
                  <TeamBadge abbr={game.away.abbr} color={game.away.color} />
                  <div className="n">{format1(cg.away_score)}</div>
                  <div className="gp-mid gp-mini">{game.away.abbr} · {game.away.record}</div>
                </div>
                <div className="mid">
                  <div className="tot">{format1(cg.total)}</div>
                  <div className="gp-mid gp-mini">CG TOTAL</div>
                  <div className="pills">
                    <span className="gp-pill over">{cg.total_lean} {signed1(cg.total_edge)} vs {format1(market.total)}</span>
                    <span className="gp-pill side">{cg.side_lean} SIDE</span>
                  </div>
                </div>
                <div className="team">
                  <TeamBadge abbr={game.home.abbr} color={game.home.color} />
                  <div className="n">{format1(cg.home_score)}</div>
                  <div className="gp-mid gp-mini">{game.home.abbr} · {game.home.record}</div>
                </div>
              </div>
              <div className="gp-sidebar">
                <span>Side proj <b>{cg.side_lean} {format1(cg.side_proj)}</b> vs mkt {market.spread.favorite} {format1(market.spread.line)} · edge <b className="gp-hi">{signed1(cg.side_edge)}</b></span>
                <span className="gp-score">CG {format1(cg.cg_score_total)}</span>
              </div>
            </section>
          </div>
          <div className="gp-row2">
            <section className="gp-card">
              <p className="gp-kick">OVER HIT RATES · EXAMPLE</p>
              <HitChips />
            </section>
            <section className="gp-card">
              <p className="gp-kick">LAST 10 COMBINED · VS {format1(market.total)}</p>
              <TotalsChart />
            </section>
            <Components />
          </div>
          <div className="gp-row3">
            <MatchupTable title={`${game.away.abbr} OFF vs ${game.home.abbr} DEF`} rows={example.matchups.dal_off_vs_phi_def} />
            <MatchupTable title={`${game.home.abbr} OFF vs ${game.away.abbr} DEF`} rows={example.matchups.phi_off_vs_dal_def} />
            <Pace />
            <Heat footer={<p className="gp-rg gp-rg-in">{STANDARD_LINE}</p>} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GameProj({ week, layout, onLayout }) {
  return (
    <div className={`gp${layout === 'pro' ? ' is-pro' : ''}`} data-layout={layout}>
      {layout === 'pro'
        ? <ProView week={week} onLayout={onLayout} />
        : <StandardView week={week} onLayout={onLayout} />}
    </div>
  )
}
