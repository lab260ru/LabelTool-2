import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfo, IconWarning } from '../icons'
import './banner.css'

/**
 * Banner: warning — validation problems ("some files failed validation…"),
 * name conflicts; info — hints.
 */
export interface BannerProps {
  kind?: 'warning' | 'info'
  children: ReactNode
  /** Action on the right (e.g., "Retry"). */
  action?: ReactNode
  className?: string
}

export function Banner({ kind = 'info', children, action, className }: BannerProps) {
  const { t } = useTranslation('common')
  const cls = ['lt-banner', `lt-banner--${kind}`, className ?? ''].filter(Boolean).join(' ')
  const Icon = kind === 'warning' ? IconWarning : IconInfo
  return (
    <div className={cls} role={kind === 'warning' ? 'alert' : 'status'}>
      <Icon size={18} className="lt-banner__icon" aria-label={t(`banner.${kind}`)} />
      <div className="lt-banner__body">{children}</div>
      {action && <div className="lt-banner__action">{action}</div>}
    </div>
  )
}
