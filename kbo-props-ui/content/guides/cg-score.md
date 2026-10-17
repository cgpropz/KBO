<!--
DRAFT, NOT FOR PUBLISH. Owner (Code Green) approval required. Git bot publishes.
Formula status (updated Oct 11, 2:30 PM ET): per-sport formulas for NHL, WNBA, NFL and KBO now come from the
Board QA README (/cursor/stores/store-19e5dc54-5811-406a-a625-469658aadcc7/qa/README.md), which QA confirmed against the site JS on 2026-10-11.
NBA is not covered by the README and stays {{CONFIRM WITH BOARD QA}}. What KBO's stored score measures is also open.
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

The core method, used across the CGPropz boards, is:

> **CG Score = (projection ÷ line) × 50**

That puts the midpoint at 50:

| CG Score | What it means |
|---|---|
| **50** | The projection equals the line. On NHL this always holds. On WNBA and NFL it holds when the line is at or above that stat's minimum (see below). |
| **Above 50** | The projection is over the line. The higher the score, the further over. |
| **Below 50** | The projection is under the line. The lower the score, the further under. |

**Illustrative example (not a real prop):** if the projection is 6.0 and the line is 5.0, the score is 6.0 ÷ 5.0 × 50 = 60. If the projection is 4.0 against the same line, the score is 40.

Because the score is a ratio, the same gap means more on a small line than on a big one. A projection half a point over a low line produces a bigger score than half a point over a high line.

### By sport

| Sport | Formula on the board |
|---|---|
| NHL | Projection ÷ line × 50 |
| WNBA | Projection ÷ the larger of the prop's own line or a minimum line for that stat, × 50. Demon and goblin lines are scored against their own line. "Points, first 3 minutes" props are left off the board. |
| NFL | Projection ÷ the larger of the line or a minimum line for that prop type, × 50. |
| KBO | The stored KBO score when one exists. Otherwise, projection (or season average when there's no projection) ÷ line × 50. |
| NBA | {{CONFIRM WITH BOARD QA}} |

**All sports:** yardage lines of 0.5 or lower are not scored.

**WNBA minimum lines.** Each WNBA stat has a minimum line, from 0.5 for low-count stats such as blocked shots and offensive rebounds up to 33 for minutes. A few common ones: points 4.5, rebounds 3.5, assists 1.5, points + rebounds + assists 10.5, three-pointers made 1.5. If a prop's line is below its stat's minimum, the minimum is used instead.
<!-- WNBA minLines (README): 3PA 3.5, 3PM 1.5, Ast 1.5, Blks+Stls 1.5, Blk Shots 0.5, DReb 4.5, FGA 9.5, FGM 4.5, Fantasy 15.5, FTA 3.5, FTM 2.5, Minutes 33, OReb 0.5, Pts 4.5, Pts+Asts 7.5, Pts+Rebs 9.5, PRA 10.5, Reb 3.5, Rebs+Asts 5, Stl 1.5, TO 1.5, 2PA 6, 2PM 3.5 (source: /cursor/stores/store-19e5dc54-5811-406a-a625-469658aadcc7/qa/README.md) -->

**NFL minimum lines.** If the posted line is below the minimum for its prop type, the minimum is used instead:

| Prop type | Minimum line |
|---|---|
| Pass attempts | 28.5 |
| Pass completions | 18 |
| Pass TDs | 1 |
| Pass yards | 186.5 |
| Pass + rush yards | 210.5 |
| Targets | 2 |
| Receiving yards | 5.5 |
| Receptions | 1.5 |
| Rush attempts | 2.5 |
| Rush yards | 5.5 |
| Rush + rec yards | 30.5 |

This keeps a tiny line from producing an extreme score. It also means that on WNBA and NFL, when the line is below the minimum, a score of 50 means the projection equals the minimum, not the posted line.

**KBO is different.** When a KBO prop has a stored score, the board shows that score instead of the plain ratio. {{CONFIRM WITH BOARD QA: what KBO's stored score (cg_projection / rating) measures and its scale}}. On KBO, don't assume 50 means the projection equals the line until that's confirmed.

**How the free top 3 is chosen.** On NHL and WNBA, the free top 3 is the top three props on the full board by the formulas above. KBO's free top 3 is chosen on the server and does not follow the site formula. NFL has no free top 3 right now.

**Demon and goblin lines.** The NHL and WNBA boards show demon and goblin lines alongside standard lines, each with its own score. NFL and KBO: {{CONFIRM WITH BOARD QA}}.

**Which side.** The board treats a prop as an over when the projection is at or above the line, and an under when it's below.
<!-- CG Score per-sport formula source: /cursor/stores/store-19e5dc54-5811-406a-a625-469658aadcc7/qa/README.md (section 'CG Score', site JS /assets/index-B876gw9W.js, re-verified 2026-10-11 2:25 PM ET after PR #112) -->

<!-- NHL/WNBA/NFL/KBO rows filled from the Board QA README (path above). NBA row and the KBO stored-score description stay open; do not publish those parts until QA confirms. -->

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
A number that shows how far the CGPropz projection sits from a prop's line. On NHL, 50 means they're equal; on WNBA and NFL, the same holds when the line is at or above that stat's minimum. Above 50 the projection is over, below 50 it's under. KBO may show a stored score on a different basis.

**How is CG Score calculated?**
Projection divided by line, multiplied by 50. WNBA and NFL use a minimum line for each stat when the posted line is lower, and KBO shows its stored score when one exists. See the by-sport table.

**Is a higher CG Score more likely to hit?**
Not necessarily. The score measures the gap between projection and line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news.

**What does a CG Score below 50 mean?**
The projection is under the line. The further below 50, the further under the line the model projects the player.

**Is CG Score the same for every sport?**
Not exactly. The core is projection compared with the line, but WNBA and NFL apply a minimum line per stat, and KBO shows a stored score when one exists. Check the by-sport section of this guide.

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
      "acceptedAnswer": { "@type": "Answer", "text": "A number that shows how far the CGPropz projection sits from a prop's line. On NHL, 50 means they're equal; on WNBA and NFL, the same holds when the line is at or above that stat's minimum. Above 50 the projection is over, below 50 it's under. KBO may show a stored score on a different basis." }
    },
    {
      "@type": "Question",
      "name": "How is CG Score calculated?",
      "acceptedAnswer": { "@type": "Answer", "text": "Projection divided by line, multiplied by 50. WNBA and NFL use a minimum line for each stat when the posted line is lower, and KBO shows its stored score when one exists. See the by-sport table." }
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
      "acceptedAnswer": { "@type": "Answer", "text": "Not exactly. The core is projection compared with the line, but WNBA and NFL apply a minimum line per stat, and KBO shows a stored score when one exists. Check the by-sport section of this guide." }
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
