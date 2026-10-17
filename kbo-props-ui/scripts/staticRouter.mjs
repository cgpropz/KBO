// Local stand-in for the Vercel routes in vercel.json: redirects, clean URLs,
// explicit rewrites, then a real 404. There is no SPA catch-all.

import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function collectSiteFiles(uiRoot) {
  const files = new Set();
  if (existsSync(join(uiRoot, 'index.html'))) files.add('/index.html');
  if (existsSync(join(uiRoot, 'x.html'))) files.add('/x.html');
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}/${name.name}`;
      if (name.isDirectory()) walk(join(dir, name.name), rel);
      else files.add(rel);
    }
  };
  walk(join(uiRoot, 'public'), '');
  return files;
}

function sourceRegex(source) {
  const token = source.replace(/\(\.\*\)/g, '___STAR___');
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/___STAR___/g, '(.*)');
  return new RegExp(`^${escaped}$`);
}

function matchSource(source, path) {
  const match = path.match(sourceRegex(source));
  return match ? match.slice(1) : null;
}

function redirectStatus(rule) {
  if (rule.statusCode) return rule.statusCode;
  return rule.permanent ? 308 : 307;
}

function applyDestination(destination, groups) {
  return destination.replace(/\$(\d+)/g, (_, index) => groups[Number(index) - 1] || '');
}

export function resolveRequest(pathname, { files, config }) {
  let path = pathname.split('?')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  const redirects = config.redirects || [];
  const rewrites = config.rewrites || [];
  const cleanUrls = config.cleanUrls === true;
  const trailingSlash = config.trailingSlash;

  if (path.length > 1 && path.endsWith('/')) {
    const stripped = path.slice(0, -1);
    const direct = redirects.find((rule) => rule.source === path || rule.source === stripped);
    if (direct) return { status: redirectStatus(direct), location: direct.destination };
    if (trailingSlash === false) return { status: 308, location: stripped };
  }

  for (const rule of redirects) {
    if (rule.source === path) return { status: redirectStatus(rule), location: rule.destination };
  }

  if (path === '/404' || path === '/404.html') {
    return { status: 404, file: files.has('/404.html') ? '/404.html' : null };
  }
  if ((path === '/index' || path === '/index.html') && files.has('/index.html')) {
    return { status: 308, location: '/' };
  }
  if (path === '/' && files.has('/index.html')) return { status: 200, file: '/index.html' };

  if (cleanUrls && path.endsWith('.html')) {
    const bare = path.slice(0, -'.html'.length);
    if (files.has(path)) return { status: 308, location: bare === '/index' ? '/' : bare };
  }
  if (files.has(path) && !(cleanUrls && path.endsWith('.html'))) return { status: 200, file: path };
  if (cleanUrls) {
    const htmlPath = `${path}.html`;
    if (htmlPath !== '/404.html' && files.has(htmlPath)) return { status: 200, file: htmlPath };
  }

  for (const rule of rewrites) {
    const groups = matchSource(rule.source, path);
    if (!groups) continue;
    const destination = applyDestination(rule.destination, groups);
    if (destination.startsWith('/api/')) return { status: 200, kind: 'api', file: destination };
    const file = files.has(destination) ? destination : null;
    if (file) return { status: 200, file };
  }

  return { status: 404, file: files.has('/404.html') ? '/404.html' : null };
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function readSiteFile(uiRoot, urlPath) {
  if (urlPath === '/index.html' || urlPath === '/x.html') return readFileSync(join(uiRoot, urlPath.slice(1)));
  return readFileSync(join(uiRoot, 'public', urlPath.slice(1)));
}

export function startStaticServer(uiRoot, config) {
  const files = collectSiteFiles(uiRoot);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const result = resolveRequest(url.pathname, { files, config });
    if (result.location) {
      res.writeHead(result.status, { Location: result.location });
      res.end();
      return;
    }
    if (!result.file || result.kind === 'api') {
      res.writeHead(result.status);
      res.end(result.kind === 'api' ? '' : 'Not found');
      return;
    }
    const body = readSiteFile(uiRoot, result.file);
    const type = contentType(result.file);
    res.writeHead(result.status, { 'Content-Type': type });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
