// Shared by the combined Serverless Functions. Vercel dynamic routes set
// req.query to the path param, and a rewrite keeps the original query string
// because the destination has none. If the function instead sees the public
// path (/api/discord-callback), the alias still selects the right handler.

export function routeParam(req, { param, aliases = {} } = {}) {
  const raw = req?.query?.[param];
  const fromQuery = Array.isArray(raw) ? raw[0] : raw;
  if (fromQuery) return String(fromQuery);
  const path = String(req?.url || '').split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').filter(Boolean).pop() || '';
  return aliases[last] || last;
}
