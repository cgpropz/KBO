// Turns content/guides/*.md into static /guides/<slug> pages.
// Author notes in HTML comments are dropped. The article body is rendered
// as written: placeholders such as {{CONFIRM WITH BOARD QA}} stay.

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
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function isBlockStart(line) {
  return /^(#{1,6}\s|```|>|[-*] |\|)/.test(line) || line.trim() === '---';
}

function renderTable(rows) {
  const parsed = rows
    .map((row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  if (!parsed.length) return '';
  const head = parsed[0].map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
  const body = parsed.slice(1).map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.trim() === '---') { out.push('<hr />'); i += 1; continue; }
    if (line.startsWith('```')) {
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) i += 1;
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
    const question = line.match(/^\*\*(.+)\*\*\s*$/);
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
    const question = line.match(/^\*\*(.+)\*\*\s*$/);
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
  text = text.replace(/\*\*JSON-LD \(FAQPage\)\*\*\s*```json[\s\S]*?```/g, '').trim();
  return { meta, body: text };
}

export function guideFromMarkdown(markdown, fallbackSlug) {
  const { meta, body } = stripGuideSource(markdown);
  const path = (meta.slug || fallbackSlug || '').trim();
  const faqs = extractFaqs(body);
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
    html: renderGuideHtml({ title, description, path, body, faqs, h1, datePublished, dateModified }),
  };
}

function renderGuideHtml({ title, description, path, body, faqs, h1, datePublished, dateModified }) {
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
  if (faqs.length) schemas.push(faqNode(faqs));
  return renderDocument({
    title,
    description,
    path,
    bodyHtml: renderMarkdown(body),
    schemas,
    ogType: 'article',
  });
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
