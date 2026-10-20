// Runs a real posthog-js build (the same slim no-external module the site
// lazy-loads) with the site's init options against a campaign landing URL,
// and checks the request body that would leave the browser. posthog-js copies
// utm_*, ad click IDs and $session_entry_* straight from the raw URL, so this
// guards the whole before_send path, not just sanitizeCapture in isolation.
import test from 'node:test';
import assert from 'node:assert/strict';

const LANDING = 'https://www.cgpropz.com/pricing?utm_source=x&utm_medium=social&utm_campaign=a@b.com'
  + '&utm_term=jane.doe%40mail.com&utm_content=ok_1&gclid=GCLIDLEAK1&twclid=TWCLIDLEAK2&fbclid=FBCLIDLEAK3'
  + '&msclkid=MSCLIDLEAK4&ttclid=TTCLIDLEAK5&li_fat_id=LIFATLEAK6&session_id=cs_live_LEAK7';
const REFERRER = 'https://t.co/abc?twclid=TWCLIDLEAK2&email=a%40b.com';
const LEAKS = ['a@b.com', 'a%40b.com', 'jane.doe', 'GCLIDLEAK1', 'TWCLIDLEAK2', 'FBCLIDLEAK3', 'MSCLIDLEAK4', 'TTCLIDLEAK5', 'LIFATLEAK6', 'cs_live_LEAK7', 'INITLEAK8'];

// posthog-js keeps timers (session refresh, retry queue) alive; unref them so
// this test file's process exits once the assertions are done.
const unref = (fn) => (...args) => { const handle = fn(...args); handle?.unref?.(); return handle; };
const timerSetTimeout = unref(globalThis.setTimeout);
const timerSetInterval = unref(globalThis.setInterval);
globalThis.setTimeout = timerSetTimeout;
globalThis.setInterval = timerSetInterval;

function installBrowserStubs(sent) {
  const loc = new URL(LANDING);
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const noop = () => {};
  const el = () => ({ style: {}, setAttribute: noop, appendChild: noop });
  const doc = {
    cookie: '', referrer: REFERRER, location: loc, URL: LANDING, title: 'Pricing', readyState: 'complete', visibilityState: 'visible',
    addEventListener: noop, removeEventListener: noop, createElement: el, querySelector: () => null, querySelectorAll: () => [],
    getElementsByTagName: () => [], body: el(), head: el(), documentElement: {},
  };
  const fetchStub = async (url, opts) => {
    sent.push({ url: String(url), body: opts?.body });
    return { status: 200, ok: true, json: async () => ({}), text: async () => '{}' };
  };
  const win = {
    location: loc, document: doc, localStorage: storage, sessionStorage: storage, fetch: fetchStub,
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) Chrome/120', language: 'en-US', languages: ['en-US'], onLine: true, sendBeacon: () => true },
    addEventListener: noop, removeEventListener: noop, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844,
    history: { pushState: noop, replaceState: noop }, setTimeout: timerSetTimeout, clearTimeout, setInterval: timerSetInterval, clearInterval, console,
    performance: globalThis.performance, crypto: globalThis.crypto, URL, URLSearchParams, Blob, TextEncoder,
  };
  win.window = win;
  win.self = win;
  for (const key of ['window', 'document', 'location', 'localStorage', 'sessionStorage', 'fetch', 'navigator']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true, writable: true });
  }
}

// One set of browser stubs per process: posthog-js keeps the window, document
// and fetch it saw when the module first loaded.
const SENT = [];
let stubbed = false;
function ensureBrowserStubs() {
  if (!stubbed) installBrowserStubs(SENT);
  stubbed = true;
}

test('real posthog-js: campaign params and click IDs from the URL never leave the browser', async () => {
  ensureBrowserStubs();
  const sent = SENT;
  const { posthogInitOptions, CAMPAIGN_PROP } = await import('../src/analytics.js');
  const { default: posthog } = await import('posthog-js/dist/module.slim.no-external.js');
  const options = posthogInitOptions('https://us.i.posthog.com');
  // Test-only transport settings so the body is readable JSON; privacy options are the site's.
  posthog.init('phc_testkeyForUnitTests123', { ...options, request_batching: false, disable_compression: true });
  // Also push $initial_ and $session_entry_ copies through the capture path, as an
  // older SDK or a stored person property would.
  posthog.capture('checkout_click', {
    plan: 'weekly', sport: 'kbo',
    $initial_utm_campaign: 'INITLEAK8@x.com', $initial_gclid: 'INITLEAK8', $initial_utm_source: 'news_1',
    $session_entry_fbclid: 'INITLEAK8', $session_entry_utm_term: 'INITLEAK8 a@b.com',
    $set_once: { $initial_twclid: 'INITLEAK8' },
  });
  await new Promise((r) => { const t = setTimeout(r, 200); t.ref?.(); });

  const events = [];
  for (const { url, body } of sent) {
    const text = typeof body === 'string' ? body : await new Response(body).text();
    for (const leak of LEAKS) assert.equal(text.includes(leak), false, `${leak} leaked to ${url}`);
    const parsed = JSON.parse(text);
    events.push(...(parsed.batch || [parsed]));
  }
  const event = events.find((e) => e.event === 'checkout_click');
  assert.ok(event, 'the custom event was sent');
  const props = event.properties;
  assert.equal(props.plan, 'weekly');
  assert.equal(props.sport, 'kbo');
  for (const [key, value] of Object.entries(props)) {
    const m = CAMPAIGN_PROP.exec(key);
    if (!m) continue;
    assert.ok(m[1].startsWith('utm_'), `click ID ${key} dropped`);
    assert.match(String(value), /^[A-Za-z0-9_-]{1,64}$/, `${key} keeps only a safe code`);
  }
  for (const key of ['gclid', 'twclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', '$session_entry_gclid', '$session_entry_twclid', '$session_entry_fbclid', '$initial_gclid', 'utm_campaign', 'utm_term', '$session_entry_utm_campaign', '$session_entry_utm_term', '$initial_utm_campaign']) {
    assert.equal(key in props, false, `${key} dropped`);
  }
  assert.equal(props.$current_url, 'https://www.cgpropz.com/pricing?utm_source=x&utm_medium=social&utm_content=ok_1');
  assert.equal(props.$session_entry_referrer, 'https://t.co/abc');
  assert.equal(props.$initial_utm_source, 'news_1', 'a safe utm code may stay');
  assert.equal(event.$set_once, undefined);
  assert.equal(props.$set_once, undefined);
});

// Search-engine referrers: posthog-js copies the raw q= (Yahoo: p=) search
// text into ph_keyword, $session_entry_ph_keyword and $initial_ph_keyword.
// A search for an email must never reach PostHog. Each case runs a fresh,
// named posthog-js instance with the browser's referrer set to that search.
const SEARCHES = [
  { name: 'google', engine: 'google', referrer: 'https://www.google.com/search?q=john.doe%40mail.com+cgpropz&oq=john.doe' },
  { name: 'yahoo', engine: 'yahoo', referrer: 'https://search.yahoo.com/search?p=jane.roe%40mail.com+kbo+props&fr=yfp' },
];
const SEARCH_LEAKS = ['john.doe', 'jane.roe', 'INITKEYWORD', 'mail.com', '%40', 'cgpropz&', 'kbo props', 'kbo+props'];

for (const search of SEARCHES) {
  test(`real posthog-js: ${search.name} search terms in the referrer never leave the browser`, async () => {
    ensureBrowserStubs();
    const start = SENT.length;
    window.document.referrer = search.referrer;
    // Fresh session: the session-entry props are rebuilt from this referrer.
    window.sessionStorage.clear();
    const { posthogInitOptions } = await import('../src/analytics.js');
    const { default: posthog } = await import('posthog-js/dist/module.slim.no-external.js');
    const ph = posthog.init(`phc_searchTestKey${search.name}0123`, { ...posthogInitOptions('https://us.i.posthog.com'), request_batching: false, disable_compression: true }, `search_${search.name}`);
    ph.capture('free_top3_view', {
      sport: 'kbo',
      // An older SDK or stored person property pushing the copies through capture.
      $initial_ph_keyword: 'INITKEYWORD older@mail.com',
      $initial_search_engine: 'google',
    });
    await new Promise((r) => { const t = setTimeout(r, 200); t.ref?.(); });

    const events = [];
    for (const { url, body } of SENT.slice(start)) {
      const text = typeof body === 'string' ? body : await new Response(body).text();
      for (const leak of SEARCH_LEAKS) assert.equal(text.includes(leak), false, `${leak} leaked to ${url}`);
      const parsed = JSON.parse(text);
      events.push(...(parsed.batch || [parsed]));
    }
    const event = events.find((e) => e.event === 'free_top3_view');
    assert.ok(event, 'the custom event was sent');
    const props = event.properties;
    assert.equal(props.sport, 'kbo');
    for (const key of ['ph_keyword', '$session_entry_ph_keyword', '$initial_ph_keyword']) {
      assert.equal(key in props, false, `${key} dropped`);
    }
    for (const key of Object.keys(props)) assert.doesNotMatch(key, /keyword/, `${key} dropped`);
    // The engine name and the scrubbed referrer stay.
    assert.equal(props.$search_engine, search.engine);
    assert.equal(props.$session_entry_search_engine, search.engine);
    assert.equal(props.$initial_search_engine, 'google');
    assert.equal(props.$session_entry_referrer, new URL(search.referrer).origin + new URL(search.referrer).pathname);
  });
}
