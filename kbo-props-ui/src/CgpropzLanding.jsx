import { useAuth } from './AuthContext';
import SportSwitcher from './SportSwitcher';
import { PageMenu, PageMenuButton, usePageMenu } from './PageMenu';
import { sportAccess } from './entitlements';
import { NBA_CARD, SPORTS } from './sportsMeta';
import LandingSportCard from './LandingSportCard';
import { useNbaOpen } from './useNbaOpen';
import TrustStrip from './TrustStrip';
import Testimonials from './Testimonials';
import TestimonialForm from './TestimonialForm';
import Results from './Results';
import DiscordInviteLink from './DiscordInviteLink';
import DiscordAccount from './DiscordAccount';
import { ResponsibleGamblingCopy } from './SiteFooter';
import MemberCommandCenter from './MemberCommandCenter';
import './CgpropzLanding.css';

/*
 * cgpropz — unified brand hub / front door.
 * Sits above all sports. Users land here after login,
 * pick a sport to enter, or jump to the unified pricing page.
 *
 * Props:
 *   onEnterSport(sport)  → 'kbo' | 'wnba' | 'nfl' | 'nhl'
 *   onNavigate(view)     → e.g. 'pricing'
 */

export default function CgpropzLanding({ onEnterSport, onNavigate }) {
  const { user, tier, signOut } = useAuth();
  const menu = usePageMenu();
  const { open: nbaOpen } = useNbaOpen();
  const access = sportAccess(tier);
  const isPaid = access.kbo || access.wnba || access.nfl || access.nhl;
  const isAllAccess = access.kbo && access.wnba && access.nfl && access.nhl;
  const isDiscordOnly = tier === 'discord';

  // Paid members land on the Sports Hub. Free and Discord-only accounts keep
  // this page; logged-out visitors see PublicLanding.
  if (isPaid) {
    return <MemberCommandCenter onEnterSport={onEnterSport} onNavigate={onNavigate} />;
  }

  return (
    <div className="cg-landing">
      <div className="cg-bg" />

      <header className="cg-header" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close(); }}>
        <div className="cg-wordmark">
          cg<span className="cg-wordmark-accent">propz</span>
        </div>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport="" setSport={onEnterSport} />
        <PageMenu open={menu.open}>
          <nav className="cg-guide-nav" aria-label="Guides">
            <a href="/guides/start-here">Start Here</a>
            <a href="/guides/cg-score">How CG Score works</a>
          </nav>
          <div className="cg-header-actions">
            <button className="cg-link-btn" onClick={() => onNavigate('pricing')}>
              {isPaid ? 'Manage Plan' : 'Pricing'}
            </button>
            {user && (
              <button className="cg-signout" onClick={signOut} title={user.email}>
                Sign Out
              </button>
            )}
          </div>
        </PageMenu>
      </header>

      <main className="cg-main">
        <section className="cg-hero">
          <div className="cg-hero-badge">
            {isAllAccess ? '✓ ALL ACCESS ACTIVE' : isPaid ? '✓ MEMBER ACCESS ACTIVE' : isDiscordOnly ? '✓ DISCORD MEMBER' : 'HAND-CRAFTED PROPS'}
          </div>
          <h1 className="cg-hero-title">
            One edge. <span className="cg-hero-grad">Every sport.</span>
          </h1>
          <p className="cg-hero-sub">
            Data-driven projections, hit rates, and prop analysis across KBO baseball,
            WNBA basketball, NFL football, and NHL hockey — all under one login, one subscription.
          </p>
          <div className="cg-hero-cta">
            <button className="cg-cta-primary" onClick={() => onEnterSport('kbo')}>Enter the app</button>
            {!isPaid && (
              <button className="cg-cta-ghost" onClick={() => onNavigate('pricing')}>View plans</button>
            )}
          </div>
          <TrustStrip align="center" />
        </section>

        {user && <DiscordAccount />}

        <section className="cg-sports">
          {[...SPORTS, NBA_CARD].map((s) => (
            <LandingSportCard
              key={s.id}
              variant="hub"
              sport={s}
              nbaOpen={nbaOpen}
              onOpen={onEnterSport}
            />
          ))}
        </section>

        <Results />

        <Testimonials />
        <TestimonialForm />

        <section className="cg-pricing-strip">
          <div className="cg-pricing-copy">
            <h3>One subscription. Every sport.</h3>
            <p>All Access unlocks KBO, WNBA, NFL, and NHL projections, prop cards, and edge boards.</p>
            <p className="cg-pricing-note">No credit card required to explore the free board first.</p>
          </div>
          <button className="cg-cta-primary" onClick={() => onNavigate('pricing')}>
            {isPaid ? 'Manage subscription' : 'See pricing'}
          </button>
        </section>
      </main>

      <footer className="cg-footer">
        <span>© {new Date().getFullYear()} cgpropz</span>
        <DiscordInviteLink />
        <div className="site-footer">
          <ResponsibleGamblingCopy />
        </div>
      </footer>
    </div>
  );
}
