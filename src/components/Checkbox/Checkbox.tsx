import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { IconCheck } from '../icons'
import './checkbox.css'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  hint?: string
}

export function Checkbox({ label, hint, id, className, ...rest }: CheckboxProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const cls = ['lt-checkbox', className ?? ''].filter(Boolean).join(' ')
  return (
    <label className={cls} htmlFor={inputId}>
      <input id={inputId} type="checkbox" className="lt-checkbox__input" {...rest} />
      <span className="lt-checkbox__box" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      <span className="lt-checkbox__text">
        {label}
        {hint && <span className="lt-checkbox__hint">{hint}</span>}
      </span>
    </label>
  )
}
