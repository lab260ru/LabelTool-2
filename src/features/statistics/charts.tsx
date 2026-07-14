/**
 * Statistics charts — ONLY pure SVG/CSS on theme tokens
 * (--accent / --accent-soft / --lavender; no chart libraries).
 * Both themes are supported automatically: colors are taken from CSS variables.
 */
import { useTranslation } from 'react-i18next'
import { TASK_TYPES } from '../../api/types'
import type { TaskType } from '../../api/types'

/* ── Mini bar chart "tasks per week" (SVG) ───────────────────────────────── */

export interface WeeklyBarChartProps {
  values: number[]
  labels: string[]
  /** Full text description of the chart (WCAG AA). */
  ariaLabel: string
}

const SLOT = 46
const CHART_H = 148
const TOP_PAD = 16
const BOTTOM_PAD = 22

export function WeeklyBarChart({ values, labels, ariaLabel }: WeeklyBarChartProps) {
  const width = values.length * SLOT
  const max = Math.max(1, ...values)
  const plotH = CHART_H - TOP_PAD - BOTTOM_PAD
  const baseline = CHART_H - BOTTOM_PAD

  return (
    <svg
      className="st-chart"
      viewBox={`0 0 ${width} ${CHART_H}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1="0" y1={baseline} x2={width} y2={baseline} className="st-chart__axis" />
      {values.map((value, i) => {
        const h = value > 0 ? Math.max(4, (value / max) * plotH) : 0
        const barW = SLOT - 18
        const x = i * SLOT + 9
        const y = baseline - h
        const cx = x + barW / 2
        return (
          <g key={i}>
            {h > 0 && (
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(6, h / 2)}
                className="st-chart__bar"
              />
            )}
            <text x={cx} y={y - 5} textAnchor="middle" className="st-chart__value lt-data">
              {value}
            </text>
            <text x={cx} y={CHART_H - 6} textAnchor="middle" className="st-chart__label">
              {labels[i]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ── Task-type distribution (CSS bars in the «track» motif) ────── */

export interface TaskTypeDistributionProps {
  counts: Partial<Record<TaskType, number>>
  ariaLabel: string
}

export function TaskTypeDistribution({ counts, ariaLabel }: TaskTypeDistributionProps) {
  const { t } = useTranslation('statistics')
  const { t: tc } = useTranslation('common')
  const total = TASK_TYPES.reduce((sum, tt) => sum + (counts[tt] ?? 0), 0)

  return (
    <ul className="st-dist" aria-label={ariaLabel}>
      {TASK_TYPES.map((tt) => {
        const value = counts[tt] ?? 0
        const pct = total > 0 ? (value / total) * 100 : 0
        return (
          <li key={tt} className="st-dist__row">
            <span className="st-dist__name">{tc(`taskTypes.${tt}`)}</span>
            <span className="st-dist__track" aria-hidden="true">
              <span className="st-dist__fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="st-dist__num lt-data">
              {t('charts.typesValue', { n: value, pct: Math.round(pct) })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
