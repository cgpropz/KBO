// /x is the X ads landing. cleanUrls serves it from x.html.

export function isXCampaignPath(pathname = '') {
  const path = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path === '/x' || path === '/x.html';
}
