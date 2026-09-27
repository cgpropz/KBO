import { useEffect, useState } from 'react';
import './Testimonials.css';

// Fallback illustrative quotes — shown only until real subscriber
// testimonials have been submitted and approved via /api/testimonials.
const FALLBACK = [
  { quote: 'I can compare the line, projection, and recent form without jumping between five tabs.', label: 'The daily scan' },
  { quote: 'The CG Projection gives every prop a clear strength signal, so I know where to spend my attention.', label: 'The edge finder', featured: true },
  { quote: 'I use the matchup context and game-log view to build a smaller, more deliberate slip.', label: 'The disciplined build' },
];

export default function Testimonials() {
  const [real, setReal] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/testimonials')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && Array.isArray(body?.testimonials)) setReal(body.testimonials);
      })
      .catch(() => {});
    return () => { cancelled = true };
  }, []);

  const hasReal = real && real.length > 0;
  const cards = hasReal
    ? real.slice(0, 3).map((t, i) => ({ quote: t.quote, label: t.display_name, featured: i === 0 }))
    : FALLBACK;

  return (
    <section className="testi-section" aria-labelledby="testi-title">
      <div className="testi-heading">
        <span className="testi-kicker">Subscriber perspective</span>
        <h2 id="testi-title">Built for a calmer way to play the board.</h2>
        <p>
          {hasReal
            ? 'Real feedback from cgpropz subscribers.'
            : 'Representative feedback from the workflows cgpropz is designed to support.'}
        </p>
      </div>
      <div className="testi-grid">
        {cards.map((c) => (
          <article className={`testi-card ${c.featured ? 'testi-card-featured' : ''}`} key={c.label}>
            <span className="testi-quote-mark" aria-hidden="true">&ldquo;</span>
            <p>&ldquo;{c.quote}&rdquo;</p>
            <span className="testi-label">{c.label}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
