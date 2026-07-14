import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus, IconX } from '../icons'
import './keyvaluechips.css'

/**
 * "Key-value for the whole batch" metadata: chips like `source=radio ×`,
 * adding and removing pairs.
 */
export interface KeyValuePair {
  key: string
  value: string
}

export interface KeyValueChipsProps {
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  disabled?: boolean
  className?: string
}

export function KeyValueChips({ pairs, onChange, disabled = false, className }: KeyValueChipsProps) {
  const { t } = useTranslation('common')
  const [adding, setAdding] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')

  function reset() {
    setAdding(false)
    setDraftKey('')
    setDraftValue('')
  }

  function commit() {
    const key = draftKey.trim()
    const value = draftValue.trim()
    if (!key || !value) return
    const withoutKey = pairs.filter((p) => p.key !== key)
    onChange([...withoutKey, { key, value }])
    reset()
  }

  function onDraftKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      reset()
    }
  }

  const cls = ['lt-kv', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {pairs.map((pair) => (
        <span key={pair.key} className="lt-kv__chip lt-data">
          {pair.key}={pair.value}
          {!disabled && (
            <button
              type="button"
              className="lt-kv__remove"
              onClick={() => onChange(pairs.filter((p) => p.key !== pair.key))}
              aria-label={t('kv.remove', { key: pair.key })}
            >
              <IconX size={12} />
            </button>
          )}
        </span>
      ))}

      {adding ? (
        <span className="lt-kv__form">
          <input
            className="lt-kv__input"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder={t('kv.keyPlaceholder')}
            aria-label={t('kv.keyPlaceholder')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- focus in the form the user just opened is expected
            autoFocus
          />
          <span aria-hidden="true">=</span>
          <input
            className="lt-kv__input"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder={t('kv.valuePlaceholder')}
            aria-label={t('kv.valuePlaceholder')}
          />
          <button
            type="button"
            className="lt-kv__confirm"
            onClick={commit}
            disabled={!draftKey.trim() || !draftValue.trim()}
            aria-label={t('kv.confirm')}
          >
            <IconPlus size={14} />
          </button>
          <button type="button" className="lt-kv__cancel" onClick={reset} aria-label={t('kv.cancel')}>
            <IconX size={14} />
          </button>
        </span>
      ) : (
        !disabled && (
          <button type="button" className="lt-kv__add" onClick={() => setAdding(true)}>
            <IconPlus size={13} />
            {t('kv.add')}
          </button>
        )
      )}
    </div>
  )
}
