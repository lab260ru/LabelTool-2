/**
 * Timecode formatting: `m:ss.t` (hours — when duration ≥1 h).
 * Render in markup with the `lt-data` class — tabular figures.
 */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const total = Math.floor(safe)
  const tenths = Math.floor((safe - total) * 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}.${tenths}` : `${m}:${s}.${tenths}`
}
