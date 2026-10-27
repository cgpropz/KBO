import { useAuth } from './AuthContext'
import { canSeeCheatsheets } from './entitlements'
import { cheatsheetsHref } from './cheatsheets/access'
import './cheatsheets/cheatsheetsNav.css'

export default function CheatsheetsNavLink({ className = '' }) {
  const { user } = useAuth()
  if (!canSeeCheatsheets(user)) return null
  const href = cheatsheetsHref(typeof window === 'undefined' ? '' : window.location.search)
  const classes = className ? `cheatsheets-nav ${className}` : 'cheatsheets-nav'
  return (
    <a href={href} className={classes} data-testid="cheatsheets-nav">Cheatsheets</a>
  )
}
