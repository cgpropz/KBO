// Public /results is on. Nav, footer, sitemap, and the record link follow
// this flag. While it is true, vercel.json must not redirect /results.
// The page is the live ledger read, not a static file.
export const RESULTS_PAGE_PUBLIC = true

export function publicLinks(items) {
  if (RESULTS_PAGE_PUBLIC) return items
  return items.filter((item) => item[0] !== '/results')
}
