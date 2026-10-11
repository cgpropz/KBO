import { AFFILIATION_LINE, AGE_LINE } from './responsibleGambling.js';
import './SiteFooter.css';

export function ResponsibleGamblingCopy() {
  return (
    <>
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
