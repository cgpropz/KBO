import { AFFILIATION_LINE, AGE_LINE } from './responsibleGambling.js';
import './SiteFooter.css';

export function ResponsibleGamblingCopy() {
  return (
    <>
      <p className="site-footer-links">
        <a href="/guides/start-here">Start Here</a>
        <a href="/guides/cg-score">How CG Score works</a>
        <a href="/policies">Plans & Policies</a>
      </p>
      <p>{AGE_LINE}</p>
      <p>{AFFILIATION_LINE}</p>
    </>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <ResponsibleGamblingCopy />
    </footer>
  );
}
