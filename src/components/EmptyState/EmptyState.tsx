import type { ReactNode } from 'react'
import './emptystate.css'

/**
 * Empty state: title, description, and action centered,
 * without a decorative illustration.
 */
export interface EmptyStateProps {
  title: string
  description?: string
  /** Button/link below the text. */
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ title, description, action, compact = false, className }: EmptyStateProps) {
  const cls = ['lt-empty', compact ? 'lt-empty--compact' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <p className="lt-empty__title">{title}</p>
      {description && <p className="lt-empty__desc">{description}</p>}
      {action && <div className="lt-empty__action">{action}</div>}
    </div>
  )
}
