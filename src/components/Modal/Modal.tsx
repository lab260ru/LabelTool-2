import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconX } from '../icons'
import './modal.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Buttons at the bottom. */
  footer?: ReactNode
  width?: number
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, children, footer, width = 480, className }: ModalProps) {
  const { t } = useTranslation('common')
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // Focus inside on open, return focus on close; scroll-lock
  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      previousFocus.current?.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    // Simple focus trap
    if (e.key === 'Tab' && panelRef.current) {
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function onOverlayMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className="lt-modal-overlay" onMouseDown={onOverlayMouseDown}>
      <div
        ref={panelRef}
        className={['lt-modal', className ?? ''].filter(Boolean).join(' ')}
        style={{ width, maxWidth: 'calc(100vw - 32px)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="lt-modal__header">
          {title && (
            <h2 id={titleId} className="lt-modal__title">
              {title}
            </h2>
          )}
          <button type="button" className="lt-modal__close" onClick={onClose} aria-label={t('modal.close')}>
            <IconX size={16} />
          </button>
        </header>
        <div className="lt-modal__body">{children}</div>
        {footer && <footer className="lt-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
