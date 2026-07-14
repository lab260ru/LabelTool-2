import { useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import '../TextField/textfield.css'
import './textarea.css'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export function TextArea({ label, hint, error, id, className, rows = 3, ...rest }: TextAreaProps) {
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
      <textarea
        id={inputId}
        rows={rows}
        className="lt-field__control lt-textarea"
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
