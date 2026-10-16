// Free NFL picks. True restores the free top rows on nfl_projections,
// nfl_sharp_odds, and nfl_game_markets. Paid NFL access does not read this
// flag. Started games stay out of the prop preview, and total edges stay
// hidden unless NFL_FREE_TOTAL_EDGES_ENABLED is on.
//
// Lives outside api/_dataAccess.js so the landing bundle can read the flag
// without pulling server-side board trimming into the page.
export const NFL_FREE_PREVIEW_ENABLED = true;
