// Free NBA top 3 for the opening weeks (Code Green, Oct 19, 2026). Off by
// default; turning it on is a reviewed code change and a deploy.
//
// On: free, legacy and logged-out callers get the 3-row nba_projections_standard
// preview (high-risk players excluded on the server), before or after
// nba_public. Other NBA datasets stay denied for those callers. The homepage
// NBA tab and the "free top 3 includes NBA" copy appear.
// Off: NBA is full-access only. Non-all-access callers get no preview, and
// the tab and that copy are hidden.
// All-access and owner (full) access does not read this flag.
//
// Lives outside api/_dataAccess.js so the landing bundle can read it.
export const NBA_FREE_PREVIEW_ENABLED = false;
