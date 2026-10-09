# 2025-26 NHL prop backtest

Verdict for an October 13 public launch: **DOES NOT PASS.**

Shots on goal passed. Goalie saves did not, so the NHL tab stays locked and should not open to members on October 13. The formulas were not changed after this test.

In plain terms: we replayed all of last season, one day at a time. Each morning the model could see only games that had already been played, plus the season before that. It could not see that night's score. It also could not see the lines or power-play units posted that morning, because those were not saved. The over/under check uses the closest half-point to our number, such as 2.5 shots. That is a stand-in for a sportsbook line, not a record of what PrizePicks posted. The comparison is the player's own average from the previous 10 games.

Shots on goal did what we asked. The average miss was 1.01 shots, a bit better than 1.06 for the recent average. It picked the right side 58.9% of the time, versus 52.3% for that average. When it said an over was likely, it happened about that often (the gap was under 2 points, and the limit was 8).

Goalie saves were a little closer to the real total (miss of 5.61 saves versus 5.74), and the chances stayed inside the honesty limit. They failed the side test: the model picked the right side 51.1% of the time, and the recent average picked it 54.6% of the time. That one miss is why the launch does not pass.

Points and power-play points were not required to pass. Points were a hair worse on average miss than the last-10 average (0.54 versus 0.53) but picked the side more often (67% versus 59%). Power-play points are rare, so almost every stand-in line was 0.5 and both methods mostly said under.

## What this means

- Shots On Goal average error 1.0087 beat the recent average 1.0556.
- Shots On Goal side hit rate 0.5889 beat the recent average 0.5234.
- Shots On Goal calibration gap 0.0183 is inside 8%.
- Goalie Saves average error 5.611 beat the recent average 5.7443.
- Goalie Saves side hit rate 0.511 did not beat the recent average 0.5457.
- Goalie Saves calibration gap 0.0595 is inside 8%.

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

2653 projections. Average miss 5.611 versus 5.7443 for the recent average. Side hit rate 51.1% versus 54.6% on 2626 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 22.5 | 2 | 50.0% | 50.0% |
| 23.5 | 98 | 31.6% | 64.3% |
| 24.5 | 731 | 48.7% | 58.8% |
| 25.5 | 1182 | 53.5% | 53.1% |
| 26.5 | 533 | 52.7% | 52.0% |
| 27.5 | 79 | 50.6% | 41.8% |
| 28.5 | 1 | 0.0% | 100.0% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 0 | n/a | n/a | n/a |
| 0.40-0.50 | 1757 | 47.3% | 40.0% | 7.4% |
| 0.50-0.60 | 896 | 51.3% | 43.5% | 7.8% |
| 0.60-0.70 | 0 | n/a | n/a | n/a |
| 0.70-1.01 | 0 | n/a | n/a | n/a |

Weighted calibration gap, bands with at least 200 props: Poisson 0.0751, negative binomial 0.0595.

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
