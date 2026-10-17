// One X base-code snippet for index.html, /x, and the static pages.
// The IIFE no-ops when this document already configured twq, and uwt.js is
// added only when that script tag is absent, so the base code cannot load twice.

import { pixelIdFromEnv } from '../src/xPixelIds.js';

const PIXEL_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;

export function xPixelSnippet(pixelId) {
  const id = String(pixelId || '').trim();
  if (!PIXEL_ID_RE.test(id)) return '';
  const literal = JSON.stringify(id);
  return `<script>
    (function () {
      if (window.__cgXPixelConfigured) return;
      window.__cgXPixelConfigured = ${literal};
      window.twq = window.twq || function () {
        window.twq.exe ? window.twq.exe.apply(window.twq, arguments) : window.twq.queue.push(arguments);
      };
      window.twq.version = '1.1';
      window.twq.queue = window.twq.queue || [];
      twq('config', window.__cgXPixelConfigured);
      function cgLoadTwitter() {
        if (document.querySelector('script[src*="static.ads-twitter.com/uwt.js"]')) return;
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://static.ads-twitter.com/uwt.js';
        document.body.appendChild(script);
      }
      function cgArmTwitter() {
        setTimeout(cgLoadTwitter, 4000);
      }
      if (document.readyState === 'complete') cgArmTwitter();
      else window.addEventListener('load', cgArmTwitter, { once: true });
    })();
    </script>`;
}

export function xPixelSnippetForEnv(env = process.env) {
  return xPixelSnippet(pixelIdFromEnv(env));
}

// Replaces <!--x-pixel--> when present. Does not append a second snippet when
// this document already has the base code.
export function applyXPixelHtml(html, env = process.env) {
  const snippet = xPixelSnippetForEnv(env);
  if (html.includes('<!--x-pixel-->')) return html.replaceAll('<!--x-pixel-->', snippet);
  if (html.includes('__cgXPixelConfigured') || html.includes('static.ads-twitter.com/uwt.js')) return html;
  if (!snippet) return html;
  return html.replace('</head>', `${snippet}\n</head>`);
}
