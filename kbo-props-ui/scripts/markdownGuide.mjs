// Turns content/guides/*.md into static /guides/<slug> pages.
// Author notes in HTML comments are dropped. {{URL PENDING GIT BOT}} markers
// are removed because the real links are already in the copy. Rows, tables,
// and sentences that are still unresolved are omitted so no {{ }} reaches HTML.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLISHED_ON,
  articleNode,
  breadcrumbNode,
  escapeHtml,
  faqNode,
  pageUrl,
  renderDocument,
  SITE,
} from './seoShared.mjs';

export const GUIDES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../content/guides');
const PUBLISHED_AT = '2026-10-11T13:10:00-04:00';

function parseFrontmatter(block) {
  const meta = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim().replace(/\s+#.*$/, '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[match[1]] = value;
  }
  return meta;
}

function resolvedDate(value) {
  if (!value || value.includes('{{')) return PUBLISHED_AT;
  return value;
}

function dateOnly(value) {
  const resolved = resolvedDate(value);
  const match = String(resolved).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : PUBLISHED_ON;
}

export function safeHref(href) {
  if (href.startsWith('/')) return pageUrl(href);
  return href;
}

export function inlineMarkdown(raw) {
  const text = String(raw).replace(/\{\{URL PENDING GIT BOT\}\}/g, '').replace(/\s+/g, ' ').trim();
  const links = [];
  const withSlots = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    links.push({ label, href: safeHref(href.trim()) });
    return `\u0000${links.length - 1}\u0000`;
  });
  let html = escapeHtml(withSlots);
  html = html.replace(/\u0000(\d+)\u0000/g, (_, index) => {
    const link = links[Number(index)];
    return `<a href="${escapeHtml(link.href)}">${inlineMarkdown(link.label)}</a>`;
  });
  // A footnote mark sits on a number (21*). A doubled asterisk is still bold.
  html = html.replace(/(\d)\*(?!\*)/g, '$1&#42;');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function isBlockStart(line) {
  return /^(#{1,6}\s|```|>|[-*] |\d+\. |\||!\[)/.test(line) || line.trim() === '---';
}

function renderTable(rows) {
  const parsed = rows
    .map((row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  if (!parsed.length) return '';
  const head = parsed[0].map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
  const body = parsed.slice(1).map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<div class="table-scroll">\n<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>`;
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.trim() === '---') { out.push('<hr />'); i += 1; continue; }
    if (line.startsWith('\\* ')) {
      out.push(`<p>* ${inlineMarkdown(line.slice(3))}</p>`);
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) i += 1;
      i += 1;
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (image) {
      out.push(`<figure><img src="${escapeHtml(image[2].trim())}" alt="${escapeHtml(image[1])}" /></figure>`);
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(rows));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote><p>${inlineMarkdown(buf.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ''));
        i += 1;
      }
      out.push(`<ul>\n${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('\n')}\n</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i += 1;
      }
      out.push(`<ol>\n${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('\n')}\n</ol>`);
      continue;
    }
    const question = line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (question) {
      out.push(`<h3>${inlineMarkdown(question[1])}</h3>`);
      i += 1;
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inlineMarkdown(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

export function extractFaqs(body) {
  const lines = String(body).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+FAQ\s*$/.test(line.trim()));
  if (start < 0) return [];
  const faqs = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const question = line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (question) {
      if (current) faqs.push(current);
      current = { q: question[1].trim(), a: '' };
      continue;
    }
    if (!line.trim()) {
      if (current?.a) current = pushAndClose(faqs, current);
      continue;
    }
    if (!current) continue;
    if (line.trim() === '---' || line.startsWith('```')) {
      current = pushAndClose(faqs, current);
      if (line.startsWith('```')) break;
      continue;
    }
    current.a = current.a ? `${current.a} ${line.trim()}` : line.trim();
  }
  if (current?.q && current.a) faqs.push(current);
  return faqs.filter((faq) => faq.q && faq.a && !faq.q.startsWith('JSON-LD'));
}

function pushAndClose(faqs, current) {
  if (current?.q && current.a) faqs.push(current);
  return null;
}

function faqJsonBlock() {
  return /\*\*JSON-LD(?: \([^)]*\))?\*\*\s*```json\s*([\s\S]*?)```/;
}

export function extractFaqPage(text) {
  const match = String(text).match(faqJsonBlock());
  if (!match) return null;
  const parsed = JSON.parse(match[1]);
  if (parsed['@type'] !== 'FAQPage' || !Array.isArray(parsed.mainEntity)) {
    throw new Error('Guide JSON-LD block is not an FAQPage');
  }
  const node = { ...parsed };
  delete node['@context'];
  return node;
}

export function assertNoCurlyPlaceholders(text, label) {
  const at = String(text).indexOf('{{');
  if (at === -1) return;
  const sample = String(text).slice(Math.max(0, at - 30), at + 90).replace(/\s+/g, ' ');
  throw new Error(`Unresolved placeholder in ${label}: ${sample}`);
}

function dropUnresolvedSentences(line) {
  const prefixMatch = line.match(/^(\s*(?:>\s*)?(?:[-*] |\d+\. )?)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const rest = line.slice(prefix.length);
  const kept = rest.split(/(?<=[.!?])\s+/).filter((part) => part.trim() && !part.includes('{{'));
  if (!kept.length) return '';
  return `${prefix}${kept.join(' ')}`.replace(/[ \t]{2,}/g, ' ').trimEnd();
}

function dropEmptySections(markdown) {
  const lines = String(markdown).split('\n');
  const drop = new Set();
  const levelOf = (line) => {
    const match = line.match(/^(#{1,6})\s/);
    return match ? match[1].length : 0;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const level = levelOf(lines[i]);
    if (!level) continue;
    let meaningful = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = levelOf(lines[j]);
      if (next && next <= level) break;
      if (lines[j].trim()) meaningful = true;
    }
    if (!meaningful) drop.add(i);
  }
  return lines.filter((_, index) => !drop.has(index)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Unpublished slots stay in the source file and never reach the page.
// A table row or sentence that still contains {{ }} is removed. A table
// with only its header left is removed, and so is a heading with no body.
export function hideUnresolved(markdown) {
  const text = String(markdown)
    .replace(/\{\{URL PENDING GIT BOT\}\}/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1');
  const lines = text.split('\n');
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].includes('{{FROM BOARD QA LEDGER}}') || lines[i].includes('{{CONFIRM SCHEDULE}}') || lines[i].includes('{{CONFIRM PRICING}}')) {
      i += 1;
      continue;
    }
    if (lines[i].trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      const filtered = rows.filter((row) => !row.includes('{{'));
      const bodyRows = filtered.filter((row) => !/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(row));
      if (bodyRows.length >= 2) kept.push(...filtered);
      continue;
    }
    const line = lines[i];
    i += 1;
    if (/Placeholder rule/i.test(line)) continue;
    if (!line.includes('{{')) {
      kept.push(line);
      continue;
    }
    const next = dropUnresolvedSentences(line);
    if (next.trim()) kept.push(next);
  }
  return dropEmptySections(kept.join('\n'));
}

const BODY_IMAGES = {
  '/guides/start-here': {
    anchor: '**Example only. The player and every number below are made up to show the layout. This is not a real prop.**',
    image: '![Annotated example of a CGPropz board row for a made-up points prop. Labels point to the player, line, projection, CG Score, hit rates, and defense versus position.](/images/start-here-board-row.png)',
  },
  '/guides/cg-score': {
    anchor: "CG Score ranks every prop by how strongly our model's projection disagrees with the line, adjusted for matchup (DvP) and recent form. Higher score = bigger model edge. A+ through C grades are based on the score. It's a ranking tool, not a guarantee. 21+ · Play responsibly · Entertainment only.",
    image: '![CG Score ranks every prop by how strongly the model projection disagrees with the line.](/images/how-cg-score-diagram.png)',
  },
};

export const PAGE_IMAGES = {
  '/guides/start-here': {
    src: '/images/start-here-featured.png',
    alt: 'Start Here: how to read a CGPropz player prop, from the line and projection to CG Score and hit rate.',
  },
  '/guides/cg-score': {
    src: '/images/how-cg-score-works-featured.png',
    alt: 'How CG Score works: a higher score is a bigger model edge.',
  },
  '/wnba-player-props': {
    src: '/images/wnba-finals-featured.png',
    alt: 'Valkyries vs Dream WNBA Finals player props on CGPropz',
  },
};

function insertGuideImages(path, body) {
  const spec = BODY_IMAGES[path];
  if (!spec) return body;
  if (!body.includes(spec.anchor)) throw new Error(`Could not place the body image for ${path}`);
  return body.replace(spec.anchor, `${spec.anchor}\n\n${spec.image}`);
}

export function demoteHeadings(markdown) {
  return String(markdown).replace(/^(#{1,6}) /gm, (_, hashes) => `${'#'.repeat(Math.min(6, hashes.length + 1))} `);
}

export function stripGuideSource(markdown) {
  let text = String(markdown).replace(/\r\n/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, '').trim();
  let meta = {};
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      meta = parseFrontmatter(text.slice(3, end));
      text = text.slice(end + 4).trim();
    }
  }
  const faqPage = extractFaqPage(text);
  text = text.replace(faqJsonBlock(), '').trim();
  return { meta, body: text, faqPage };
}

// The published URL is always /guides/<slug>. Frontmatter `canonical` may
// name a redirect alias (start-here.md says /start-here) and is ignored.
export function canonicalGuidePath(meta, fallbackSlug) {
  const fromFile = String(fallbackSlug || '').trim().split(/[?#]/)[0];
  if (fromFile.startsWith('/guides/')) return fromFile;
  const fromSlug = String(meta.slug || '').trim().split(/[?#]/)[0];
  if (fromSlug.startsWith('/guides/')) return fromSlug;
  return fromFile || fromSlug;
}

export function guideFromMarkdown(markdown, fallbackSlug) {
  const { meta, body, faqPage } = stripGuideSource(markdown);
  const path = canonicalGuidePath(meta, fallbackSlug);
  const publishedBody = insertGuideImages(path, hideUnresolved(body));
  assertNoCurlyPlaceholders(publishedBody, path || fallbackSlug || 'guide');
  const faqs = extractFaqs(publishedBody);
  const h1 = (body.match(/^#\s+(.+)$/m) || [])[1]?.trim() || 'Guide';
  const title = meta.title_tag || `${h1} | CGPropz`;
  const description = meta.meta_description || '';
  const datePublished = resolvedDate(meta.date_published);
  const dateModified = resolvedDate(meta.date_modified || meta.date_published);
  return {
    path,
    file: path === '/' ? 'index.html' : `${path.replace(/^\//, '')}.html`,
    title,
    description,
    h1,
    faqs,
    datePublished,
    dateModified,
    lastmod: dateOnly(meta.date_modified || meta.date_published),
    html: renderGuideHtml({ title, description, path, body: publishedBody, faqs, faqPage, h1, datePublished, dateModified }),
  };
}

function renderGuideHtml({ title, description, path, body, faqs, faqPage, h1, datePublished, dateModified }) {
  const schemas = [
    breadcrumbNode([
      { name: 'Home', url: pageUrl('/') },
      { name: h1, url: pageUrl(path) },
    ]),
    articleNode({
      headline: h1,
      description,
      url: pageUrl(path),
      datePublished,
      dateModified,
    }),
  ];
  if (faqPage) schemas.push(faqPage);
  else if (faqs.length) schemas.push(faqNode(faqs));
  const image = PAGE_IMAGES[path];
  const html = renderDocument({
    title,
    description,
    path,
    bodyHtml: renderMarkdown(body),
    schemas,
    ogType: 'article',
    image: image ? pageUrl(image.src) : undefined,
    imageAlt: image?.alt,
  });
  assertNoCurlyPlaceholders(html, path || 'guide html');
  return html;
}

export function listGuides(dir = GUIDES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort()
    .map((name) => {
      const slug = `/guides/${name.replace(/\.md$/, '')}`;
      const guide = guideFromMarkdown(readFileSync(join(dir, name), 'utf8'), slug);
      if (!guide.path) guide.path = slug;
      if (!guide.file) guide.file = `${guide.path.replace(/^\//, '')}.html`;
      return guide;
    });
}

export { SITE };
