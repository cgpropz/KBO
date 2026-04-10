import { useMemo, useState } from 'react'
import './TutorialPage.css'

const PAGE_GUIDES = [
  {
    id: 'pitchers',
    screenshot: '/tutorial-screenshots/pitchers.png',
    view: 'projections',
    title: 'Pitchers Page',
    subtitle: 'Strikeout projections and confidence filters',
    why: 'Use this page to quickly isolate K-heavy starters with stable workload and favorable matchups.',
    factors: [
      'Projected strikeouts vs line gap (target at least +0.6).',
      'Recent pitch count and leash trend across last 3 starts.',
      'Opponent K% split vs pitcher handedness.',
      'Weather impact on command (wind, rain risk, humidity).',
      'Bullpen stress for the opponent (longer leash upside).',
    ],
    workflow: [
      'Sort by projected edge first, then open candidates with consistent inning volume.',
      'Check if strikeout projection stays stable across recent starts, not just one spike.',
      'Cross-check with matchup context before final card placement.',
    ],
  },
  {
    id: 'props',
    screenshot: '/tutorial-screenshots/props.png',
    view: 'props',
    title: 'Player Props Page',
    subtitle: 'Best line shopping and edge validation',
    why: 'Treat this page as your execution screen once you have a short list from projections and matchup checks.',
    factors: [
      'Difference between model probability and book implied probability.',
      'Line movement direction and speed before lock.',
      'Book-to-book price differences on the same market.',
      'Correlated outcomes that can inflate risk in one slip.',
      'Late lineup/news changes that alter role stability.',
    ],
    workflow: [
      'Open all viable props, then remove markets with weak edge after vig adjustment.',
      'Prioritize props with both model edge and market confirmation.',
      'Build slips with low-correlation combinations first.',
    ],
  },
  {
    id: 'batters',
    screenshot: '/tutorial-screenshots/batters.png',
    view: 'batters',
    title: 'Batters Page',
    subtitle: 'Contact profile, power zones, and split leverage',
    why: 'This page helps identify hitters whose profile aligns with the opposing pitcher\'s weaknesses.',
    factors: [
      'ISO and hard-hit trend over rolling windows.',
      'Pitch-type performance against today\'s starter mix.',
      'Platoon split edge and batting order position.',
      'Park factor and weather-assisted carry conditions.',
      'Recent walk/contact balance to avoid empty volatility.',
    ],
    workflow: [
      'Start with split advantage, then confirm contact quality trend.',
      'Use lineup spot to estimate plate appearance opportunity.',
      'Fade hitters with poor matchup profile despite short-term streaks.',
    ],
  },
  {
    id: 'rankings',
    screenshot: '/tutorial-screenshots/rankings.png',
    view: 'rankings',
    title: 'Pitcher Rankings Page',
    subtitle: 'Macro tiering for slate context',
    why: 'Rankings are best used as context, not a final decision source, to avoid over-weighting one metric stack.',
    factors: [
      'Tier separation between top arms and mid-range options.',
      'Command indicators (BB%, first-pitch strike rate, zone%).',
      'Expected regression flags from luck-sensitive stats.',
      'Matchup-adjusted run prevention baseline.',
      'Consistency profile (ceiling vs floor reliability).',
    ],
    workflow: [
      'Use tiers to allocate risk exposure across your picks.',
      'Avoid forcing bets on low-separation ranking clusters.',
      'Treat major ranking outliers as review targets on Matchups.',
    ],
  },
  {
    id: 'tracker',
    screenshot: '/tutorial-screenshots/tracker.png',
    view: 'tracker',
    title: 'Tracker Page',
    subtitle: 'Feedback loop and model discipline',
    why: 'This page improves decision quality over time by revealing recurring mistakes and overfitted instincts.',
    factors: [
      'Win rate by market type and confidence tier.',
      'CLV trend vs closing number across weeks.',
      'Performance by game context (home/away/weather tiers).',
      'Result distribution for correlated slips vs singles.',
      'Profit decay patterns after line movement chases.',
    ],
    workflow: [
      'Review tracker before building new slips to avoid repeating weak patterns.',
      'Lower exposure in markets with persistent negative CLV.',
      'Promote systems that win with strong CLV and stable sample size.',
    ],
  },
  {
    id: 'optimizer',
    screenshot: '/tutorial-screenshots/optimizer.png',
    view: 'optimizer',
    title: 'Slip Builder Page',
    subtitle: 'Structured risk and portfolio construction',
    why: 'Use the optimizer to convert good individual edges into balanced slips with controlled downside.',
    factors: [
      'Correlation matrix between selected props.',
      'Total slip variance and payout asymmetry.',
      'Exposure caps by team/game and market class.',
      'Mix of high-floor anchors and high-ceiling swings.',
      'Expected value at slip level, not only pick level.',
    ],
    workflow: [
      'Build a conservative core first, then add one high-upside leg if needed.',
      'Set maximum same-game exposure before finalizing slips.',
      'Export and track slip archetypes for postgame review.',
    ],
  },
  {
    id: 'matchups',
    screenshot: '/tutorial-screenshots/matchups.png',
    view: 'matchups',
    title: 'Matchups Page',
    subtitle: 'Context engine for weather, lines, and tactical fit',
    why: 'Matchups is your final validation page because it combines weather, market movement, and tactical game context.',
    factors: [
      'Moneyline, run line, and total movement by timestamp.',
      'Weather conditions that affect strikeout and batted-ball profile.',
      'Bullpen availability and probable usage pressure.',
      'Handedness interactions across projected lineups.',
      'Game pace and expected leverage innings.',
    ],
    workflow: [
      'Confirm your top picks still align after odds and weather refresh.',
      'Downgrade props when market and matchup both conflict with your model.',
      'Lock only picks that remain strong across all context layers.',
    ],
  },
]

function SnapshotCard({ title, subtitle, id, screenshot }) {
  const fallbackImage = useMemo(() => `/tutorial-screenshots/${id}.svg`, [id])
  const [imageSrc, setImageSrc] = useState(screenshot)

  return (
    <div className="tutorial-snapshot" role="img" aria-label={`${title} tutorial snapshot`}>
      <div className="tutorial-snapshot-browser">
        <span />
        <span />
        <span />
      </div>
      <div className="tutorial-snapshot-header">
        <div>
          <p>{title}</p>
          <small>{subtitle}</small>
        </div>
        <strong>Live View</strong>
      </div>
      <img
        className="tutorial-snapshot-image"
        src={imageSrc}
        alt={`${title} screenshot preview`}
        loading="lazy"
        onError={() => {
          if (imageSrc !== fallbackImage) {
            setImageSrc(fallbackImage)
          }
        }}
      />
      <div className="tutorial-caption">Add PNG screenshot at {screenshot}. If missing, placeholder is shown.</div>
    </div>
  )
}

function TutorialPage({ onNavigate }) {
  return (
    <main className="tutorial-page">
      <section className="tutorial-hero">
        <div className="tutorial-hero-text">
          <p className="tutorial-eyebrow">KBO Props Playbook</p>
          <h1>How To Use Every Page For Better Player Prop Research</h1>
          <p>
            This guided workflow is built for fast daily prep: discover edges, validate context,
            build disciplined slips, and review outcomes. Follow the sequence below to reduce noise
            and focus only on factors that drive long-term expected value.
          </p>
          <div className="tutorial-hero-actions">
            <button type="button" onClick={() => onNavigate('home')}>Back to Home</button>
            <a href="#page-guides">Jump to Guides</a>
          </div>
        </div>
        <div className="tutorial-hero-score">
          <article>
            <strong>7</strong>
            <span>Core Pages Covered</span>
          </article>
          <article>
            <strong>35+</strong>
            <span>Research Signals</span>
          </article>
          <article>
            <strong>4-Step</strong>
            <span>Daily Workflow</span>
          </article>
        </div>
      </section>

      <section className="tutorial-workflow" aria-label="recommended workflow">
        <h2>Recommended Daily Flow</h2>
        <ol>
          <li><span>1</span> Start with Pitchers and Batters pages to create a focused candidate pool.</li>
          <li><span>2</span> Validate tactical context inside Matchups and Pitcher Rankings.</li>
          <li><span>3</span> Execute best available lines on Player Props and build slips in Optimizer.</li>
          <li><span>4</span> Close the loop in Tracker and tune your process for the next slate.</li>
        </ol>
      </section>

      <section id="page-guides" className="tutorial-guides">
        {PAGE_GUIDES.map((guide) => (
          <article key={guide.id} className="tutorial-guide-card">
            <div className="tutorial-guide-head">
              <div>
                <p className="tutorial-guide-tag">{guide.view.toUpperCase()}</p>
                <h3>{guide.title}</h3>
                <p>{guide.subtitle}</p>
              </div>
            </div>

            <div className="tutorial-guide-layout">
              <SnapshotCard
                title={guide.title}
                subtitle={guide.subtitle}
                id={guide.id}
                screenshot={guide.screenshot}
              />

              <div className="tutorial-guide-content">
                <section>
                  <h4>Why This Page Matters</h4>
                  <p>{guide.why}</p>
                </section>

                <section>
                  <h4>Best Factors To Evaluate</h4>
                  <ul>
                    {guide.factors.map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h4>How To Use It Efficiently</h4>
                  <ul>
                    {guide.workflow.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}

export default TutorialPage
