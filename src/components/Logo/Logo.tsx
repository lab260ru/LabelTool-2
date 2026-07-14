import './logo.css'

/**
 * LabelTool 2 logo.
 *
 * The "three tracks" mark — the composition is FIXED (do not distort, do not rotate,
 * no shadows, do not rearrange the segments):
 *   row 1 — contrast wide (graphite on light / white on dark) + lavender small;
 *   row 2 — coral small + contrast wide;
 *   row 3 — lavender wide + coral small round.
 *
 * The geometry was measured pixel by pixel from the mark on the brand book cover (300 dpi render):
 * mark proportions 234×201 (≈1.16:1), track height s=48, corner radius ½s (capsule),
 * horizontal gaps ≈ ½s, vertical ≈ 0.6s, rows aligned on both edges.
 * Do NOT "flatten" the mark to 3:2 — that is a distortion.
 *
 * Min. sizes: mark 20px, logo 110px — below that use variant="mark".
 */
export interface LogoProps {
  /** horizontal — mark + «LabelTool 2» (primary version); mark — the mark only. */
  variant?: 'horizontal' | 'mark'
  /** Mark height in px (track height; the word scales along with it). */
  size?: number
  /**
   * The "on dark" version: contrast segments and the word are white, "2" — violet-dark.
   * By default the contrast comes from the theme (var(--lt-logo-contrast)).
   */
  onDark?: boolean
  className?: string
}

/** Mark proportions per the brand book (cover measurement): width/height. */
const MARK_W = 234
const MARK_H = 201

/** Mark: viewBox 234×201, s = 48 (track height), rx = 24 (capsule). */
export function LogoMark({ size = 24, onDark, className }: Omit<LogoProps, 'variant'>) {
  const cls = ['lt-logomark', onDark ? 'lt-logo--ondark' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <svg
      className={cls}
      width={(size * MARK_W) / MARK_H}
      height={size}
      viewBox={`0 0 ${MARK_W} ${MARK_H}`}
      role="img"
      aria-label="LabelTool 2"
    >
      {/* row 1 */}
      <rect className="lt-logomark__contrast" x="0" y="0" width="118" height="48" rx="24" />
      <rect className="lt-logomark__lavender" x="147" y="0" width="87" height="48" rx="24" />
      {/* row 2 */}
      <rect className="lt-logomark__coral" x="0" y="76" width="71" height="48" rx="24" />
      <rect className="lt-logomark__contrast" x="94" y="76" width="140" height="48" rx="24" />
      {/* row 3 */}
      <rect className="lt-logomark__lavender" x="0" y="153" width="157" height="48" rx="24" />
      <rect className="lt-logomark__coral" x="186" y="153" width="48" height="48" rx="24" />
    </svg>
  )
}

/** Logo: horizontal version — mark + «LabelTool» in Sora SemiBold, "2" ALWAYS violet. */
export function Logo({ variant = 'horizontal', size = 22, onDark, className }: LogoProps) {
  if (variant === 'mark') return <LogoMark size={size} onDark={onDark} className={className} />
  const cls = ['lt-logo', onDark ? 'lt-logo--ondark' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <span className={cls} style={{ fontSize: `${size * 0.82}px` }}>
      <LogoMark size={size} onDark={onDark} />
      <span className="lt-logo__word" aria-hidden="true">
        LabelTool&nbsp;<span className="lt-logo__two">2</span>
      </span>
    </span>
  )
}
