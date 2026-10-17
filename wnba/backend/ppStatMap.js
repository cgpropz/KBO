// PrizePicks stat label -> ppLines key. Shared by the backend and the exporter.
module.exports = Object.freeze({
  'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
  '3-PT Made': 'fg3m', '3-PT Attempted': 'fg3a',
  'Steals': 'stl', 'Blocks': 'blk', 'Blocked Shots': 'blk',
  'FG Made': 'fgm', 'FG Attempted': 'fga',
  'Two Pointers Made': 'fg2m', 'Two Pointers Attempted': 'fg2a',
  'Free Throws Made': 'ftm', 'Free Throws Attempted': 'fta',
  'Turnovers': 'tov', 'Offensive Rebounds': 'oreb', 'Defensive Rebounds': 'dreb',
  'Fantasy Score': 'fantasy',
  'Pts+Asts': 'ptsAst', 'Pts+Rebs': 'ptsReb', 'Pts+Rebs+Asts': 'ptsRebAst',
  'Rebs+Asts': 'rebAst', 'Reb+Asts': 'rebAst',
  'Blks+Stls': 'blkStl',
  'Double-Double': 'doubleDouble', 'Triple-Double': 'tripleDouble',
});
