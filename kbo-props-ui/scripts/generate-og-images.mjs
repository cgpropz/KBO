// One-off generator for the per-sport Open Graph cards (1200x630 PNG) in
// public/images/og/. Not part of `npm run build`: the PNGs are committed.
// Run: node scripts/generate-og-images.mjs (needs the Inter font installed).
// Brand colours and wordmark only. No photos and no player likeness.

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/images/og');

export const OG_CARDS = [
  { id: 'kbo', label: 'KBO', headline: 'KBO Player Props Today', sub: 'CG Score · Projections · Postseason times in ET', icon: 'baseball' },
  { id: 'nba', label: 'NBA', headline: 'NBA Player Props Today', sub: 'CG Score · Projections · L5, L10 and season hit rates', icon: 'basketball' },
  { id: 'nfl', label: 'NFL', headline: 'NFL Player Props Today', sub: 'CG Score · Projections · L10 hit rates · DvP', icon: 'football' },
  { id: 'nhl', label: 'NHL', headline: 'NHL Player Props Today', sub: 'Free top 3 · Shots, saves and points · CG Score', icon: 'puck' },
];

const GREEN = '#4ade80';

function icon(kind) {
  const stroke = `stroke="${GREEN}" stroke-width="10" fill="none" stroke-linecap="round"`;
  if (kind === 'baseball') {
    return `<circle cx="0" cy="0" r="150" ${stroke}/>
      <path d="M -95 -115 C -40 -60 -40 60 -95 115" ${stroke}/>
      <path d="M 95 -115 C 40 -60 40 60 95 115" ${stroke}/>`;
  }
  if (kind === 'basketball') {
    return `<circle cx="0" cy="0" r="150" ${stroke}/>
      <line x1="-150" y1="0" x2="150" y2="0" ${stroke}/>
      <line x1="0" y1="-150" x2="0" y2="150" ${stroke}/>
      <path d="M -105 -107 C -45 -45 -45 45 -105 107" ${stroke}/>
      <path d="M 105 -107 C 45 -45 45 45 105 107" ${stroke}/>`;
  }
  if (kind === 'football') {
    return `<g transform="rotate(-30)">
      <ellipse cx="0" cy="0" rx="170" ry="100" ${stroke}/>
      <line x1="-60" y1="0" x2="60" y2="0" ${stroke}/>
      ${[-40, -13, 13, 40].map((x) => `<line x1="${x}" y1="-22" x2="${x}" y2="22" ${stroke}/>`).join('')}
    </g>`;
  }
  return `<ellipse cx="0" cy="40" rx="160" ry="55" ${stroke}/>
    <path d="M -160 -10 L -160 40 M 160 -10 L 160 40" ${stroke}/>
    <ellipse cx="0" cy="-10" rx="160" ry="55" ${stroke}/>`;
}

export function ogSvg(card) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="78%" cy="45%" r="60%">
      <stop offset="0" stop-color="#16a34a" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#050506" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#050506"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="8" fill="${GREEN}"/>
  <text x="72" y="104" font-family="Inter" font-weight="800" font-size="44" fill="#ffffff" letter-spacing="-1">cg<tspan fill="${GREEN}">propz</tspan></text>
  <rect x="72" y="178" width="${card.label.length * 34 + 48}" height="64" rx="32" fill="${GREEN}"/>
  <text x="96" y="223" font-family="Inter" font-weight="800" font-size="38" fill="#04140a">${card.label}</text>
  <text x="72" y="340" font-family="Inter" font-weight="800" font-size="64" fill="#ffffff" letter-spacing="-2">${card.headline.split(' ').slice(0, 2).join(' ')}</text>
  <text x="72" y="415" font-family="Inter" font-weight="800" font-size="64" fill="#ffffff" letter-spacing="-2">${card.headline.split(' ').slice(2).join(' ')}</text>
  <text x="72" y="482" font-family="Inter" font-weight="600" font-size="28" fill="#a1a1aa">${card.sub}</text>
  <text x="72" y="568" font-family="Inter" font-weight="700" font-size="24" fill="#71717a">cgpropz.com · Standard lines · 21+</text>
  <g transform="translate(965 300)" opacity="0.9">${icon(card.icon)}</g>
</svg>`;
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  mkdirSync(outDir, { recursive: true });
  for (const card of OG_CARDS) {
    const target = join(outDir, `${card.id}-player-props.png`);
    await sharp(Buffer.from(ogSvg(card))).png({ compressionLevel: 9, palette: true }).toFile(target);
    console.log(`[og] ${target}`);
  }
}
