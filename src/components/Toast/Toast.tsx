import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconInfo, IconWarning, IconX } from '../icons'
import './toast.css'

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

export interface ToastOptions {
  message: string
  title?: string
  kind?: ToastKind
  /** ms until auto-close; 0 — do not close automatically. */
  duration?: number
}

interface ToastItem extends Required<Omit<ToastOptions, 'title'>> {
  id: number
  title?: string
}

interface ToastContextValue {
  toast: (options: ToastOptions | string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast() must be used within a <ToastProvider>')
  return ctx
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const { t } = useTranslation('common')

  useEffect(() => {
    if (item.duration <= 0) return
    const timer = window.setTimeout(() => onClose(item.id), item.duration)
    return () => window.clearTimeout(timer)
  }, [item, onClose])

  const Icon = item.kind === 'ok' ? IconCheck : item.kind === 'info' ? IconInfo : IconWarning
  return (
    <div className={`lt-toast lt-toast--${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} className="lt-toast__icon" />
      <div className="lt-toast__body">
        {item.title && <p className="lt-toast__title">{item.title}</p>}
        <p className="lt-toast__message">{item.message}</p>
      </div>
      <button
        type="button"
        className="lt-toast__close"
        onClick={() => onClose(item.id)}
        aria-label={t('toast.close')}
      >
        <IconX size={14} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const close = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions | string) => {
    const opts: ToastOptions = typeof options === 'string' ? { message: options } : options
    const item: ToastItem = {
      id: nextId.current++,
      message: opts.message,
      title: opts.title,
      kind: opts.kind ?? 'info',
      duration: opts.duration ?? (opts.kind === 'error' ? 6000 : 4000),
    }
    setItems((list) => [...list.slice(-4), item]) // at most 5 at a time
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="lt-toaster" aria-live="polite">
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onClose={close} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
