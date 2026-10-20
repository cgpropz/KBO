// /guides: a real index of the published guides. /blog redirects here
// (vercel.json), since CGPropz has no blog and /blog used to 404.

import { listGuides } from './markdownGuide.mjs';
import { breadcrumbNode, escapeHtml, pageUrl, renderDocument } from './seoShared.mjs';

export function renderGuidesIndex(guides = listGuides()) {
  const path = '/guides';
  const title = 'Player Prop Guides: CG Score and How to Start | CGPropz';
  const description = 'CGPropz guides to player props: how to read the board, what CG Score means, how L10 hit rates work and where the free top 3 lives. 21+.';
  const items = guides
    .map((guide) => `<li><a href="${pageUrl(guide.path)}">${escapeHtml(guide.h1 || guide.title || guide.path)}</a>${guide.description ? `<br />${escapeHtml(guide.description)}` : ''}</li>`)
    .join('');
  const bodyHtml = `
      <p class="lede">Guides</p>
      <h1>CGPropz guides</h1>
      <p>Short guides to reading the CGPropz boards and the free top 3.</p>
      <ul>${items}</ul>
    `;
  return {
    path,
    file: 'guides.html',
    title,
    description,
    html: renderDocument({
      title,
      description,
      path,
      bodyHtml,
      schemas: [breadcrumbNode([{ name: 'Home', url: pageUrl('/') }, { name: 'Guides', url: pageUrl(path) }])],
    }),
  };
}
