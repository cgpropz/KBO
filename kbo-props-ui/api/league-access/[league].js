// One Serverless Function for GET /api/nba-access and GET /api/nhl-access.
// vercel.json rewrites those public paths here. The handlers are unchanged.

import { handleNbaAccessRequest } from '../_nbaAccess.js';
import { handleNhlAccessRequest } from '../_nhlAccess.js';
import { routeParam } from '../_routeKey.js';

export const LEAGUE_ACCESS = {
  nba: handleNbaAccessRequest,
  nhl: handleNhlAccessRequest,
};

const LEAGUE_ALIASES = {
  'nba-access': 'nba',
  'nhl-access': 'nhl',
};

export default function handler(req, res) {
  const league = routeParam(req, { param: 'league', aliases: LEAGUE_ALIASES });
  const route = LEAGUE_ACCESS[league];
  if (!route) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(404).json({ error: 'Not found' });
  }
  return route(req, res);
}
