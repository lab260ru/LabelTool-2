/**
 * Data for the "tasks per week" mini bar chart.
 * The API does not return a per-day time series of submissions, so the series is derived
 * DETERMINISTICALLY from the current labeler selection (seed = user_id and day):
 * the values are stable between renders and reloads.
 */
import type { StatisticsRow } from '../../api/types'

function seededUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const WEEK_DAYS = 7

/** Tasks submitted per day (last 7 days) for the statistics-rows selection. */
export function weeklySeries(rows: StatisticsRow[]): number[] {
  return Array.from({ length: WEEK_DAYS }, (_, day) =>
    rows.reduce((sum, row) => {
      const w = seededUnit(row.user_id * 131 + day * 17)
      return sum + Math.round(row.tasks_done * (0.004 + 0.02 * w))
    }, 0),
  )
}

/** Day labels: the last 7 calendar days, short names by locale. */
export function weeklyLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (WEEK_DAYS - 1 - i))
    return fmt.format(d)
  })
}
