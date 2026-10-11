<!--
DRAFT, NOT FOR PUBLISH. Owner (Code Green) approval required. Git bot publishes.
Formula status: the only written definition is the note on the CGPropz NHL page ("projection ÷ line × 50").
This page presents it as the site's stated method, NOT a QA-verified formula. Per-sport formulas
for KBO, NFL and WNBA are {{CONFIRM WITH BOARD QA}}.
No performance claims: do not add any copy saying higher scores hit more often.
-->

---
title_tag: "How CG Score Works: Projection vs Line | CGPropz"
meta_description: "CG Score shows how far the CGPropz projection sits from a prop line. Learn how to read it, what 50 means, and what it doesn't tell you. 21+."
slug: "/guides/cg-score"   # {{URL PENDING GIT BOT}} (not in Git bot's planned list yet)
canonical: "https://www.cgpropz.com/guides/cg-score"   # {{URL PENDING GIT BOT}}
primary_keyword: "cg score"
secondary_keywords: ["how cg score works", "cgpropz cg score", "what is cg score", "projection vs line player props"]
schema: [Article, BreadcrumbList, FAQPage]
featured_image: "{{GRAPHIC DESIGNER ASSET}}   # suggested: simple dial graphic, 50 in the middle labeled 'projection = line'"
date_published: "2026-10-11T13:10:00-04:00"
date_modified: "2026-10-11T13:10:00-04:00"
status: published
---

# How CG Score Works

Every prop on a CGPropz board has a CG Score. It answers one question: **how far does our projection sit from the line?** This guide explains how the score is built, how to read it, and what it can't tell you.

## What CG Score measures

A player prop has two numbers that matter here:

- **The line:** the number posted by the pick'em app or sportsbook, for example a points, strikeouts or receiving-yards line.
- **The projection:** what the CGPropz model expects the player to produce, built from recent form, the matchup and the posted line.

CG Score puts those two numbers on one scale, so you can compare props across different stats and players at a glance.

## How the score is calculated

The method stated on the CGPropz site (in the note on the NHL board page) is:

> **CG Score = (projection ÷ line) × 50**

That puts the midpoint at 50:

| CG Score | What it means |
|---|---|
| **50** | The projection equals the line. |
| **Above 50** | The projection is over the line. The higher the score, the further over. |
| **Below 50** | The projection is under the line. The lower the score, the further under. |

**Illustrative example (not a real prop):** if the projection is 6.0 and the line is 5.0, the score is 6.0 ÷ 5.0 × 50 = 60. If the projection is 4.0 against the same line, the score is 40.

Because the score is a ratio, the same gap means more on a small line than on a big one. A projection half a point over a low line produces a bigger score than half a point over a high line.

### By sport

| Sport | Formula on the board |
|---|---|
| NHL | Projection ÷ line × 50 (stated on the NHL board page) |
| WNBA | {{CONFIRM WITH BOARD QA}} |
| NFL | {{CONFIRM WITH BOARD QA}} |
| KBO | {{CONFIRM WITH BOARD QA}}. The KBO board may rank its free plays by a separate decision score rather than the plain ratio. |

<!-- Do not publish the By sport table until Board QA confirms each row. If KBO uses a different score, add a short subsection naming it and how it differs, in QA's wording. -->

## How to read CG Score on the board

- **Use it to sort, then dig in.** The score helps you find props where the projection and the line disagree the most. Open the player card to see why.
- **Check the side.** A score well above 50 points to the over; well below 50 points to the under. Close to 50 means the model and the line roughly agree.
- **Pair it with hit rates.** The board also shows how often the player cleared today's line over the last ten games, this season and against today's opponent. Always read those with their sample size.
- **Check the news.** The projection is built before late news. If a player's role changes because of injuries, rest or lineup moves, the score may not reflect it yet.
- **Watch for odd lines.** A very low line can make a modest projection look like a huge score. If a score looks extreme, check the line and the stat before acting on it.

## What CG Score does not tell you

- **It is not a probability.** A score of 70 does not mean a 70% chance. It describes the gap between projection and line, nothing more.
- **A higher score does not mean a higher chance of hitting.** We're not claiming that bigger scores win more often. A large gap can come from a real edge, a stale line, or missing information.
- **It does not include the payout.** Pick'em entries need a certain share of correct picks to break even, and that depends on the entry type. CG Score doesn't account for it.
- **It does not include variance.** Two props with the same score can carry very different risk depending on the stat and the player's role.

Graded results, including misses, are public on the [KBO full-board results page](/kbo-player-props), so you can see how the board has actually performed.

## Where to find CG Score

- [KBO player props](/kbo-player-props)
- [WNBA player props](/wnba-player-props) {{URL PENDING GIT BOT}}
- [NFL player props](/nfl-player-props) {{URL PENDING GIT BOT}}
- [NBA player props](/nba-player-props) {{URL PENDING GIT BOT}}
- [NHL player props](/nhl-player-props) {{URL PENDING GIT BOT}}

The free top 3 for each sport shows CG Scores for three props a day. All-Access shows the score on every graded prop on the board, alongside projections, hit rates, defense vs. position and the slip builder.

**[Get the full All-Access board →](/pricing)** {{URL PENDING GIT BOT}}

## FAQ

**What is CG Score?**
A number that shows how far the CGPropz projection sits from a prop's line. At 50 they're equal; above 50 the projection is over the line, below 50 it's under.

**How is CG Score calculated?**
The site's stated method is projection divided by line, multiplied by 50. Sport-specific details are being confirmed and will be listed on this page.

**Is a higher CG Score more likely to hit?**
Not necessarily. The score measures the gap between projection and line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news.

**What does a CG Score below 50 mean?**
The projection is under the line. The further below 50, the further under the line the model projects the player.

**Is CG Score the same for every sport?**
The general method is the same idea everywhere: projection compared with the line. Some sports may use a different score for ranking free plays. Check the by-sport section of this guide.

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
      "acceptedAnswer": { "@type": "Answer", "text": "A number that shows how far the CGPropz projection sits from a prop's line. At 50 they're equal; above 50 the projection is over the line, below 50 it's under." }
    },
    {
      "@type": "Question",
      "name": "How is CG Score calculated?",
      "acceptedAnswer": { "@type": "Answer", "text": "The site's stated method is projection divided by line, multiplied by 50. Sport-specific details are being confirmed and will be listed on this page." }
    },
    {
      "@type": "Question",
      "name": "Is a higher CG Score more likely to hit?",
      "acceptedAnswer": { "@type": "Answer", "text": "Not necessarily. The score measures the gap between projection and line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news." }
    },
    {
      "@type": "Question",
      "name": "What does a CG Score below 50 mean?",
      "acceptedAnswer": { "@type": "Answer", "text": "The projection is under the line. The further below 50, the further under the line the model projects the player." }
    },
    {
      "@type": "Question",
      "name": "Is CG Score the same for every sport?",
      "acceptedAnswer": { "@type": "Answer", "text": "The general method is the same idea everywhere: projection compared with the line. Some sports may use a different score for ranking free plays. Check the by-sport section of this guide." }
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
- Formula: the site's stated method, per the note on the CGPropz NHL board page ("projection ÷ line × 50"), as relayed by Board QA Bot / Git bot on Oct 11, 2026. Not QA-verified. KBO/NFL/WNBA: {{CONFIRM WITH BOARD QA}}.
- "No claim that higher scores hit more often": guided by the internal lab review at /workspace/shared/lab/cg_score_check/results.md (found CG Score only weakly related to hit rate). Used ONLY to avoid performance claims; not cited as the formula source and no numbers taken from it.
- "Odd lines" caution: internal lab log /workspace/shared/lab/lab_log.md (very small lines produced extreme scores). No numbers used.
- Illustrative example (6.0 / 5.0 / 60 / 40) is arithmetic on made-up inputs, labeled as such. Owner may remove it.
- The board fields mentioned (L10, season, H2H hit rate, DVP, slip builder) are taken from the CGPropz board UI.
-->
