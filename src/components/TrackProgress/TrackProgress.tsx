import { useTranslation } from 'react-i18next'
import './trackprogress.css'

/**
 * Progress indicator following the "track" motif:
 * rounded segments (radius = ½ height, gap = ½ height),
 * completed — violet, remaining — lavender, "64%" value on the right.
 */
export interface TrackProgressProps {
  /** Progress 0–100. */
  value: number
  /** Number of track segments. */
  segments?: number
  /** "64%" value on the right. */
  showLabel?: boolean
  /** ARIA label (defaults to common:progress.label). */
  label?: string
  className?: string
}

export function TrackProgress({
  value,
  segments = 5,
  showLabel = true,
  label,
  className,
}: TrackProgressProps) {
  const { t } = useTranslation('common')
  const clamped = Math.max(0, Math.min(100, value))
  const segSize = 100 / segments
  const cls = ['lt-track', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <div
        className="lt-track__rail"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label ?? t('progress.label')}
      >
        {Array.from({ length: segments }, (_, i) => {
          const start = i * segSize
          const fillRatio = Math.max(0, Math.min(1, (clamped - start) / segSize))
          return (
            <span key={i} className="lt-track__seg" aria-hidden="true">
              {fillRatio > 0 && (
                <span className="lt-track__fill" style={{ width: `${fillRatio * 100}%` }} />
              )}
            </span>
          )
        })}
      </div>
      {showLabel && <span className="lt-track__value lt-data">{Math.round(clamped)}%</span>}
    </div>
  )
}
