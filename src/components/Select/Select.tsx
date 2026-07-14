import { useId } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { IconChevronDown } from '../icons'
import '../TextField/textfield.css'
import './select.css'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  /** <option> elements. */
  children: ReactNode
}

export function Select({ label, hint, error, id, className, children, ...rest }: SelectProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const descId = `${inputId}-desc`
  const cls = ['lt-field', error ? 'lt-field--error' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {label && (
        <label className="lt-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <span className="lt-select">
        <select
          id={inputId}
          className="lt-field__control lt-select__control"
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? descId : undefined}
          {...rest}
        >
          {children}
        </select>
        <IconChevronDown size={16} className="lt-select__chevron" />
      </span>
      {(error || hint) && (
        <p id={descId} className={`lt-field__desc${error ? ' lt-field__desc--error' : ''}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
