import './sectiondivider.css'

/**
 * Section divider: a strip of 2–3 rounded segments below
 * a heading. No more than two colors per strip besides the neutral one:
 * violet + coral (spot) + lavender (neutral backdrop).
 */
export interface SectionDividerProps {
  /** Number of segments: 2 (violet+lavender) or 3 (violet+coral+lavender). */
  segments?: 2 | 3
  className?: string
}

export function SectionDivider({ segments = 3, className }: SectionDividerProps) {
  const cls = ['lt-divider', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls} aria-hidden="true">
      <span className="lt-divider__seg lt-divider__seg--violet" />
      {segments === 3 && <span className="lt-divider__seg lt-divider__seg--coral" />}
      <span className="lt-divider__seg lt-divider__seg--lavender" />
    </div>
  )
}
