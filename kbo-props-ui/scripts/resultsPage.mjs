import {
  BREAK_EVEN_PCT,
  SPORT_NAME,
  SPORT_ORDER,
  finishRecord,
  formatHitRate,
  formatWlp,
  rangeLabel,
  resultLabel,
  tierLabel,
} from '../src/resultsLedger.js'
import { INDEPENDENCE_LINE, STANDARD_LINE } from '../src/responsibleGambling.js'
import { breadcrumbNode, escapeHtml, pageUrl, renderDocument } from './seoShared.mjs'

export const RESULTS_TITLE = 'Results: Every Graded Pick | CGPropz'
export const RESULTS_DESCRIPTION = 'Every graded CGPropz pick, wins and losses (W-L-P), by sport and market. Free and member records stay separate. 21+.'
export const POSTED_TIME_NOTE = "Each pick's posted time is recorded by our pipeline when the board publishes and compared to the game's scheduled start; picks posted after start are excluded."
export const RESULTS_DISCLAIMER = 'Past results do not guarantee future results. Projections are for informational and entertainment purposes only and are not betting advice or a guarantee of any outcome. 21+. Gambling problem? Call 1-800-GAMBLER.'

function recordFrom(raw) {
  return finishRecord(raw)
}

function tiles(record) {
  return `<div class="stats">
    <div class="st"><b>W-L-P</b><span>${formatWlp(record)}</span></div>
    <div class="st"><b>HIT RATE</b><span>${formatHitRate(record.rate)}</span></div>
    <div class="st"><b>n GRADED</b><span>${record.n}</span></div>
  </div>
  <div class="bar" aria-hidden="true"><div class="ghost"></div><div class="be"></div><div class="bel">${BREAK_EVEN_PCT}% reference</div></div>
  <div class="barl"><span>0%</span><span>50%</span><span>100%</span></div>`
}

function card(name, blurb, record, start, end) {
  const badge = record.small ? `<span class="small">SMALL SAMPLE · n &lt; ${200}</span>` : ''
  return `<article class="card rc" data-sport-panel="${escapeHtml(name.sport)}">
    <div class="top"><span class="lab">${escapeHtml(name.label)}</span>${badge}</div>
    <p class="blurb">${escapeHtml(blurb)}</p>
    ${tiles(record)}
    <p class="note">Dates <span class="mono">${escapeHtml(rangeLabel(start, end))}</span> · voids are left out of n · pushes count in W-L-P, not in the hit rate</p>
  </article>`
}

function sportCards(snapshot, sport) {
  const block = snapshot.sports[sport]
  const free = recordFrom(block.free)
  const member = recordFrom(block.member)
  const label = SPORT_NAME[sport]
  return `<div class="split" data-sport-panel="${sport}" ${sport === 'nfl' ? '' : 'hidden'}>
    ${card({ sport, label: `${label} · Free top 3` }, 'The daily free top 3, posted publicly', free, block.free.start, block.free.end)}
    ${card({ sport, label: `${label} · Member board` }, 'Full board lines, as ranked by CG Score', member, block.member.start, block.member.end)}
  </div>`
}

function seasonTable(snapshot) {
  const rows = SPORT_ORDER.map((sport) => {
    const block = snapshot.sports[sport]
    const free = recordFrom(block.free)
    const member = recordFrom(block.member)
    const range = rangeLabel(
      [block.free.start, block.member.start].filter(Boolean).sort()[0],
      [block.free.end, block.member.end].filter(Boolean).sort().at(-1),
    )
    const cell = (record) => `<td class="n">${formatWlp(record)}</td><td class="n">${formatHitRate(record.rate)}</td><td class="n">${record.n}</td>`
    return `<tr><td><b>${SPORT_NAME[sport]}</b></td>${cell(free)}${cell(member)}<td class="n desk">${escapeHtml(range)}</td></tr>`
  }).join('')
  return `<div class="tbl"><table class="season"><thead>
    <tr><th></th><th class="grp" colspan="3">FREE TOP 3</th><th class="grp" colspan="3">MEMBER BOARD</th><th class="desk"></th></tr>
    <tr><th>SPORT</th><th>W-L-P</th><th>HIT %</th><th>n</th><th>W-L-P</th><th>HIT %</th><th>n</th><th class="desk">RANGE</th></tr>
    </thead><tbody>${rows}</tbody></table></div>`
}

function marketTable(snapshot, sport) {
  const rows = (snapshot.markets[sport] || []).map((item) => {
    const free = recordFrom(item.free)
    const member = recordFrom(item.member)
    const cell = (record) => `<td class="n">${formatWlp(record)}</td><td class="n">${formatHitRate(record.rate)}</td><td class="n">${record.n}</td>`
    return `<tr><td>${escapeHtml(item.market)}</td>${cell(free)}${cell(member)}</tr>`
  }).join('')
  return `<div class="tbl" data-sport-panel="${sport}" ${sport === 'nfl' ? '' : 'hidden'}><table class="season"><thead>
    <tr><th></th><th class="grp" colspan="3">FREE TOP 3</th><th class="grp" colspan="3">MEMBER BOARD</th></tr>
    <tr><th>MARKET</th><th>W-L-P</th><th>HIT %</th><th>n</th><th>W-L-P</th><th>HIT %</th><th>n</th></tr>
    </thead><tbody>${rows}</tbody></table></div>`
}

function historyRows(snapshot, sport) {
  return snapshot.history.filter((row) => row.sport === sport)
}

function historyTable(rows) {
  const desk = rows.map((row) => {
    const final = row.final == null ? '—' : String(row.final)
    const score = row.score == null ? '—' : String(row.score)
    return `<tr data-sport-row="${escapeHtml(row.sport)}" ${row.sport === 'nfl' ? '' : 'hidden'}>
      <td class="n">${escapeHtml(row.date.slice(5))}</td>
      <td>${escapeHtml(SPORT_NAME[row.sport] || row.sport)}</td>
      <td>${escapeHtml(tierLabel(row.tier))}</td>
      <td>${escapeHtml(row.player)}</td>
      <td>${escapeHtml(row.market)}</td>
      <td class="n">${escapeHtml(String(row.line))}</td>
      <td>${escapeHtml(row.side || '—')}</td>
      <td class="n">${escapeHtml(score)}</td>
      <td class="n">${escapeHtml(final)}</td>
      <td class="n">${escapeHtml(row.posted)} ET</td>
      <td><span class="chip ${escapeHtml(row.result)}">${resultLabel(row.result)}</span></td>
    </tr>`
  }).join('')
  const cards = rows.map((row) => {
    const final = row.final == null ? '—' : String(row.final)
    const score = row.score == null ? '—' : String(row.score)
    return `<div class="mc" data-sport-row="${escapeHtml(row.sport)}" ${row.sport === 'nfl' ? '' : 'hidden'}>
      <div class="r1"><span>${escapeHtml(row.date.slice(5))} · ${escapeHtml(SPORT_NAME[row.sport])} · ${escapeHtml(tierLabel(row.tier))}</span><span class="chip ${escapeHtml(row.result)}">${resultLabel(row.result)}</span></div>
      <div class="r2">${escapeHtml(row.player)} · ${escapeHtml(row.market)} ${escapeHtml(row.side)} ${escapeHtml(String(row.line))}</div>
      <div class="r3"><span>CG ${escapeHtml(score)}</span><span>Final ${escapeHtml(final)}</span><span>Posted ${escapeHtml(row.posted)} ET</span></div>
    </div>`
  }).join('')
  return `<div class="tbl"><table class="desk"><thead><tr>
    <th>DATE</th><th>SPORT</th><th>TIER</th><th>PLAYER</th><th>MARKET</th><th>LINE</th><th>SIDE</th><th>CG SCORE</th><th>FINAL</th><th>POSTED (ET)</th><th>RESULT</th>
    </tr></thead><tbody>${desk}</tbody></table><div class="mcards">${cards}</div></div>`
}

const PAGE_STYLE = `
.res-meta{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}
.mpill{display:inline-flex;gap:8px;align-items:center;padding:7px 12px;border-radius:999px;background:#ffffff0d;border:1px solid rgba(255,255,255,.1);font:700 12px ui-monospace,monospace;color:#d4d4d8}
.mpill b{color:#8f939b;letter-spacing:1px}
.ctl{margin-top:22px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tabs button{border:1px solid rgba(255,255,255,.14);background:transparent;color:#d4d4d8;border-radius:999px;padding:7px 12px;font:700 13px inherit;cursor:pointer}
.tabs button.on{background:#22c55e;color:#04140a;border-color:#22c55e}
.split{margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.card{padding:18px;border-radius:20px;background:#080c0a;border:1px solid rgba(255,255,255,.08)}
.top{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.lab{font-size:12px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:#d4d4d8}
.blurb{margin:6px 0 0;color:#8f939b;font-size:13px}
.stats{margin-top:14px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.st{padding:12px;border-radius:12px;background:rgba(5,5,6,.55);border:1px solid rgba(255,255,255,.08)}
.st b{display:block;font:800 10.5px ui-monospace,monospace;letter-spacing:1px;color:#8f939b}
.st span{display:block;margin-top:4px;font:800 22px ui-monospace,monospace;color:#a1a1aa}
.bar{position:relative;margin-top:28px;height:10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.bar .be{position:absolute;left:54.2%;top:-8px;bottom:-8px;width:2px;background:#e4e4e7}
.bar .bel{position:absolute;left:54.2%;top:-22px;transform:translateX(-50%);font:800 10.5px ui-monospace,monospace;color:#e4e4e7;white-space:nowrap}
.bar .ghost{position:absolute;inset:0;border-radius:999px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 6px,transparent 6px 12px)}
.barl{margin-top:6px;display:flex;justify-content:space-between;font:700 10.5px ui-monospace,monospace;color:#52525b}
.note,.quiet{margin-top:12px;font-size:12.5px;color:#8f939b}
.small{color:#f6c35f;background:rgba(246,195,95,.12);border:1px solid rgba(246,195,95,.45);border-radius:999px;padding:3px 9px;font:800 10.5px ui-monospace,monospace}
.tbl{margin-top:14px;border-radius:20px;border:1px solid rgba(255,255,255,.08);background:#080c0a;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font:800 10.5px ui-monospace,monospace;letter-spacing:1px;color:#8f939b;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.14);white-space:nowrap}
td{padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.08);color:#d4d4d8;white-space:nowrap}
td.n{font-family:ui-monospace,monospace;color:#a1a1aa}
.two{margin-top:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.box h3{margin:6px 0 0;font-size:16px}
.box p,.box li{font-size:13.5px;color:#a1a1aa}
.ph{border-bottom:1px dashed #f6c35f;color:#f6c35f}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.2);font:800 11px ui-monospace,monospace}
.chip.H{color:#4ade80;border-color:rgba(74,222,128,.5)}
.chip.M{color:#f87171;border-color:rgba(248,113,113,.5)}
.chip.V{color:#8f939b}
.mcards{display:none}
.mc{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
.mc .r1{display:flex;justify-content:space-between;gap:8px;font:700 12px ui-monospace,monospace;color:#8f939b}
.mc .r2{margin-top:6px;font-weight:700;color:#fff}
.mc .r3{margin-top:4px;display:flex;flex-wrap:wrap;gap:8px 12px;font:600 12px ui-monospace,monospace;color:#a1a1aa}
.req{margin-top:28px;font-size:13px;color:#a1a1aa}
.kick{color:#4ade80;font-size:12px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase}
h1{font-size:clamp(34px,5.4vw,56px);line-height:1.02;letter-spacing:-1.5px;margin:8px 0}
h2{font-size:clamp(24px,3.4vw,36px);letter-spacing:-.6px}
.grad{background:linear-gradient(90deg,#22c55e,#4ade80);-webkit-background-clip:text;background-clip:text;color:transparent}
@media(max-width:900px){.split,.two{grid-template-columns:1fr}}
@media(max-width:720px){.desk{display:none}.mcards{display:block}.st span{font-size:17px}}
`

const PAGE_SCRIPT = `
<script>
document.querySelectorAll('[data-sport-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const sport = button.getAttribute('data-sport-tab')
    document.querySelectorAll('[data-sport-tab]').forEach((item) => item.classList.toggle('on', item === button))
    document.querySelectorAll('[data-sport-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-sport-panel') !== sport
    })
    document.querySelectorAll('[data-sport-row]').forEach((row) => {
      row.hidden = row.getAttribute('data-sport-row') !== sport
    })
    const label = document.querySelector('[data-market-label]')
    if (label) label.textContent = 'By market · ' + button.textContent
  })
})
</script>`

export function renderResultsPage(snapshot) {
  const updatedLabel = snapshot.updatedAt
    ? `${new Date(snapshot.updatedAt).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })} ET`
    : '—'
  const seasonLine = !snapshot.earliestSlate
    ? 'No graded picks yet.'
    : snapshot.seasonMatchesLast30
      ? `Last 30 days matches this season record. The earliest graded slate is ${rangeLabel(snapshot.earliestSlate, snapshot.earliestSlate)}.`
      : `The earliest graded slate is ${rangeLabel(snapshot.earliestSlate, snapshot.earliestSlate)}. Last 30 days is a shorter window than the season record.`
  const cards = SPORT_ORDER.map((sport) => sportCards(snapshot, sport)).join('')
  const markets = SPORT_ORDER.map((sport) => marketTable(snapshot, sport)).join('')
  const tabs = SPORT_ORDER.map((sport) => `<button type="button" data-sport-tab="${sport}" class="${sport === 'nfl' ? 'on' : ''}">${SPORT_NAME[sport]}</button>`).join('')
  const bodyHtml = `<style>${PAGE_STYLE}</style>
    <p class="kick">Results</p>
    <h1>Every graded pick. <span class="grad">Wins and losses (W-L-P).</span></h1>
    <p>Every graded pick, wins and losses (W-L-P), by sport, market, and tier. Misses stay in the totals. Pushes count in W-L-P and not in the hit rate. Voids stay on the list and stay out of n.</p>
    <p class="quiet">${escapeHtml(POSTED_TIME_NOTE)}</p>
    <div class="res-meta">
      <span class="mpill"><b>RANGE</b> ${escapeHtml(rangeLabel(snapshot.earliestSlate, snapshot.latestSlate))}</span>
      <span class="mpill"><b>UPDATED</b> ${escapeHtml(updatedLabel)}</span>
      <span class="mpill"><b>SOURCE</b> Board QA ledger</span>
    </div>
    <div class="ctl"><div class="tabs" role="tablist">${tabs}</div></div>
    ${cards}
    <p class="quiet">Free and member records are tracked separately and never combined. Each sport has its own record.</p>
    <section>
      <p class="kick">By sport</p>
      <h2>Season record by sport</h2>
      <p class="quiet">${escapeHtml(seasonLine)}</p>
      ${seasonTable(snapshot)}
    </section>
    <section>
      <p class="kick" data-market-label>By market · NFL</p>
      <h2>Record by market</h2>
      ${markets}
    </section>
    <div class="two">
      <article class="card box">
        <p class="kick">What ${BREAK_EVEN_PCT}% means</p>
        <h3>The break-even reference</h3>
        <p>${BREAK_EVEN_PCT}% is the reference break-even. It is a reference line, not a target or a forecast.</p>
        <p>Beating it over a season does not mean every slip makes money. Results vary slip to slip, and small samples swing.</p>
      </article>
      <article class="card box">
        <p class="kick">How grading works</p>
        <h3>Definitions</h3>
        <p><b>HIT</b> Final stat lands on the posted side of the line.</p>
        <p><b>MISS</b> Final stat lands on the other side.</p>
        <p><b>Push:</b> the result landed exactly on the line; it counts in W-L-P but not in the hit rate.</p>
        <p><b>Void:</b> the pick was cancelled or the player didn't play; it's left out of the record.</p>
      </article>
    </div>
    <section>
      <p class="kick">Full history</p>
      <h2>Every graded pick, by slate</h2>
      <p class="quiet">${escapeHtml(snapshot.historyNote)}</p>
      ${historyTable(snapshot.history)}
    </section>
    <p class="req">${escapeHtml(RESULTS_DISCLAIMER)}</p>
    <p class="req">${escapeHtml(INDEPENDENCE_LINE)}</p>
    <p class="req">${escapeHtml(STANDARD_LINE)}</p>
    ${PAGE_SCRIPT}`
  return {
    path: '/results',
    file: 'results.html',
    title: RESULTS_TITLE,
    description: RESULTS_DESCRIPTION,
    html: renderDocument({
      title: RESULTS_TITLE,
      description: RESULTS_DESCRIPTION,
      path: '/results',
      bodyHtml,
      schemas: [breadcrumbNode([{ name: 'Home', url: pageUrl('/') }, { name: 'Results', url: pageUrl('/results') }])],
    }),
  }
}
