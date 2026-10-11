import './GuideLinks.css'

export const START_HERE_HREF = '/guides/start-here'
export const CG_SCORE_GUIDE_HREF = '/guides/cg-score'

export function GuideNavLinks() {
  return (
    <>
      <a className="guide-nav-link" href={START_HERE_HREF}>Start Here</a>
      <a className="guide-nav-link" href={CG_SCORE_GUIDE_HREF}>How CG Score works</a>
    </>
  )
}
