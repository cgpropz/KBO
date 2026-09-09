const RED = [239, 68, 68];
const NEUTRAL = [203, 213, 225];
const GREEN = [34, 197, 94];

const interpolate = (start, end, amount) => start.map((value, index) => (
  Math.round(value + (end[index] - value) * amount)
));

export function getCgProjectionColor(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return undefined;
  const bounded = Math.max(1, Math.min(100, score));
  const rgb = bounded <= 50
    ? interpolate(RED, NEUTRAL, (bounded - 1) / 49)
    : interpolate(NEUTRAL, GREEN, (bounded - 50) / 50);
  return `rgb(${rgb.join(', ')})`;
}