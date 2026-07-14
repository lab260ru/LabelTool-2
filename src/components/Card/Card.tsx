import type { HTMLAttributes, ReactNode } from 'react'
import './card.css'

/** Card/panel: rounded, --surface (light) / --dark-bg-2 (dark). */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Actions in the card header (to the right of the title). */
  actions?: ReactNode
  padding?: 'md' | 'lg' | 'none'
  children?: ReactNode
}

export function Card({ title, actions, padding = 'md', className, children, ...rest }: CardProps) {
  const cls = ['lt-card', `lt-card--pad-${padding}`, className ?? ''].filter(Boolean).join(' ')
  return (
    <section className={cls} {...rest}>
      {(title !== undefined || actions !== undefined) && (
        <header className="lt-card__header">
          {title !== undefined && <h2 className="lt-card__title">{title}</h2>}
          {actions !== undefined && <div className="lt-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
