# 2025-26 NHL prop backtest

Goalie saves, on the half of the season we did not use to build the formula: **DOES NOT PASS.**

The NHL tab stays locked. This is a draft, and nothing here turns the public switch on.

## Why the first saves model lost the over/under

The first version was a little closer to the real total than 'use his last 10 games,' but it picked the right side less often. On the full season it hit 51.1% of the sides, and the last-10 average hit 54.6%. Its average miss was 5.61 saves, versus 5.74.

Two things caused that. First, the number assumed a full night. About one start in fourteen ends early, when the goalie is pulled, and those nights land around 13 saves instead of 25. The last-10 average already includes those short nights, so it was not sitting high. In the first half of the season our number was about 1.2 saves too high. Second, the shot guess gave equal weight to the team, the opponent, and the league. That pulled unusual goalies toward an ordinary night, and the over/under line sits right next to our number. The last-10 average sits further away, on the goalie's real level, so it won the side more often even though it missed the total by a bit more.

We also checked the other guesses. Save percentage was not the problem: shrinking it more or less barely moved the error. The same goalie almost never starts both nights of a back-to-back, so that was not the gap. We do not have the betting totals from last season, so game script was not added. Mixing in the last-10 average made the side look better on the first half mostly by moving the line, and the average miss got worse, so that blend is not in the formula.

## What we changed, and the result

The new shot guess is how many shots the team usually allows, nudged up or down if this opponent shoots more or less than average. The nudge is capped at 12%. A full-night total is then mixed with the saves from nights a goalie left before 50 minutes, using only the rate from games already played. We did not blend in the last-10 average. The idea was set on the first half of 2025-26. The second half was scored once and was not used to change the formula.

First half: average miss 5.43 versus 5.77 for the last-10 average. Side 51.6% versus 52.0%. The miss got better. The side still did not win, so we did not keep tuning.

Second half, the real test (January 3, 2026 through the end of the regular season): 1362 starts. Average miss 5.41 versus 5.72. Side 52.4% versus 53.8% on 1350 decisions.

- Average miss 5.4063 was not worse than the recent average 5.7222.
- Side hit rate 0.5237 did not beat the recent average 0.5378.

That misses the bar. Hide goalie saves. Shots, points, and power-play points can stay. The tab stays locked either way.

Full season, same new formula, still with no peeking: average miss 5.42 versus 5.74. Side 52.0% versus 52.9%.

Shots on goal were not changed. The rest of this note is the full walk-forward, one day at a time. The model could see only games already played, plus the 2024-25 season. It could not see that night's score, or the lines posted that morning. The over/under uses the closest half-point to our number. That is a stand-in for a sportsbook line, not a record of PrizePicks. The comparison is the previous 10 games.

## Full-season checks

- Shots On Goal average error 1.0087 beat the recent average 1.0556.
- Shots On Goal side hit rate 0.5889 beat the recent average 0.5234.
- Shots On Goal calibration gap 0.0183 is inside 8%.
- Goalie Saves average error 5.4185 beat the recent average 5.7443.
- Goalie Saves side hit rate 0.5198 did not beat the recent average 0.529.
- Goalie Saves calibration gap 0.0096 is inside 8%.

Shots and saves are the two props that had to beat that simple average, and their chances had to be honest (when the model says 60%, it should happen about 60% of the time, within 8 points). Points and power-play points are shown because the board includes them. They were not required to pass.

## By prop

### Shots On Goal

46749 projections. Average miss 1.0087 versus 1.0556 for the recent average. Side hit rate 58.9% versus 52.3% on 46431 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 0.5 | 11083 | 55.2% | 50.0% |
| 1.5 | 27220 | 60.8% | 53.8% |
| 2.5 | 7432 | 57.6% | 51.3% |
| 3.5 | 689 | 55.6% | 45.6% |
| 4.5 | 7 | 57.1% | 28.6% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 17564 | 33.5% | 35.4% | 2.0% |
| 0.40-0.50 | 11956 | 45.0% | 47.0% | 2.0% |
| 0.50-0.60 | 14119 | 55.0% | 56.7% | 1.7% |
| 0.60-0.70 | 3110 | 61.5% | 60.9% | 0.7% |
| 0.70-1.01 | 0 | n/a | n/a | n/a |

Weighted calibration gap, bands with at least 200 props: Poisson 0.0183, negative binomial 0.0441.

### Goalie Saves

2653 projections. Average miss 5.4185 versus 5.7443 for the recent average. Side hit rate 52.0% versus 52.9% on 2624 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 18.5 | 1 | 100.0% | 100.0% |
| 19.5 | 10 | 30.0% | 40.0% |
| 20.5 | 54 | 42.6% | 51.8% |
| 21.5 | 184 | 53.8% | 52.7% |
| 22.5 | 333 | 51.3% | 53.4% |
| 23.5 | 503 | 52.5% | 52.1% |
| 24.5 | 502 | 53.6% | 54.4% |
| 25.5 | 436 | 50.9% | 48.6% |
| 26.5 | 309 | 48.5% | 53.1% |
| 27.5 | 166 | 56.6% | 57.8% |
| 28.5 | 75 | 56.0% | 58.7% |
| 29.5 | 34 | 52.9% | 52.9% |
| 30.5 | 16 | 43.8% | 62.5% |
| 31.5 | 1 | 100.0% | 100.0% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 0 | n/a | n/a | n/a |
| 0.40-0.50 | 1767 | 47.3% | 44.6% | 2.7% |
| 0.50-0.60 | 886 | 51.3% | 49.0% | 2.3% |
| 0.60-0.70 | 0 | n/a | n/a | n/a |
| 0.70-1.01 | 0 | n/a | n/a | n/a |

Weighted calibration gap, bands with at least 200 props: Poisson 0.0258, negative binomial 0.0096.

### Points

46749 projections. Average miss 0.537 versus 0.5286 for the recent average. Side hit rate 67.3% versus 59.4% on 46092 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 0.5 | 44539 | 67.4% | 59.6% |
| 1.5 | 1553 | 63.7% | 55.6% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 33102 | 28.2% | 26.2% | 2.0% |
| 0.40-0.50 | 7699 | 44.8% | 46.9% | 2.1% |
| 0.50-0.60 | 4989 | 54.5% | 58.0% | 3.4% |
| 0.60-0.70 | 959 | 61.4% | 64.8% | 3.4% |
| 0.70-1.01 | 0 | n/a | n/a | n/a |

Weighted calibration gap, bands with at least 200 props: Poisson 0.0219, negative binomial 0.0219.

### Power Play Points

46749 projections. Average miss 0.1501 versus 0.1444 for the recent average. Side hit rate 91.8% versus 89.8% on 46718 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 0.5 | 46718 | 91.8% | 89.8% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 46663 | 8.5% | 8.1% | 0.4% |
| 0.40-0.50 | 86 | 42.0% | 27.9% | 14.1% |
| 0.50-0.60 | 0 | n/a | n/a | n/a |
| 0.60-0.70 | 0 | n/a | n/a | n/a |
| 0.70-1.01 | 0 | n/a | n/a | n/a |

Weighted calibration gap, bands with at least 200 props: Poisson 0.004, negative binomial 0.004.

A pass here does not mean the tab will beat PrizePicks. It means the projection is closer to the real count than 'use his last 10 games,' and the over/under chances are not wildly overconfident, on last season's games.
