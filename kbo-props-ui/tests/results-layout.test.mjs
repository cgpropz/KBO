import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResultsLayout, resultsPeekPx, resultsTranslate } from '../src/resultsLayout.js';

const COUNT = 6;

test('phone width shows one centered slip with a small peek', () => {
  for (const width of [320, 350, 390, 430]) {
    const layout = computeResultsLayout(width, COUNT);
    assert.equal(layout.perView, 1, `perView at ${width}`);
    assert.equal(layout.peek, true, `peek at ${width}`);
    assert.ok(layout.cardWidth < layout.viewport, `card narrower than row at ${width}`);
    const peek = resultsPeekPx(layout);
    assert.ok(peek >= 16 && peek <= 56, `peek ${peek}px at ${width}`);
  }
});

test('landing column shows full slips, usually two, and they fill the row', () => {
  for (const width of [720, 900, 1024, 1064]) {
    const layout = computeResultsLayout(width, COUNT);
    assert.equal(layout.peek, false, `no partial slip at ${width}`);
    assert.ok(layout.perView >= 2, `at least two at ${width}`);
    const used = layout.perView * layout.cardWidth + (layout.perView - 1) * layout.gap;
    assert.ok(used <= width, `row does not overflow at ${width}`);
    assert.ok(width - used < layout.perView, `full slips use the row at ${width}`);
  }
  assert.equal(computeResultsLayout(1064, COUNT).perView, 2);
  assert.equal(computeResultsLayout(1024, COUNT).perView, 2);
});

test('a very wide row can show a third full slip', () => {
  const layout = computeResultsLayout(1400, COUNT);
  assert.equal(layout.perView, 3);
  assert.equal(layout.peek, false);
  const used = layout.perView * layout.cardWidth + (layout.perView - 1) * layout.gap;
  assert.ok(used <= 1400);
});

test('loop positions for the same slip are one set apart', () => {
  const layout = computeResultsLayout(1064, COUNT);
  const stride = layout.cardWidth + layout.gap;
  const start = resultsTranslate(COUNT, layout);
  const clone = resultsTranslate(COUNT * 2, layout);
  assert.equal(start - clone, COUNT * stride);
});

test('one step moves exactly one slip', () => {
  const wide = computeResultsLayout(1064, COUNT);
  const phone = computeResultsLayout(350, COUNT);
  for (const layout of [wide, phone]) {
    const stride = layout.cardWidth + layout.gap;
    const a = resultsTranslate(COUNT, layout);
    const b = resultsTranslate(COUNT + 1, layout);
    assert.equal(a - b, stride);
  }
});
