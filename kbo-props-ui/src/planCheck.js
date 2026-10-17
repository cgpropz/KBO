export const PLAN_CHECK_LIMIT_MS = 9_000

// 'ok' when the work finishes, 'error' when it throws, 'timeout' when it
// outlasts the limit. A hung session read or profile fetch must not leave
// the member spinner up.
export function settlePlanCheck(work, ms = PLAN_CHECK_LIMIT_MS) {
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  const ran = Promise.resolve()
    .then(() => (typeof work === 'function' ? work() : work))
    .then(() => 'ok')
    .catch(() => 'error')
  return Promise.race([ran, deadline]).finally(() => clearTimeout(timer))
}
