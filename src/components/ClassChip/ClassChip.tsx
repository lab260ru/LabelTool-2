import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '../icons'
import './classchip.css'

/**
 * Class labels — pills: speech — lavender, music — coral (spot),
 * noise — gray, silence — violet-light. Plus a custom class color
 * (the label_list editor in projects).
 */
export interface ClassChipProps {
  label: string
  /** Preset classes from the brand book. */
  variant?: 'speech' | 'music' | 'noise' | 'silence'
  /** Custom class color (overrides variant): border/text + soft backdrop. */
  color?: string
  /** Remove cross (e.g., key=value metadata, label_list). */
  onRemove?: () => void
  className?: string
}

export function ClassChip({ label, variant = 'speech', color, onRemove, className }: ClassChipProps) {
  const { t } = useTranslation('common')
  const cls = ['lt-chip', color ? 'lt-chip--custom' : `lt-chip--${variant}`, className ?? '']
    .filter(Boolean)
    .join(' ')
  const style = color ? ({ '--lt-chip-color': color } as CSSProperties) : undefined
  return (
    <span className={cls} style={style}>
      {/* Class color as a dot: the text stays neutral (WCAG AA) */}
      {color && <span className="lt-chip__color-dot" aria-hidden="true" />}
      <span className="lt-chip__label">{label}</span>
      {onRemove && (
        <button
          type="button"
          className="lt-chip__remove"
          onClick={onRemove}
          aria-label={`${t('actions.remove')}: ${label}`}
        >
          <IconX size={12} />
        </button>
      )}
    </span>
  )
}
