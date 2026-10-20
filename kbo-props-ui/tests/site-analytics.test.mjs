import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENTS, eventProps, scrubUrl, scrubEvent, trackEvent, trackCheckoutClick, trackDiscordPlanClick,
  trackFreeTop3View, trackSignup, noteSportContext, currentSportContext, setAnalyticsSender, resetAnalyticsForTests,
  posthogConfig, posthogSender, posthogInitOptions, sanitizeCapture, doNotTrack, DEFAULT_POSTHOG_HOST,
} from '../src/analytics.js';
import { vercelInsightsScripts } from '../scripts/seoShared.mjs';
import { renderPrivacyPage } from '../scripts/publicPages.mjs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function capture() {
  resetAnalyticsForTests();
  const sent = [];
  setAnalyticsSender((name, props) => sent.push([name, props]));
  return sent;
}

test('event names match the spec', () => {
  assert.deepEqual(Object.values(EVENTS).sort(), ['checkout_click', 'discord_plan_click', 'free_top3_view', 'signup']);
});

test('props are allowlisted tokens only (no PII can pass)', () => {
  assert.deepEqual(eventProps('checkout_click', { plan: 'weekly', sport: 'NFL', email: 'a@b.com', user: 'u1' }), { plan: 'weekly', sport: 'nfl' });
  assert.deepEqual(eventProps('checkout_click', { plan: 'a@b.com', sport: 'x@y.z' }), { plan: 'other', sport: 'none' });
  assert.deepEqual(eventProps('signup', { email: 'a@b.com' }), {});
  assert.deepEqual(eventProps('discord_plan_click', { plan: 'discord_monthly', sport: 'kbo' }), { plan: 'discord_monthly' });
  assert.equal(eventProps('unknown_event', {}), null);
  for (const name of Object.values(EVENTS)) {
    assert.ok(Object.keys(eventProps(name, {})).length <= 2, `${name} stays within 2 properties`);
  }
});

test('unknown events are not sent', () => {
  const sent = capture();
  assert.equal(trackEvent('purchase', { plan: 'weekly' }), false);
  assert.equal(sent.length, 0);
});

test('page URLs drop session ids, tokens, emails and hashes', () => {
  assert.equal(
    scrubUrl('https://www.cgpropz.com/?checkout=success&session_id=cs_live_abc&sport=nfl&utm_source=x&email=a%40b.com#access_token=zzz'),
    'https://www.cgpropz.com/?sport=nfl&utm_source=x',
  );
  assert.equal(scrubUrl('https://www.cgpropz.com/?pause=tok123&account=1'), 'https://www.cgpropz.com/');
  assert.equal(scrubUrl('https://www.cgpropz.com/?utm_campaign=has%20space'), 'https://www.cgpropz.com/');
  assert.equal(scrubUrl('not a url'), null);
  assert.deepEqual(scrubEvent({ type: 'pageview', url: 'https://www.cgpropz.com/pricing?session_id=cs_1' }), { type: 'pageview', url: 'https://www.cgpropz.com/pricing' });
  assert.equal(scrubEvent({ type: 'pageview', url: '' }), null);
});

test('checkout_click credits the last browsed sport by default', () => {
  const sent = capture();
  trackCheckoutClick('weekly');
  noteSportContext('wnba');
  noteSportContext('bogus');
  trackCheckoutClick('founders');
  trackCheckoutClick('lifetime', 'kbo');
  assert.equal(currentSportContext(), 'wnba');
  assert.deepEqual(sent, [
    ['checkout_click', { plan: 'weekly', sport: 'none' }],
    ['checkout_click', { plan: 'founders', sport: 'wnba' }],
    ['checkout_click', { plan: 'lifetime', sport: 'kbo' }],
  ]);
});

test('Discord buttons send discord_plan_click plus checkout_click', () => {
  const sent = capture();
  noteSportContext('nhl');
  trackDiscordPlanClick('weekly');
  trackDiscordPlanClick('discord_monthly');
  assert.deepEqual(sent, [
    ['discord_plan_click', { plan: 'discord_weekly' }],
    ['checkout_click', { plan: 'discord_weekly', sport: 'nhl' }],
    ['discord_plan_click', { plan: 'discord_monthly' }],
    ['checkout_click', { plan: 'discord_monthly', sport: 'nhl' }],
  ]);
});

test('free_top3_view fires once per sport per page load', () => {
  const sent = capture();
  trackFreeTop3View('kbo');
  trackFreeTop3View('kbo');
  trackFreeTop3View('nfl');
  assert.deepEqual(sent, [['free_top3_view', { sport: 'kbo' }], ['free_top3_view', { sport: 'nfl' }]]);
});

test('signup sends no properties', () => {
  const sent = capture();
  trackSignup();
  assert.deepEqual(sent, [['signup', {}]]);
});

test('a throwing sender never breaks the click', () => {
  capture();
  setAnalyticsSender(() => { throw new Error('blocked'); });
  assert.equal(trackCheckoutClick('weekly', 'kbo'), false);
  resetAnalyticsForTests();
});

test('Vercel Analytics mounted for page views; no Speed Insights', () => {
  const main = src('src/main.jsx');
  assert.match(main, /<Analytics beforeSend=\{scrubEvent\} \/>/);
  assert.equal(/SpeedInsights|speed-insights/.test(main), false);
  const pkg = JSON.parse(src('package.json'));
  assert.equal(pkg.dependencies['@vercel/speed-insights'], undefined);
  assert.ok(pkg.dependencies['posthog-js']);
  assert.equal(/from '@vercel\/analytics'/.test(src('src/analytics.js')), false, 'custom events do not use Vercel track()');
});

test('events are wired at the real buttons', () => {
  const sub = src('src/SubscriptionPage.jsx');
  assert.match(sub, /trackCheckoutClick\(plan\.id\)/);
  assert.match(sub, /trackCheckoutClick\(plan\);/); // lifetime + founders sessions
  const landing = src('src/PublicLanding.jsx');
  for (const plan of ['weekly', 'monthly', 'lifetime']) assert.match(landing, new RegExp(`trackCheckoutClick\\('${plan}', sport\\.id\\)`));
  assert.match(landing, /trackFreeTop3View\(sport\.id\)/);
  assert.match(landing, /className="pl-card pl-sw" ref=\{freeBoardRef\}/);
  assert.match(src('src/FreePicksPreview.jsx'), /trackFreeTop3View\(viewSport\)/);
  const discord = src('src/DiscordOnlyPlans.jsx');
  assert.equal((discord.match(/trackDiscordPlanClick\(/g) || []).length, 1);
  assert.match(discord, /if \(!\(await requireAge\(\)\)\) return;\n\s*trackDiscordPlanClick\(plan\);/, 'Discord click fires right after the age check, inside start()');
  assert.equal(/<a\b/.test(discord), false, 'Discord cards are buttons only (#303)');
  const auth = src('src/AuthPage.jsx');
  assert.ok(auth.indexOf('trackSignup()') > auth.indexOf("setMessage('Check your email to confirm"), 'signup fires only after Supabase accepts');
  assert.match(auth, /if \(signUpData\?\.user\?\.identities\?\.length\) trackSignup\(\)/, 'a repeat email is not counted');
  assert.match(src('src/App.jsx'), /if \(view === 'home'\) noteSportContext\(visibleSport\)/);
});

test('static pages load insights with a query scrubber', () => {
  const tags = vercelInsightsScripts();
  assert.match(tags, /\/_vercel\/insights\/script\.js/);
  assert.equal(/speed-insights|posthog/i.test(tags), false);
  assert.match(tags, /window\.va\('beforeSend'/);
  for (const page of ['public/pricing.html', 'public/kbo-player-props.html', 'public/nba-player-props.html']) {
    assert.ok(src(page).includes(tags), `${page} carries the insights tags`);
  }
});

test('sport / s query values are limited to the sport list', () => {
  assert.equal(scrubUrl('https://www.cgpropz.com/?sport=NBA&s=nhl'), 'https://www.cgpropz.com/?sport=NBA&s=nhl');
  assert.equal(scrubUrl('https://www.cgpropz.com/?sport=john_smith&s=abc123'), 'https://www.cgpropz.com/');
})

// ---- PostHog -----------------------------------------------------------

const KEY = 'phc_abcdefghijklmnop1234'

test('PostHog config comes from build env; missing or bad key means off', () => {
  assert.equal(posthogConfig({}), null)
  assert.equal(posthogConfig({ VITE_POSTHOG_KEY: '' }), null)
  assert.equal(posthogConfig({ VITE_POSTHOG_KEY: 'phx_personalSecretKey123' }), null, 'personal API keys are refused')
  assert.deepEqual(posthogConfig({ VITE_POSTHOG_KEY: KEY }), { key: KEY, host: DEFAULT_POSTHOG_HOST })
  assert.equal(DEFAULT_POSTHOG_HOST, 'https://us.i.posthog.com')
  assert.deepEqual(posthogConfig({ VITE_POSTHOG_KEY: KEY, VITE_POSTHOG_HOST: 'https://eu.i.posthog.com/' }), { key: KEY, host: 'https://eu.i.posthog.com' })
  assert.equal(posthogConfig({ VITE_POSTHOG_KEY: KEY, VITE_POSTHOG_HOST: 'http://evil.example' }), null)
  assert.equal(posthogConfig(undefined), null)
})

test('without a key every event is a silent no-op and posthog-js is never loaded', async () => {
  resetAnalyticsForTests()
  let loads = 0
  const load = async () => { loads += 1; return { default: { init() {}, capture() {} } } }
  globalThis.window = globalThis.window || {}
  try {
    assert.equal(posthogSender('checkout_click', { plan: 'weekly', sport: 'kbo' }, { config: null, load }), false)
    assert.doesNotThrow(() => { trackCheckoutClick('weekly', 'kbo'); trackSignup(); trackFreeTop3View('nfl'); trackDiscordPlanClick('weekly') })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(loads, 0)
  } finally {
    delete globalThis.window
  }
})

test('no window (SSR / build scripts) is a no-op', () => {
  resetAnalyticsForTests()
  assert.equal(posthogSender('signup', {}, { config: { key: KEY, host: DEFAULT_POSTHOG_HOST }, load: async () => { throw new Error('must not load') } }), false)
})

test('Do Not Track or Global Privacy Control turns PostHog off', () => {
  assert.equal(doNotTrack({ doNotTrack: '1' }, {}), true)
  assert.equal(doNotTrack({ globalPrivacyControl: true }, {}), true)
  assert.equal(doNotTrack({}, { doNotTrack: '1' }), true)
  assert.equal(doNotTrack({ doNotTrack: 'unspecified' }, {}), false)
})

test('with a key, posthog-js loads lazily once, inits privacy-first, and flushes queued events', async () => {
  resetAnalyticsForTests()
  globalThis.window = {}
  const captured = []
  const inits = []
  let loads = 0
  const load = async () => { loads += 1; return { default: { init: (k, o) => inits.push([k, o]), capture: (n, p) => captured.push([n, p]) } } }
  const config = { key: KEY, host: DEFAULT_POSTHOG_HOST }
  try {
    posthogSender('free_top3_view', { sport: 'kbo' }, { config, load })
    posthogSender('checkout_click', { plan: 'weekly', sport: 'kbo' }, { config, load })
    await new Promise((r) => setTimeout(r, 10))
    posthogSender('signup', {}, { config, load })
    assert.equal(loads, 1)
    assert.equal(inits.length, 1)
    assert.equal(inits[0][0], KEY)
    assert.deepEqual(captured, [['free_top3_view', { sport: 'kbo' }], ['checkout_click', { plan: 'weekly', sport: 'kbo' }], ['signup', {}]])
  } finally {
    delete globalThis.window
    resetAnalyticsForTests()
  }
})

test('PostHog init options: no autocapture, page views, recording, persistence or profiles', () => {
  const o = posthogInitOptions('https://us.i.posthog.com')
  assert.equal(o.api_host, 'https://us.i.posthog.com')
  assert.equal(o.autocapture, false)
  assert.equal(o.capture_pageview, false)
  assert.equal(o.capture_pageleave, false)
  assert.equal(o.disable_session_recording, true)
  assert.equal(o.persistence, 'memory')
  assert.equal(o.person_profiles, 'never')
  assert.equal(o.respect_dnt, true)
  assert.equal(o.advanced_disable_flags, true)
  assert.equal(o.disable_external_dependency_loading, true)
  assert.equal(o.save_referrer, false)
  assert.equal(o.save_campaign_params, false)
  assert.equal(o.before_send, sanitizeCapture)
})

test('before_send scrubs $current_url and other URL props, and drops person updates', () => {
  const out = sanitizeCapture({
    event: 'checkout_click',
    properties: {
      plan: 'weekly',
      $current_url: 'https://www.cgpropz.com/?checkout=success&session_id=cs_live_x&email=a%40b.com&sport=kbo#access_token=t',
      $referrer: 'https://www.cgpropz.com/?pause=tok',
      $initial_referrer: '$direct',
      $pathname: '/?session_id=1',
      $set: { email: 'a@b.com' },
    },
    $set_once: { $initial_current_url: 'https://www.cgpropz.com/?session_id=cs' },
  })
  assert.equal(out.properties.$current_url, 'https://www.cgpropz.com/?sport=kbo')
  assert.equal(out.properties.$referrer, 'https://www.cgpropz.com/')
  assert.equal(out.properties.$initial_referrer, '$direct')
  assert.equal(out.properties.$pathname, '/')
  assert.equal(out.properties.$set, undefined)
  assert.equal(out.$set_once, undefined)
  assert.equal(JSON.stringify(out).includes('a@b.com'), false)
  assert.equal(JSON.stringify(out).includes('cs_live'), false)
  assert.equal(sanitizeCapture(null), null)
})

test('privacy page lists Vercel Web Analytics and PostHog, per tool', () => {
  const html = renderPrivacyPage().html;
  const built = src('public/privacy.html');
  assert.ok(built.includes('<h2>Site analytics</h2>'), 'public/privacy.html is regenerated');
  assert.match(html, /<h2>Site analytics<\/h2>/);
  assert.match(html, /Vercel Web Analytics<\/strong> counts page views/);
  for (const name of Object.values(EVENTS)) assert.ok(html.includes(`<code>${name}</code>`), `${name} listed`);
  assert.match(html, /ad click IDs such as gclid, fbclid and twclid, are removed/);
  assert.match(html, /does not record sessions/);
  assert.match(html, /sets no cookies and writes nothing to local storage/);
  assert.match(html, /Do Not Track or Global Privacy Control, PostHog is not loaded/);
  assert.match(html, /It does not check Do Not Track or Global Privacy Control/, 'Vercel DNT behavior stated separately');
  assert.match(html, /discard client IP addresses/);
  // Events carry the referrer (scrubbed like the page URL), its domain and search engine.
  assert.match(html, /the referring site and search engine, cleaned the same way/);
  assert.ok(built.includes('the referring site and search engine, cleaned the same way'), 'public/privacy.html carries the referrer sentence');
  // The rest of the notice is unchanged.
  assert.match(html, /An X \(Twitter\) pixel can record a sign-up and a purchase\./);
  assert.match(html, /age confirmation stays in this browser/);
});

test('vercel.json sends Referrer-Policy strict-origin-when-cross-origin on every path', () => {
  const config = JSON.parse(src('vercel.json'));
  const all = config.headers.find((h) => h.source === '/(.*)');
  assert.ok(all, 'site-wide header rule');
  const policy = all.headers.find((h) => h.key === 'Referrer-Policy');
  assert.equal(policy?.value, 'strict-origin-when-cross-origin');
  // Only the policy rides on the catch-all; per-path cache headers stay as they were.
  assert.deepEqual(all.headers.map((h) => h.key), ['Referrer-Policy']);
  assert.ok(config.headers.some((h) => h.source === '/assets/(.*)'));
});
