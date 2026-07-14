import { Spinner } from '../Spinner/Spinner'
import './statusbadge.css'

/**
 * Status badges: ok (green) / warn (yellow) / error (coral) /
 * neutral (gray) / progress (violet + spinner).
 * Used for upload file statuses, export, and tables.
 */
export interface StatusBadgeProps {
  kind: 'ok' | 'warn' | 'error' | 'neutral' | 'progress'
  label: string
  className?: string
}

export function StatusBadge({ kind, label, className }: StatusBadgeProps) {
  const cls = ['lt-badge', `lt-badge--${kind}`, className ?? ''].filter(Boolean).join(' ')
  return (
    <span className={cls}>
      {kind === 'progress' ? <Spinner size={10} inline /> : <span className="lt-badge__dot" aria-hidden="true" />}
      {label}
    </span>
  )
}
