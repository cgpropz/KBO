// Free NBA top 3 for the opening weeks (Code Green, Oct 19, 2026). True lets
// free and anonymous callers get the 3-row nba_projections_* preview once the
// nba_public flag is on, the same way KBO, WNBA, NFL and NHL do. False puts NBA
// back to full-access only. Paid NBA access does not read this flag.
//
// Lives outside api/_dataAccess.js so the landing bundle can read it.
export const NBA_FREE_PREVIEW_ENABLED = true;
