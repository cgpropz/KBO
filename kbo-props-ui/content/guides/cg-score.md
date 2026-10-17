<!--
DRAFT, NOT FOR PUBLISH. Owner (Code Green) approval required. Git bot publishes.
Formula status (updated Oct 11, 2:30 PM ET): per-sport formulas for NHL, WNBA, NFL and KBO now come from the
Board QA README (/cursor/stores/store-19e5dc54-5811-406a-a625-469658aadcc7/qa/README.md), which QA confirmed against the site JS on 2026-10-11.
NBA is not covered by the README and stays {{CONFIRM WITH BOARD QA}}. What KBO's stored score measures is also open.
No performance claims: do not add any copy saying higher scores hit more often.
-->

---
title_tag: "How CG Score Works: Projection vs Line | CGPropz"
meta_description: "CG Score ranks every prop by how strongly the model projection disagrees with the line. Higher score means a bigger model edge. 21+."
slug: "/guides/cg-score"   # {{URL PENDING GIT BOT}} (not in Git bot's planned list yet)
canonical: "https://www.cgpropz.com/guides/cg-score"   # {{URL PENDING GIT BOT}}
primary_keyword: "cg score"
secondary_keywords: ["how cg score works", "cgpropz cg score", "what is cg score", "projection vs line player props"]
schema: [Article, BreadcrumbList, FAQPage]
featured_image: "{{GRAPHIC DESIGNER ASSET}}   # suggested: simple dial graphic, 50 in the middle labeled 'projection = line'"
date_published: "{{ISO DATETIME ET AT PUBLISH}}"
date_modified: "{{ISO DATETIME ET AT PUBLISH}}"
status: draft
---

# How CG Score Works

Every prop on a CGPropz board has a CG Score. It answers one question: **how far does our projection sit from the line?** This guide explains how the score is built, how to read it, and what it can't tell you.

## What CG Score measures

A player prop has two numbers that matter here:

- **The line:** the number posted by the pick'em app or sportsbook, for example a points, strikeouts or receiving-yards line.
- **The projection:** what the CGPropz model expects the player to produce, built from recent form, the matchup and the posted line.

CG Score puts those two numbers on one scale, so you can compare props across different stats and players at a glance.

## How the score is calculated

CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee. 21+ · Play responsibly · Entertainment only.

## How to read CG Score on the board

- **Use it to sort, then dig in.** The score helps you find props where the projection and the line disagree the most. Open the player card to see why.
- **Check the side.** A higher score is a bigger model edge. Open the card to see whether the model is on the over or the under.
- **Pair it with hit rates.** The board also shows how often the player cleared today's line over the last ten games, this season and against today's opponent. Always read those with their sample size.
- **Check the news.** The projection is built before late news. If a player's role changes because of injuries, rest or lineup moves, the score may not reflect it yet.
- **Watch for odd lines.** A very low line can make a modest projection look like a huge score. If a score looks extreme, check the line and the stat before acting on it.

## What CG Score does not tell you

- **It is not a probability.** The score ranks the gap between the projection and the line. It does not state the chance of a hit.
- **A higher score does not mean a higher chance of hitting.** We're not claiming that bigger scores win more often. A large gap can come from a real edge, a stale line, or missing information.
- **It does not include the payout.** Pick'em entries need a certain share of correct picks to break even, and that depends on the entry type. CG Score doesn't account for it.
- **It does not include variance.** Two props with the same score can carry very different risk depending on the stat and the player's role.

## Where to find CG Score

- [KBO player props](/kbo-player-props)
- [WNBA player props](/wnba-player-props) {{URL PENDING GIT BOT}}
- [NFL player props](/nfl-player-props) {{URL PENDING GIT BOT}}
- [NBA player props](/nba-player-props) {{URL PENDING GIT BOT}}
- [NHL player props](/nhl-player-props) {{URL PENDING GIT BOT}}

The [free top 3 on the homepage](/#free-top-3) {{URL PENDING GIT BOT}} shows CG Scores for three props a day in each sport with a free preview. All-Access shows the score on every graded prop on the board, alongside projections, hit rates, defense vs. position and the slip builder.

**[Get the full All-Access board →](/pricing)** {{URL PENDING GIT BOT}}

## FAQ

**What is CG Score?**
CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee.

**How is CG Score calculated?**
CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee. 21+ · Play responsibly · Entertainment only.

**Is a higher CG Score more likely to hit?**
Not necessarily. The score measures how strongly the projection disagrees with the line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news.

**What does a lower CG Score mean?**
A lower score means a smaller model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee.

**Is CG Score the same for every sport?**
Yes. CG Score ranks every prop by how strongly the projection disagrees with the line, adjusted for matchup (DvP) and recent form.

**Is CGPropz affiliated with PrizePicks or Underdog?**
No. CGPropz is an independent data and analysis site and is not affiliated with PrizePicks or Underdog.

**JSON-LD (FAQPage)**
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is CG Score?",
      "acceptedAnswer": { "@type": "Answer", "text": "CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee." }
    },
    {
      "@type": "Question",
      "name": "How is CG Score calculated?",
      "acceptedAnswer": { "@type": "Answer", "text": "CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee. 21+ · Play responsibly · Entertainment only." }
    },
    {
      "@type": "Question",
      "name": "Is a higher CG Score more likely to hit?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not necessarily. The score measures how strongly the projection disagrees with the line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news." }
    },
    {
      "@type": "Question",
      "name": "What does a lower CG Score mean?",
      "acceptedAnswer": { "@type": "Answer", "text": "A lower score means a smaller model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee." }
    },
    {
      "@type": "Question",
      "name": "Is CG Score the same for every sport?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. CG Score ranks every prop by how strongly the projection disagrees with the line, adjusted for matchup (DvP) and recent form." }
    },
    {
      "@type": "Question",
      "name": "Is CGPropz affiliated with PrizePicks or Underdog?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. CGPropz is an independent data and analysis site and is not affiliated with PrizePicks or Underdog." }
    }
  ]
}
```

---

### Play responsibly
**21+ only.** Player props and pick'em contests carry financial risk, and no projection or score can promise a result. CGPropz publishes data and analysis for information and entertainment. We don't take wagers. Only play with money you can afford to lose, and check that pick'em contests are legal where you live. If you or someone you know has a gambling problem, call or text **1-800-GAMBLER**.

*CGPropz is not affiliated with or endorsed by PrizePicks or Underdog.*

<!--
SOURCES / NOTES
- Formula, per sport: Board QA README /cursor/stores/store-19e5dc54-5811-406a-a625-469658aadcc7/qa/README.md, section "CG Score (site JS /assets/index-B876gw9W.js, re-verified 2026-10-11 2:25 PM ET after PR #112)". NHL, WNBA, NFL (incl. per-prop minimums) and KBO taken verbatim in meaning; side rule (projection >= line => over) from the same README. NBA: not in README, {{CONFIRM WITH BOARD QA}}.
- Free-tier note (README, verified 2026-10-11 2:25 PM ET): NHL/WNBA free top 3 = top 3 of full board by the formulas; KBO chosen server-side, not the site formula; NFL none.
- Demon/goblin lines on NHL and WNBA boards: verified by Board QA (relayed Oct 11, 2:27 PM ET). NFL/KBO unconfirmed.
- "No claim that higher scores hit more often": guided by the internal lab review at /workspace/shared/lab/cg_score_check/results.md (found CG Score only weakly related to hit rate). Used ONLY to avoid performance claims; not cited as the formula source and no numbers taken from it.
- "Odd lines" caution: internal lab log /workspace/shared/lab/lab_log.md (very small lines produced extreme scores). No numbers used.
- Illustrative example (6.0 / 5.0 / 60 / 40) is arithmetic on made-up inputs, labeled as such. Owner may remove it.
- The board fields mentioned (L10, season, H2H hit rate, DVP, slip builder) are taken from the CGPropz board UI.
-->
