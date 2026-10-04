import './Results.css';

/*
 * Settled PrizePicks slips, shared by the public marketing page and the
 * logged-in hub. The files are the original screenshots — players are not
 * redrawn. `focus` is only a window onto each file so phone letterboxing
 * does not push the sport cards around; the pixels are unchanged.
 */
const SLIPS = [
  {
    src: '/results/wnba-10-to-win-60-aug-23-2026.jpg',
    alt: 'PrizePicks WNBA 3-pick Power Play, $10 to win $60: Kiki Iriafen, Kelsey Mitchell, and Natasha Cloud. August 23, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 590, w: 1290, h: 1610 },
  },
  {
    src: '/results/wnba-100-paid-1000-aug-19-2026.jpg',
    alt: 'PrizePicks WNBA 4-pick Power Play win, $100 paid $1,000: A’ja Wilson, Allisha Gray, Rhyne Howard, and Natasha Cloud. August 19, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 450, w: 1290, h: 1900 },
  },
  {
    src: '/results/wnba-50-paid-300-aug-14-2026.jpg',
    alt: 'PrizePicks WNBA 3-pick Power Play win, $50 paid $300: Dearica Hamby, Jackie Young, and Shakira Austin. August 14, 2026.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 590, w: 1290, h: 1610 },
  },
  {
    src: '/results/kbo-flex-power-slips.jpg',
    alt: 'PrizePicks KBO slips: $50 paid $100 6-pick Flex Play, $10 paid $30 3-pick Power Play, and $10 paid $60 3-pick Power Play.',
    width: 1290,
    height: 2796,
    focus: { x: 0, y: 700, w: 1290, h: 1420 },
  },
  {
    src: '/results/kbo-bonus-95-oct-4-2026.jpg',
    alt: 'PrizePicks KBO 6-pick Power Play win, bonus paid $95: Kim Do-yeong, Guillermo Heredia, Koo Ja-wook (DNP), Matt Davidson, Choi Won-jun, and Victor Reyes. October 4, 2026.',
    width: 3464,
    height: 3464,
    focus: { x: 860, y: 0, w: 1744, h: 3464 },
  },
  {
    src: '/results/kbo-10-paid-30-oct-4-2026.png',
    alt: 'PrizePicks KBO 3-pick Power Play win, $10 paid $30: Kim Do-yeong, Park Hae-min (push), and Kim Ji-chan. October 4, 2026.',
    width: 1290,
    height: 1536,
    focus: { x: 0, y: 0, w: 1290, h: 1536 },
  },
];

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

export default function Results() {
  return (
    <section className="results-section" id="results" aria-labelledby="results-title">
      <div className="results-heading">
        <span className="results-kicker">PrizePicks</span>
        <h2 id="results-title">Results</h2>
        <p>Settled slips across WNBA and KBO.</p>
      </div>
      <div className="results-grid">
        {SLIPS.map((slip) => (
          <figure className="results-card" key={slip.src}>
            <div className="results-frame" style={frameStyle(slip)}>
              <img
                src={slip.src}
                alt={slip.alt}
                width={slip.focus.w}
                height={slip.focus.h}
                loading="lazy"
                decoding="async"
              />
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
