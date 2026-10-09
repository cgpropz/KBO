# 2025-26 NHL prop backtest

Goalie saves, judged on a book-style line, on the half of the season we did not use to choose the test: **PASSES.**

The NHL tab stays locked. This is a draft, and nothing here turns the public switch on.

## Why the earlier side test was the wrong question

The first backtest put the over/under within half a save of our own number. A typical miss is about 5 saves, so that call is close to a coin flip. The last-10 average can sit a few saves away, on the goalie's real level, and it wins that kind of comparison even when our number is closer to the truth. On that glued-on line, this version hit 51.9% of the sides and the last-10 average hit 52.4%.

That is not how a saves bet works. PrizePicks hangs a number near the middle of the goalie's range, usually around 25.5, and moves it when one team is expected to score more. We could not download the actual 2025-26 saves prices. What is free, for every game, is the closing total and both moneylines, plus who started. The test line is 8.5 saves for each goal the opponent was expected to score. 8.5 is 25.5 divided by a normal 3-goal team share. The favorite gets a quarter of the moneyline's edge. Those figures were taken from how the market is posted. They were not adjusted to make this test pass. The stand-in sits a little high, about one or two saves above what goalies actually finished with. Both methods were graded on that same number.

The saves number itself is the one from the last revision: the shots the team usually allows, nudged up to 12% for how much this opponent shoots, then mixed with the nights a goalie is pulled. On the first half we also tried expected goals, a blend with the last-10 average, and calling the side from a probability instead of from the number. None of those beat the simpler number by enough to be worth the extra parts, so they stayed out. The second half was scored once, after that choice.

First half, where the line rule was checked: average miss 5.31 versus 5.68. Side 59.1% versus 57.0%.

Second half, the real test (January 3, 2026 through the end of the regular season): 1302 starts. Average miss 5.15 versus 5.53. Side 61.1% versus 59.7% on 1299 decisions.

- Average miss 5.1523 was not worse than the recent average 5.5261.
- Side hit rate 0.6112 beat the recent average 0.5966.

That is the bar: beat the last-10 average on the side, and do not be worse on the average miss, on games the formula was not tuned on. Saves can stay on the board. The tab stays locked until the public switch is turned on.

The older saves formula, on this same book-style line: side 57.2% versus 58.4%, average miss 5.40 versus 5.60.

Full season, current formula, still with no peeking: average miss 5.23 versus 5.60. Side 60.1% versus 58.4%.

Shots on goal were not changed. Their over/under in the tables below is still the closest half-point to our own number, because shot-prop prices were not archived. Saves in those tables use the book-style line. The model could see only games already played, plus the 2024-25 season. It could not see that night's score. The comparison is the previous 10 games.

## Full-season checks

- Shots On Goal average error 1.0087 beat the recent average 1.0556.
- Shots On Goal side hit rate 0.5889 beat the recent average 0.5234.
- Shots On Goal calibration gap 0.0183 is inside 8%.
- Goalie Saves average error 5.2278 beat the recent average 5.6017.
- Goalie Saves side hit rate 0.6012 beat the recent average 0.5838.
- Goalie Saves calibration gap 0.0133 is inside 8%.

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

2540 projections. Average miss 5.2278 versus 5.6017 for the recent average. Side hit rate 60.1% versus 58.4% on 2535 decisions.

| Line | Props | Our hit rate | Recent-average hit rate |
| --- | --- | --- | --- |
| 18.5 | 1 | 100.0% | 100.0% |
| 19.5 | 3 | 66.7% | 66.7% |
| 20.5 | 4 | 75.0% | 100.0% |
| 21.5 | 34 | 41.2% | 61.8% |
| 22.5 | 207 | 53.1% | 56.5% |
| 23.5 | 304 | 60.2% | 57.2% |
| 24.5 | 447 | 59.3% | 55.9% |
| 25.5 | 386 | 63.2% | 58.6% |
| 26.5 | 447 | 58.2% | 55.9% |
| 27.5 | 320 | 62.5% | 59.1% |
| 28.5 | 207 | 60.9% | 64.7% |
| 29.5 | 123 | 69.9% | 66.7% |
| 30.5 | 37 | 51.3% | 51.3% |
| 31.5 | 14 | 71.4% | 71.4% |
| 33.5 | 1 | 100.0% | 100.0% |

Poisson calibration (predicted chance versus how often the over actually hit):

| Chance band | Props | Predicted | Actual | Gap |
| --- | --- | --- | --- | --- |
| 0.00-0.40 | 1319 | 28.3% | 32.5% | 4.2% |
| 0.40-0.50 | 550 | 44.7% | 45.5% | 0.8% |
| 0.50-0.60 | 412 | 54.5% | 47.6% | 6.9% |
| 0.60-0.70 | 205 | 64.3% | 58.1% | 6.3% |
| 0.70-1.01 | 54 | 75.5% | 61.1% | 14.4% |

Weighted calibration gap, bands with at least 200 props: Poisson 0.0409, negative binomial 0.0133.

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
