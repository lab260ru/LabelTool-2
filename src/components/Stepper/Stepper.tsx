import { useTranslation } from 'react-i18next'
import { IconCheck } from '../icons'
import './stepper.css'

/**
 * Horizontal stepper (upload wizard): states
 * completed (✓) / active / future.
 */
export interface StepperProps {
  steps: string[]
  /** Index of the active step (0-based). */
  current: number
  /** Click on a COMPLETED step (going back); future steps are not clickable. */
  onStepClick?: (index: number) => void
  className?: string
}

export function Stepper({ steps, current, onStepClick, className }: StepperProps) {
  const { t } = useTranslation('common')
  const cls = ['lt-stepper', className ?? ''].filter(Boolean).join(' ')
  return (
    <ol className={cls} aria-label={t('stepper.label')}>
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'future'
        const clickable = state === 'done' && onStepClick
        const content = (
          <>
            <span className="lt-step__dot" aria-hidden="true">
              {state === 'done' ? <IconCheck size={13} /> : i + 1}
            </span>
            <span className="lt-step__label">{label}</span>
          </>
        )
        return (
          <li
            key={label}
            className={`lt-step lt-step--${state}`}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            {clickable ? (
              <button
                type="button"
                className="lt-step__btn"
                onClick={() => onStepClick(i)}
                aria-label={`${label} — ${t('stepper.done')}`}
              >
                {content}
              </button>
            ) : (
              <span className="lt-step__btn lt-step__btn--static">{content}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
