/*
 * Layout math for the Results slip row.
 * One horizontal row: phone shows a single centered slip with a peek of the
 * next; wider widths show as many full slips as fit (two on the landing
 * column) and advance one slip at a time.
 */

export function computeResultsLayout(width, slipCount = 6) {
  const safe = Number.isFinite(width) ? Math.max(0, width) : 0;
  const count = Math.max(1, slipCount | 0);
  const gap = safe < 640 ? 12 : 16;

  if (safe < 32) {
    return { cardWidth: 0, gap, perView: 1, peek: true, viewport: safe };
  }

  // Prefer a card wide enough that a tall slip stays readable. Two full slips
  // is the usual landing width; a third appears only when each stays large.
  const comfortable = 380;
  let perView = Math.floor((safe + gap) / (comfortable + gap));
  if (perView < 2) {
    const twoUp = (safe - gap) / 2;
    if (twoUp >= 270) perView = 2;
  }
  perView = Math.min(count, Math.max(perView, 1));

  if (perView >= 2) {
    const cardWidth = Math.floor((safe - gap * (perView - 1)) / perView);
    return { cardWidth, gap, perView, peek: false, viewport: safe };
  }

  const sidePeek = Math.min(44, Math.max(22, Math.round(safe * 0.08)));
  let cardWidth = safe - 2 * sidePeek - 2 * gap;
  const maxCard = Math.min(420, safe - 48);
  cardWidth = Math.max(160, Math.min(cardWidth, maxCard));
  if (cardWidth > safe - 16) cardWidth = Math.max(120, safe - 24);
  return { cardWidth, gap, perView: 1, peek: true, viewport: safe };
}

export function resultsTranslate(index, layout) {
  const stride = layout.cardWidth + layout.gap;
  if (layout.peek) {
    return (layout.viewport - layout.cardWidth) / 2 - index * stride;
  }
  return -index * stride;
}

/** Neighbor peek in px for the centered single-slip layout. 0 when not peeking. */
export function resultsPeekPx(layout) {
  if (!layout.peek || !layout.cardWidth) return 0;
  return (layout.viewport - layout.cardWidth) / 2 - layout.gap;
}
