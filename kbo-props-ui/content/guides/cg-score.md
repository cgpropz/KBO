<!--
DRAFT, NOT FOR PUBLISH. Owner (Code Green) approval required. Git bot publishes.
No performance claims: do not add any copy saying higher scores hit more often.
Do not publish the scoring formula, weights, or line minimums.
-->

---
title_tag: "How CG Score Works: Projection vs Line | CGPropz"
meta_description: "CG Score ranks every prop by how strongly the model projection disagrees with the line. Higher score means a bigger model edge. 21+."
slug: "/guides/cg-score"   # {{URL PENDING GIT BOT}} (not in Git bot's planned list yet)
canonical: "https://www.cgpropz.com/guides/cg-score"   # {{URL PENDING GIT BOT}}
primary_keyword: "cg score"
secondary_keywords: ["how cg score works", "cgpropz cg score", "what is cg score", "projection vs line player props"]
schema: [Article, BreadcrumbList, FAQPage]
featured_image: "{{GRAPHIC DESIGNER ASSET}}   # diagram: projection vs line, adjusted for matchup"
date_published: "{{ISO DATETIME ET AT PUBLISH}}"
date_modified: "{{ISO DATETIME ET AT PUBLISH}}"
status: draft
---

# How CG Score Works

Every prop on a CGPropz board has a CG Score. It answers one question: **how far does our projection sit from the line?** This guide explains what the number means, how to read it, and what it can't tell you.

## What CG Score measures

A player prop has two numbers that matter here:

- **The line:** the number posted by the pick'em app or sportsbook, for example a points, strikeouts or receiving-yards line.
- **The projection:** what the CGPropz model expects the player to produce, built from recent form, the matchup and the posted line.

CG Score puts those two numbers on one scale, so you can compare props across different stats and players at a glance.

## How the score is calculated

CG Score shows how far the CGPropz projection sits from the line. The CGPropz model compares its projection with the posted line and turns that comparison into one score, centered on 50:

- **Around 50:** the projection and the line are roughly even.
- **Above 50:** the model leans over.
- **Below 50:** the model leans under.

A bigger gap from 50 means a bigger gap between the model and the line. It's a measure of that gap, not a probability, and not a claim that higher scores hit more often.

### Reading a score

| CG Score | How to read it |
|---|---|
| **Around 50** | Projection and line are roughly even. The model and the line mostly agree. |
| **A little above 50** | The model leans over, by a modest margin. |
| **Well above 50** | The model leans over, with a large gap between projection and line. |
| **A little below 50** | The model leans under, by a modest margin. |
| **Well below 50** | The model leans under, with a large gap between projection and line. |

Scores on low lines can run higher, so a modest projection on a small line can produce a big-looking score. Check the line and the stat before reading too much into an extreme value.

### By sport

**Sports can calculate it a bit differently.** The idea is the same everywhere: projection compared with the line. The details vary by sport and stat.

**KBO is different.** KBO can show its own stored score, so read KBO scores on their own terms rather than comparing them directly with other sports.

**How the free top 3 is chosen.** On NHL and WNBA, the free top 3 is the top three props on the full board by CG Score. KBO's free top 3 is chosen on the server and isn't simply the top three scores on the board. NFL and NBA have no free top 3 right now. The NBA board opens Tuesday, Oct 20.

**Demon and goblin lines.** The NHL and WNBA boards show demon and goblin lines alongside standard lines, and the NBA board shows standard, demon and goblin lines on separate tabs. Each line has its own score. NFL and KBO: {{CONFIRM WITH BOARD QA}}.

**Which side.** The board treats a prop as an over when the projection is at or above the line, and an under when it's below.

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

The [free top 3 on the homepage](/#free-top-3) {{URL PENDING GIT BOT}} shows CG Scores for three props a day in each sport with a free preview (the NFL free preview is off right now). All-Access shows the score on every graded prop on the board, alongside projections, hit rates, defense vs. position and the slip builder.

**[Get the full All-Access board →](/pricing)** {{URL PENDING GIT BOT}}

## FAQ

**What is CG Score?**
A number that shows how far the CGPropz projection sits from a prop's line. Around 50 means the projection and the line are roughly even, above 50 leans over, and below 50 leans under. A bigger gap from 50 means a bigger gap between the model and the line.

**How is CG Score calculated?**
The CGPropz model compares its projection for the player with the posted line and expresses the gap as a score centered on 50. Sports can calculate it a bit differently, and KBO can show its own stored score. It measures the gap, not a probability.

**Is a higher CG Score more likely to hit?**
Not necessarily. The score measures the gap between projection and line, not the chance of a hit. Read it with hit rates, sample sizes and the latest news.

**What does a CG Score below 50 mean?**
The projection is under the line. The further below 50, the further under the line the model projects the player.

**Is CG Score the same for every sport?**
Not exactly. The idea is the same everywhere, projection compared with the line, but sports can calculate it a bit differently, and KBO can show its own stored score. Check the by-sport section of this guide.

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
      "acceptedAnswer": { "@type": "Answer", "text": "A number that shows how far the CGPropz projection sits from a prop's line. Around 50 means the projection and the line are roughly even, above 50 leans over, and below 50 leans under. A bigger gap from 50 means a bigger gap between the model and the line." }
    },
    {
      "@type": "Question",
      "name": "How is CG Score calculated?",
      "acceptedAnswer": { "@type": "Answer", "text": "The CGPropz model compares its projection for the player with the posted line and expresses the gap as a score centered on 50. Sports can calculate it a bit differently, and KBO can show its own stored score. It measures the gap, not a probability." }
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
      "acceptedAnswer": { "@type": "Answer", "text": "Not exactly. The idea is the same everywhere, projection compared with the line, but sports can calculate it a bit differently, and KBO can show its own stored score. Check the by-sport section of this guide." }
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
- No performance claims. Do not say higher scores hit more often.
- Do not publish the scoring formula, weights, or line minimums.
- The board fields mentioned (recent games, season, opponent history, defense versus position, slip builder) are taken from the CGPropz board UI.
-->
