/*
 * Vercel Web Analytics custom events and URL scrubbing (client only).
 *
 * Events and their only allowed properties:
 *   free_top3_view      { sport }        free picks section scrolled into view
 *   checkout_click      { plan, sport }  any checkout button (All-Access or Discord)
 *   signup              {}               email sign-up accepted by Supabase
 *   discord_plan_click  { plan }         Discord Only weekly / monthly button
 *
 * Page views go to Vercel Web Analytics (<Analytics /> in main.jsx). These
 * four custom events go to PostHog Cloud (Vercel Hobby drops custom events).
 *
 * PostHog is optional: without VITE_POSTHOG_KEY at build time, or when the
 * browser sends Do Not Track / Global Privacy Control, every call is a silent
 * no-op and posthog-js is never downloaded. Otherwise posthog-js is lazy
 * loaded on the first event. No autocapture, no page views, no session
 * recording, memory-only persistence, no person profiles, no identify().
 *
 * No PII: property values are limited to fixed plan and sport tokens, and
 * page URLs are reduced to path plus a short allowlist of query keys before
 * they leave the browser (no session ids, tokens, emails or hashes).
 */

export const EVENTS = Object.freeze({
  freeTop3View: 'free_top3_view',
  checkoutClick: 'checkout_click',
  signup: 'signup',
  discordPlanClick: 'discord_plan_click',
});

export const ANALYTICS_SPORTS = ['kbo', 'wnba', 'nfl', 'nhl', 'nba'];
export const ANALYTICS_PLANS = ['weekly', 'monthly', 'yearly', 'lifetime', 'founders', 'discord_weekly', 'discord_monthly'];

const ALLOWED_PROPS = {
  [EVENTS.freeTop3View]: ['sport'],
  [EVENTS.checkoutClick]: ['plan', 'sport'],
  [EVENTS.signup]: [],
  [EVENTS.discordPlanClick]: ['plan'],
};

// Query keys that may stay on a reported page URL. Everything else is dropped.
// sport / s keep only a known sport token; utm_* keep only safe codes.
const SPORT_QUERY = new Set(['sport', 's']);
const UTM_QUERY = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
const SAFE_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

function keepQuery(key, value) {
  if (SPORT_QUERY.has(key)) return ANALYTICS_SPORTS.includes(String(value).toLowerCase());
  return UTM_QUERY.has(key) && SAFE_VALUE.test(value);
}

export function scrubUrl(raw) {
  try {
    const url = new URL(String(raw));
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (keepQuery(key, value)) kept.set(key, value);
    }
    const query = kept.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

// beforeSend for Vercel <Analytics />.
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const url = scrubUrl(event.url);
  if (!url) return null;
  return { ...event, url };
}

function token(value, allowed, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

export function normalizeSport(value) {
  return token(value, ANALYTICS_SPORTS, 'none');
}

export function normalizePlan(value) {
  return token(value, ANALYTICS_PLANS, 'other');
}

export function eventProps(name, props = {}) {
  const allowed = ALLOWED_PROPS[name];
  if (!allowed) return null;
  const out = {};
  if (allowed.includes('plan')) out.plan = normalizePlan(props.plan);
  if (allowed.includes('sport')) out.sport = normalizeSport(props.sport);
  return out;
}

// ---- PostHog (custom events only) -------------------------------------

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const BUILD_ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};

// { key, host } when PostHog is configured, otherwise null.
export function posthogConfig(env = BUILD_ENV) {
  const key = String(env?.VITE_POSTHOG_KEY || '').trim();
  if (!/^phc_[A-Za-z0-9]{10,}$/.test(key)) return null;
  let host = DEFAULT_POSTHOG_HOST;
  const rawHost = String(env?.VITE_POSTHOG_HOST || '').trim();
  if (rawHost) {
    try {
      const url = new URL(rawHost);
      if (url.protocol !== 'https:') return null;
      host = url.origin;
    } catch {
      return null;
    }
  }
  return { key, host };
}

export function doNotTrack(nav = typeof navigator !== 'undefined' ? navigator : undefined, win = typeof window !== 'undefined' ? window : undefined) {
  const flags = [nav?.doNotTrack, nav?.msDoNotTrack, win?.doNotTrack].map((v) => String(v ?? ''));
  return flags.includes('1') || flags.includes('yes') || nav?.globalPrivacyControl === true;
}

// Campaign and ad click properties posthog-js copies straight from the raw
// page URL and referrer (plain, $session_entry_ and $initial_ copies). Click
// IDs are always dropped; a utm_* value stays only if it is a safe code.
export const CAMPAIGN_PROP = /^(?:\$session_entry_|\$initial_)?(utm_(?:source|medium|campaign|term|content)|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|twclid|li_fat_id|igshid|ttclid|rdt_cid|epik|qclid|sccid|irclid|_kx|mc_cid|gad_source|oppref|bfcid)$/;

function keepCampaignProp(key, value) {
  const match = CAMPAIGN_PROP.exec(key);
  if (!match) return true;
  return match[1].startsWith('utm_') && typeof value === 'string' && SAFE_VALUE.test(value);
}

const URL_PROPS = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer', '$session_entry_url', '$session_entry_referrer'];

// PostHog before_send: scrub every URL property, drop campaign / click-ID
// properties (see CAMPAIGN_PROP) and person updates.
export function sanitizeCapture(capture) {
  if (!capture || typeof capture !== 'object') return null;
  const properties = { ...(capture.properties || {}) };
  for (const key of URL_PROPS) {
    if (key in properties) {
      const raw = properties[key];
      properties[key] = typeof raw === 'string' && /^https?:/i.test(raw) ? (scrubUrl(raw) || null) : (raw === '$direct' ? raw : null);
    }
  }
  for (const key of Object.keys(properties)) {
    if (!keepCampaignProp(key, properties[key])) delete properties[key];
  }
  if ('$pathname' in properties) {
    properties.$pathname = String(properties.$pathname || '').split(/[?#]/)[0];
  }
  delete properties.$set;
  delete properties.$set_once;
  const out = { ...capture, properties };
  delete out.$set;
  delete out.$set_once;
  return out;
}

export function posthogInitOptions(host) {
  return {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    persistence: 'memory',
    person_profiles: 'never',
    save_referrer: false,
    save_campaign_params: false,
    respect_dnt: true,
    before_send: sanitizeCapture,
  };
}

let posthogClient = null;
let posthogLoading = null;
const posthogQueue = [];

function flushPosthog() {
  while (posthogClient && posthogQueue.length) {
    const [name, props] = posthogQueue.shift();
    try { posthogClient.capture(name, props); } catch { /* never break a click */ }
  }
}

// Default sender. Lazy-loads posthog-js (slim, no external scripts: capture
// only, no recording/surveys/toolbar code) on the first event.
export function posthogSender(name, props, { config = posthogConfig(), load = () => import('posthog-js/dist/module.slim.no-external.js') } = {}) {
  if (!config || typeof window === 'undefined' || doNotTrack()) return false;
  posthogQueue.push([name, props]);
  if (posthogClient) {
    flushPosthog();
    return true;
  }
  if (!posthogLoading) {
    posthogLoading = Promise.resolve()
      .then(load)
      .then((mod) => {
        const ph = mod?.default || mod;
        ph.init(config.key, posthogInitOptions(config.host));
        posthogClient = ph;
        flushPosthog();
      })
      .catch(() => {
        posthogQueue.length = 0;
      });
  }
  return true;
}

let sender = posthogSender;
// Tests swap the sender; production uses posthogSender.
export function setAnalyticsSender(fn) {
  sender = typeof fn === 'function' ? fn : posthogSender;
}

export function trackEvent(name, props) {
  const clean = eventProps(name, props);
  if (!clean) return false;
  try {
    sender(name, clean);
    return true;
  } catch {
    return false;
  }
}

// The sport the visitor was last looking at, so a checkout from the pricing
// view (always rendered inside the KBO shell) still credits that sport.
let sportContext = null;
export function noteSportContext(sport) {
  const s = normalizeSport(sport);
  if (s !== 'none') sportContext = s;
}
export function currentSportContext() {
  return sportContext || 'none';
}

export function trackCheckoutClick(plan, sport = currentSportContext()) {
  return trackEvent(EVENTS.checkoutClick, { plan, sport });
}

export function trackDiscordPlanClick(plan, sport = currentSportContext()) {
  const key = normalizePlan(String(plan || '').startsWith('discord_') ? plan : `discord_${plan}`);
  trackEvent(EVENTS.discordPlanClick, { plan: key });
  return trackCheckoutClick(key, sport);
}

export function trackSignup() {
  return trackEvent(EVENTS.signup);
}

// free_top3_view fires once per sport per page load.
const seenTop3 = new Set();
export function trackFreeTop3View(sport) {
  const s = normalizeSport(sport);
  if (seenTop3.has(s)) return false;
  seenTop3.add(s);
  return trackEvent(EVENTS.freeTop3View, { sport: s });
}

export function resetAnalyticsForTests() {
  seenTop3.clear();
  sportContext = null;
  sender = posthogSender;
  posthogClient = null;
  posthogLoading = null;
  posthogQueue.length = 0;
}

// Calls onVisible once when element is at least 40% on screen.
export function observeVisibleOnce(element, onVisible) {
  if (!element) return () => {};
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      onVisible();
    }
  }, { threshold: 0.4 });
  observer.observe(element);
  return () => observer.disconnect();
}
