/**
 * Internal icon set for the UI library (stroke = currentColor).
 * This is NOT brand graphics: the only brand motif is the "tracks",
 * the icons are neutral interface pictograms.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

export const IconSun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
  </svg>
)

export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.2 13.6A8.2 8.2 0 1 1 10.4 3.8a6.6 6.6 0 0 0 9.8 9.8Z" />
  </svg>
)

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
)

export const IconGlobe = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a13.4 13.4 0 0 1 0 18M12 3a13.4 13.4 0 0 0 0 18" />
  </svg>
)

export const IconCollapse = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m11.5 7-5 5 5 5M17.5 7l-5 5 5 5" />
  </svg>
)

/** Waveform — the "Annotation" section (audio annotation). */
export const IconWaveform = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" />
  </svg>
)

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
)

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z" />
  </svg>
)

export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.6 15.3c1.6.6 2.6 1.9 3 4.2" />
  </svg>
)

export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4v16h16" />
    <path d="M8.5 15.5v-4M13 15.5V8M17.5 15.5v-6.5" />
  </svg>
)

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 5.7v5.1c0 4.4 2.9 7.6 7 9.5 4.1-1.9 7-5.1 7-9.5V5.7L12 3Z" />
    <path d="m9 11.8 2.2 2.2 3.8-4" />
  </svg>
)

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15.5v-11M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </svg>
)

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4.2M12 16.8v.4" />
  </svg>
)

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.4" />
  </svg>
)

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconUser = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M4.8 20c.9-3.4 3.6-5.2 7.2-5.2s6.3 1.8 7.2 5.2" />
  </svg>
)

export const IconKey = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8.5" cy="15.5" r="4" />
    <path d="m11.5 12.5 8-8M16.5 7.5l3 3M14 10l2 2" />
  </svg>
)

export const IconSignOut = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.5 4.5h-8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8" />
    <path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" />
  </svg>
)
