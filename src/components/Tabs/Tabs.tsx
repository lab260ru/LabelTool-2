import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import './tabs.css'

/** Tabs (e.g., "Files" / "Manifest CSV/JSONL" in the upload wizard). */
export interface TabItem {
  id: string
  label: string
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  /** ARIA label for the tab list. */
  label?: string
  className?: string
}

export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keyboard: ←/→ across tabs
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const enabled = items.filter((i) => !i.disabled)
    const idx = enabled.findIndex((i) => i.id === value)
    if (idx === -1) return
    const delta = e.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(idx + delta + enabled.length) % enabled.length]
    onChange(next.id)
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)
      ?.focus()
  }

  const cls = ['lt-tabs', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls} role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab-id={item.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={`lt-tabs__tab${selected ? ' lt-tabs__tab--active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
