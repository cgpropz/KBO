import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { computeResultsLayout, resultsTranslate } from './resultsLayout';
import './Results.css';

/*
 * Settled PrizePicks slips, shared by the public marketing page and the
 * logged-in hub. Files are the original screenshots. `focus` only hides
 * the empty phone letterbox around each slip; the slip itself is uncropped.
 * The section stays in normal document flow under the sport cards.
 *
 * The slips sit in one row and advance one at a time. Three copies of the
 * row make the loop: after the slide onto the clone, the track jumps back
 * to the same slip in the middle copy with motion off, so the reset is invisible.
 */
const SLIPS = [
  {
    src: '/results/wnba-10-to-win-60-aug-23-2026.jpg',
    alt: 'PrizePicks WNBA 3-pick Power Play, $10 to win $60: Kiki Iriafen, Kelsey Mitchell, and Natasha Cloud. August 23, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 600, w: 1290, h: 1680 },
  },
  {
    src: '/results/wnba-100-paid-1000-aug-19-2026.jpg',
    alt: 'PrizePicks WNBA 4-pick Power Play win, $100 paid $1,000: A’ja Wilson, Allisha Gray, Rhyne Howard, and Natasha Cloud. August 19, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 400, w: 1290, h: 2020 },
  },
  {
    src: '/results/wnba-50-paid-300-aug-14-2026.jpg',
    alt: 'PrizePicks WNBA 3-pick Power Play win, $50 paid $300: Dearica Hamby, Jackie Young, and Shakira Austin. August 14, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 540, w: 1290, h: 1740 },
  },
  {
    src: '/results/kbo-flex-power-slips.jpg',
    alt: 'PrizePicks KBO slips: $50 paid $100 6-pick Flex Play, $10 paid $30 3-pick Power Play, and $10 paid $60 3-pick Power Play.',
    width: 1290,
    height: 2796,
    focus: { x: 24, y: 640, w: 1242, h: 1540 },
  },
  {
    src: '/results/kbo-bonus-95-oct-4-2026.jpg',
    alt: 'PrizePicks KBO 6-pick Power Play win, bonus paid $95: Kim Do-yeong, Guillermo Heredia, Koo Ja-wook (DNP), Matt Davidson, Choi Won-jun, and Victor Reyes. October 4, 2026.',
    width: 3464,
    height: 3464,
    focus: { x: 820, y: 0, w: 1824, h: 3464 },
  },
  {
    src: '/results/kbo-10-paid-30-oct-4-2026.png',
    alt: 'PrizePicks KBO 3-pick Power Play win, $10 paid $30: Kim Do-yeong, Park Hae-min (push), and Kim Ji-chan. October 4, 2026.',
    width: 1290,
    height: 1536,
    focus: { x: 0, y: 0, w: 1290, h: 1536 },
  },
];

const COUNT = SLIPS.length;
const COPIES = 3;
const START_INDEX = COUNT;
const ADVANCE_MS = 4000;
const SLIDE_EASE = 'transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1)';
const SWIPE_PX = 48;

function frameStyle(slip) {
  const { x, y, w, h } = slip.focus;
  const cx = ((x + w / 2) / slip.width) * 100;
  const cy = ((y + h / 2) / slip.height) * 100;
  return {
    aspectRatio: `${w} / ${h}`,
    '--results-x': `${cx}%`,
    '--results-y': `${cy}%`,
  };
}

function subscribeReduced(onChange) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function readReduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Chevron({ dir }) {
  const d = dir === 'prev' ? 'M10.2 3.2 L5 8 L10.2 12.8' : 'M5.8 3.2 L11 8 L5.8 12.8';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Results() {
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, () => false);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const carouselRef = useRef(null);
  const indexRef = useRef(START_INDEX);
  const metricsRef = useRef(computeResultsLayout(0, COUNT));
  const dragRef = useRef(null);
  const [index, setIndex] = useState(START_INDEX);
  const [motion, setMotion] = useState(false);
  const [metrics, setMetrics] = useState(() => computeResultsLayout(0, COUNT));
  const [rowHeight, setRowHeight] = useState(0);
  const [cover, setCover] = useState(null);
  const [hover, setHover] = useState(false);
  const [keyFocus, setKeyFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);

  const applyIndex = useCallback((next, animate) => {
    indexRef.current = next;
    setIndex(next);
    setMotion(animate);
  }, []);

  const coverMove = useCallback((from, to) => {
    const layout = metricsRef.current;
    if (!layout?.cardWidth) return;
    const bounds = (i) => {
      const start = i - (layout.peek ? 1 : 0);
      const end = i + layout.perView - 1 + (layout.peek ? 1 : 0);
      return [start, end];
    };
    const [s1, e1] = bounds(from);
    const [s2, e2] = bounds(to);
    setCover({ start: Math.min(s1, s2), end: Math.max(e1, e2) });
  }, []);

  const step = useCallback((delta) => {
    const count = COUNT;
    const current = indexRef.current;
    const outside = current >= count * 2 || current < count;
    if (outside) {
      const base = current >= count * 2 ? current - count : current + count;
      applyIndex(base, false);
      requestAnimationFrame(() => {
        trackRef.current?.getBoundingClientRect();
        requestAnimationFrame(() => {
          coverMove(base, base + delta);
          applyIndex(base + delta, true);
        });
      });
      return;
    }
    coverMove(current, current + delta);
    applyIndex(current + delta, true);
  }, [applyIndex, coverMove]);

  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const measure = () => {
      const width = viewport.clientWidth;
      const next = computeResultsLayout(width, COUNT);
      metricsRef.current = next;
      setMetrics((prev) => {
        if (
          prev.viewport === next.viewport
          && prev.cardWidth === next.cardWidth
          && prev.gap === next.gap
          && prev.perView === next.perView
          && prev.peek === next.peek
        ) return prev;
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (reduced || !metrics.cardWidth) return;
    const track = trackRef.current;
    if (!track) return;
    const cards = track.children;
    if (!cards.length) return;
    const peekPad = (metrics.peek || dragging) ? 1 : 0;
    let start = index - peekPad;
    let end = index + metrics.perView - 1 + peekPad;
    if (cover) {
      start = Math.min(start, cover.start);
      end = Math.max(end, cover.end);
    }
    start = Math.max(0, start);
    end = Math.min(cards.length - 1, end);
    let max = 0;
    for (let i = start; i <= end; i += 1) max = Math.max(max, cards[i].offsetHeight);
    if (max > 0) {
      setRowHeight((prev) => (Math.abs(prev - max) < 1 ? prev : max));
    }
  }, [reduced, metrics, index, cover, dragging]);

  useEffect(() => {
    if (reduced || !metrics.cardWidth) return undefined;
    const id = requestAnimationFrame(() => setMotion(true));
    return () => cancelAnimationFrame(id);
  }, [reduced, metrics.cardWidth]);

  useEffect(() => {
    if (reduced || hover || keyFocus || dragging || !metrics.cardWidth) return undefined;
    const id = window.setInterval(() => stepRef.current(1), ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [reduced, hover, keyFocus, dragging, metrics.cardWidth]);

  useEffect(() => {
    const root = carouselRef.current;
    if (!root) return undefined;
    const syncFocus = () => {
      requestAnimationFrame(() => {
        const el = document.activeElement;
        const inside = !!el && root.contains(el);
        const visible = inside && typeof el.matches === 'function' && el.matches(':focus-visible');
        setKeyFocus(visible);
      });
    };
    root.addEventListener('focusin', syncFocus);
    root.addEventListener('focusout', syncFocus);
    return () => {
      root.removeEventListener('focusin', syncFocus);
      root.removeEventListener('focusout', syncFocus);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || reduced) return undefined;

    const onDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button, a')) return;
      dragRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        decided: false,
        active: false,
      };
    };

    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.decided) {
        if (Math.hypot(dx, dy) < 8) return;
        drag.decided = true;
        drag.active = Math.abs(dx) > Math.abs(dy);
        if (!drag.active) return;
        viewport.setPointerCapture?.(event.pointerId);
        setDragging(true);
        setMotion(false);
      }
      if (!drag.active) return;
      event.preventDefault();
      setDragX(dx);
    };

    const finish = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const active = drag.active;
      dragRef.current = null;
      if (viewport.hasPointerCapture?.(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      setDragX(0);
      if (active && Math.abs(dx) >= SWIPE_PX) {
        const focused = document.activeElement;
        if (focused && focused.classList?.contains('results-card') && !focused.matches(':focus-visible')) {
          focused.blur();
        }
        stepRef.current(dx < 0 ? 1 : -1);
      } else if (active) {
        setMotion(true);
      }
    };

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove, { passive: false });
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
    return () => {
      viewport.removeEventListener('pointerdown', onDown);
      viewport.removeEventListener('pointermove', onMove);
      viewport.removeEventListener('pointerup', finish);
      viewport.removeEventListener('pointercancel', finish);
    };
  }, [reduced]);

  const onTrackTransitionEnd = (event) => {
    if (event.target !== trackRef.current) return;
    if (event.propertyName !== 'transform') return;
    if (dragRef.current?.active) return;
    setCover(null);
    const current = indexRef.current;
    if (current >= COUNT * 2) {
      applyIndex(current - COUNT, false);
    } else if (current < COUNT) {
      applyIndex(current + COUNT, false);
    } else {
      return;
    }
    requestAnimationFrame(() => {
      trackRef.current?.getBoundingClientRect();
      requestAnimationFrame(() => {
        if (indexRef.current === current - COUNT || indexRef.current === current + COUNT) {
          setMotion(true);
        }
      });
    });
  };

  const scrollByCard = (delta) => {
    const viewport = viewportRef.current;
    const layout = metricsRef.current;
    if (!viewport || !layout?.cardWidth) return;
    viewport.scrollBy({ left: delta * (layout.cardWidth + layout.gap), behavior: 'auto' });
  };

  const onPrev = () => {
    if (reduced) scrollByCard(-1);
    else step(-1);
  };
  const onNext = () => {
    if (reduced) scrollByCard(1);
    else step(1);
  };

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (event.key === 'ArrowRight') onNext();
    else onPrev();
  };

  const slides = reduced ? SLIPS.map((slip, i) => ({ slip, copy: 0, i })) : Array.from({ length: COUNT * COPIES }, (_, i) => ({
    slip: SLIPS[i % COUNT],
    copy: Math.floor(i / COUNT),
    i,
  }));

  const translate = resultsTranslate(index, metrics);
  const logicalIndex = ((index % COUNT) + COUNT) % COUNT;

  return (
    <section
      className="results-section"
      id="results"
      aria-roledescription="carousel"
      aria-labelledby="results-title"
    >
      <div className="results-heading">
        <span className="results-kicker">PrizePicks</span>
        <h2 id="results-title">Results</h2>
        <p>Settled slips across WNBA and KBO.</p>
      </div>

      <div
        className="results-carousel"
        ref={carouselRef}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') setHover(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setHover(false);
        }}
        onKeyDown={onKeyDown}
      >
        <div
          className={`results-viewport${reduced ? ' is-reduced' : ' is-loop'}`}
          ref={viewportRef}
          data-results-index={logicalIndex}
          data-results-per-view={metrics.perView}
          data-results-peek={metrics.peek ? 'true' : 'false'}
          data-results-motion={reduced ? 'reduced' : 'auto'}
          style={{
            '--results-snap': metrics.peek ? 'center' : 'start',
            height: !reduced && rowHeight ? `${rowHeight}px` : undefined,
          }}
        >
          <div
            className="results-track"
            ref={trackRef}
            onTransitionEnd={reduced ? undefined : onTrackTransitionEnd}
            style={reduced ? { gap: `${metrics.gap}px` } : {
              gap: `${metrics.gap}px`,
              transform: metrics.cardWidth ? `translate3d(${translate + dragX}px, 0, 0)` : undefined,
              transition: motion ? SLIDE_EASE : 'none',
            }}
          >
            {slides.map(({ slip, copy, i }) => {
              const clone = !reduced && copy !== 1;
              const inView = i >= index - (metrics.peek ? 1 : 0) && i < index + metrics.perView + (metrics.peek ? 1 : 0);
              return (
                <figure
                  className="results-card"
                  key={`${slip.src}-${i}`}
                  aria-hidden={clone ? 'true' : undefined}
                  tabIndex={reduced || (!clone && inView) ? 0 : -1}
                  style={metrics.cardWidth ? {
                    width: `${metrics.cardWidth}px`,
                    flexBasis: `${metrics.cardWidth}px`,
                  } : undefined}
                >
                  <div className="results-frame" style={frameStyle(slip)}>
                    <img
                      src={slip.src}
                      alt={clone ? '' : slip.alt}
                      width={slip.width}
                      height={slip.height}
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                    />
                  </div>
                </figure>
              );
            })}
          </div>
        </div>

        <div className="results-controls">
          <button type="button" className="results-nav" onClick={onPrev} aria-label="Previous slip">
            <Chevron dir="prev" />
          </button>
          <button type="button" className="results-nav" onClick={onNext} aria-label="Next slip">
            <Chevron dir="next" />
          </button>
        </div>
      </div>
    </section>
  );
}
