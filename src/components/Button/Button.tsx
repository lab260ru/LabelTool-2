import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from '../Spinner/Spinner'
import './button.css'

/**
 * Buttons:
 *  - primary — violet fill, white text ("New project");
 *  - secondary — outline ("Import audio");
 *  - danger — light coral fill, coral text ("Delete").
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'md' | 'sm'
  loading?: boolean
  fullWidth?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'lt-btn',
    `lt-btn--${variant}`,
    `lt-btn--${size}`,
    fullWidth ? 'lt-btn--full' : '',
    loading ? 'lt-btn--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} inline /> : leftIcon}
      <span className="lt-btn__label">{children}</span>
      {rightIcon}
    </button>
  )
}
