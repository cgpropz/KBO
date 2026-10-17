// This page only asks for sports the plan includes, so a free preview here
// means the server could not confirm the member (auth or tier lookup blip,
// stale token). A preview, or a failed request, gets one retry with a fresh
// session token and no browser cache before the hub settles on it.
export const BOARD_RETRY_MS = 800;
export async function loadMemberBoard(sport, fetcher, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let first;
  try {
    first = await fetcher(sport.ds, { devStaticPath: sport.dev });
    if (!first?.preview) return first;
  } catch (err) {
    first = { error: err };
  }
  await wait(BOARD_RETRY_MS);
  try {
    const again = await fetcher(sport.ds, { devStaticPath: sport.dev, fresh: true });
    if (again && (!again.preview || first.error)) return again;
  } catch (err) {
    if (first.error) throw err;
  }
  if (first.error) throw first.error;
  return first;
}

