import { AFFILIATION_LINE, AGE_LINE, GAMBLER_HELP_URL, OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling.js';
import './SiteFooter.css';

export function ResponsibleGamblingCopy() {
  return (
    <>
      <p className="site-footer-links">
        <a href="/guides/start-here">Start Here</a>
        <a href="/guides/cg-score">How CG Score works</a>
        <a href="/policies">Plans & Policies</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/responsible-gaming">Responsible Gaming</a>
        <a href="/states-not-available">Where CGPropz isn't available</a>
      </p>
      <p>{STANDARD_LINE}</p>
      <p>{OPERATOR_DISCLAIMER}</p>
      <p>{AGE_LINE}</p>
      <p>{AFFILIATION_LINE}</p>
      <p><a href={GAMBLER_HELP_URL}>ncpgambling.org</a></p>
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
