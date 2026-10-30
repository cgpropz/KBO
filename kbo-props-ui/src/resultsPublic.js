// Public /results stays hidden until the live ledger page is ready.
// Set this to true to restore the nav, footer, sitemap, and record links.
// The temporary redirect is vercel.json: remove the /results and
// /results.html rules in the same change. Tests fail if the two disagree.
export const RESULTS_PAGE_PUBLIC = false

export function publicLinks(items) {
  if (RESULTS_PAGE_PUBLIC) return items
  return items.filter((item) => item[0] !== '/results')
}
