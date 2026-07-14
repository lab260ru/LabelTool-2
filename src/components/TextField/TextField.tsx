import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import './textfield.css'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
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
      <input
        id={inputId}
        className="lt-field__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? descId : undefined}
        {...rest}
      />
      {(error || hint) && (
        <p id={descId} className={`lt-field__desc${error ? ' lt-field__desc--error' : ''}`}>
          {error || hint}
        </p>
      )}
    </div>
  )
}
