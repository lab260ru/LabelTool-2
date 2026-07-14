/**
 * Audio player transport icons: neutral pictograms (not brand
 * graphics), currentColor fill — matching the button in both themes.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8.2 5.2a1 1 0 0 1 1.5-.9l10 6.8a1 1 0 0 1 0 1.8l-10 6.8a1 1 0 0 1-1.5-.9V5.2Z" />
  </svg>
)

export const IconPause = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="4.5" width="4.4" height="15" rx="1.4" />
    <rect x="13.6" y="4.5" width="4.4" height="15" rx="1.4" />
  </svg>
)

export const IconZoomIn = (p: IconProps) => (
  <svg
    {...base(p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5M8.5 11h5M11 8.5v5" />
  </svg>
)
