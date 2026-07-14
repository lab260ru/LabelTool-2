import './spinner.css'

export interface SpinnerProps {
  /** Diameter in px. */
  size?: number
  /** Screen-reader label; without it the spinner is decorative. */
  label?: string
  /** Inline (in a button/badge) — without its own margins. */
  inline?: boolean
  className?: string
}

export function Spinner({ size = 24, label, inline = false, className }: SpinnerProps) {
  const cls = ['lt-spinner', inline ? 'lt-spinner--inline' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <span
      className={cls}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 9)) }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
