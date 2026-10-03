// Same DVP buckets as the NFL prop-lines board.
// 1 = toughest matchup, 32 = easiest. Rank 0 / missing is not a grade.
export function dvpGrade(rank) {
  if (!rank) return null
  const pct = rank / 32
  if (pct >= .9) return 'A+'
  if (pct >= .78) return 'A'
  if (pct >= .66) return 'A-'
  if (pct >= .56) return 'B+'
  if (pct >= .46) return 'B'
  if (pct >= .36) return 'B-'
  if (pct >= .26) return 'C+'
  if (pct >= .16) return 'C'
  if (pct >= .1) return 'C-'
  if (pct >= .06) return 'D+'
  if (pct >= .03) return 'D'
  return 'F'
}
