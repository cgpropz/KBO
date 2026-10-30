import { AFFILIATION_LINE, AGE_LINE, GAMBLER_HELP_URL, INDEPENDENCE_LINE, OPERATOR_DISCLAIMER, STANDARD_LINE } from './responsibleGambling.js';
import { DATA_CREDIT_NAME, DATA_CREDIT_PREFIX, DATA_CREDIT_URL } from './dataCredit.js';
import './SiteFooter.css';

// Tiny, muted data credit. Rendered last in every footer.
export function DataCredit() {
  return (
    <p className="data-credit">
      {DATA_CREDIT_PREFIX} <a href={DATA_CREDIT_URL} target="_blank" rel="noopener noreferrer">{DATA_CREDIT_NAME}</a>
    </p>
  );
}

export function ResponsibleGamblingCopy() {
  return (
    <>
      <p className="site-footer-links">
        <a href="/results">Results</a>
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
      <p>{INDEPENDENCE_LINE}</p>
      <p><a href={GAMBLER_HELP_URL}>ncpgambling.org</a></p>
    </>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <ResponsibleGamblingCopy />
      <DataCredit />
    </footer>
  );
}
