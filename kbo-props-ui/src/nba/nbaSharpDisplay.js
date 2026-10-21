// Display helpers for the NBA PP Odds board. Same fields and letters as the
// NHL board. They do not recompute a projection, a CG Score, or a stored grade.

export {
  gradeClass,
  nhlActiveEdge as nbaActiveEdge,
  nhlDisplayedGrade as nbaDisplayedGrade,
  nhlMatchupGrade as nbaMatchupGrade,
  nhlScoredSide as nbaScoredSide,
  nhlSideEdge as nbaSideEdge,
  projectionVsLineColor,
} from '../nhl/nhlSharpDisplay.js'
