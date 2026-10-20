// Copy that depends on the free NBA top 3 switch (src/nbaPreviewFlag.js).
// In content markdown:
//   {{#nba-free}}shown while the free NBA top 3 is on{{/nba-free}}
//   {{^nba-free}}shown while it is off{{/nba-free}}
// The blocks are resolved before the guide is parsed (FAQ JSON-LD included),
// and assertNoCurlyPlaceholders still catches a block left unclosed.
import { NBA_FREE_PREVIEW_ENABLED } from '../src/nbaPreviewFlag.js';

const ON = /\{\{#nba-free\}\}([\s\S]*?)\{\{\/nba-free\}\}/g;
const OFF = /\{\{\^nba-free\}\}([\s\S]*?)\{\{\/nba-free\}\}/g;

export function applyNbaFreeCopy(markdown, enabled = NBA_FREE_PREVIEW_ENABLED) {
  return String(markdown)
    .replace(ON, (_, text) => (enabled ? text : ''))
    .replace(OFF, (_, text) => (enabled ? '' : text));
}
