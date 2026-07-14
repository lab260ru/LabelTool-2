import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LabelClass } from '../../api/types'
import { Button, TextField } from '../../components'
import { LabelChip } from './LabelChip'
import { PRESET_CLASSES, hasLabelName } from './lib'

/**
 * label_list editor: a list of "class name + color" pairs.
 * Presets (speech/music/noise/silence) are added in one click,
 * a custom class — name + color picker.
 */
export interface LabelListEditorProps {
  value: LabelClass[]
  onChange: (next: LabelClass[]) => void
  /** Hint above the editor (per task type); defaults to labels.hint. */
  hint?: string
}

export function LabelListEditor({ value, onChange, hint }: LabelListEditorProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const colorId = useId()

  const [name, setName] = useState('')
  const [color, setColor] = useState('#6D5AE6')
  const [error, setError] = useState<string | null>(null)

  function addCustom() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (hasLabelName(value, trimmed)) {
      setError(t('labels.duplicate'))
      return
    }
    onChange([...value, { name: trimmed, color }])
    setName('')
    setError(null)
  }

  function addPreset(presetKey: string, presetColor: string) {
    const label = tc(`classes.${presetKey}`)
    if (hasLabelName(value, label)) return
    onChange([...value, { name: label, color: presetColor }])
  }

  return (
    <div className="ltp-labels">
      <p className="ltp-hint lt-caption">{hint ?? t('labels.hint')}</p>

      <div className="ltp-labels__chips">
        {value.length === 0 && <span className="ltp-muted lt-caption">{t('labels.empty')}</span>}
        {value.map((l) => (
          <LabelChip
            key={l.name}
            label={l}
            onRemove={() => onChange(value.filter((x) => x !== l))}
          />
        ))}
      </div>

      <div className="ltp-labels__presets" role="group" aria-label={t('labels.presets')}>
        <span className="ltp-muted lt-caption">{t('labels.presets')}</span>
        {PRESET_CLASSES.map((p) => {
          const label = tc(`classes.${p.key}`)
          return (
            <button
              key={p.key}
              type="button"
              className="ltp-preset"
              disabled={hasLabelName(value, label)}
              onClick={() => addPreset(p.key, p.color)}
              aria-label={t('labels.addPreset', { name: label })}
            >
              <span className={`ltp-preset__dot ltp-preset__dot--${p.key}`} aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      <div className="ltp-labels__add">
        <TextField
          className="ltp-labels__name"
          label={t('labels.name')}
          placeholder={t('labels.namePlaceholder')}
          value={name}
          error={error ?? undefined}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <div className="ltp-color">
          <label className="ltp-color__label" htmlFor={colorId}>
            {t('labels.color')}
          </label>
          <input
            id={colorId}
            type="color"
            className="ltp-color__input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={addCustom} disabled={name.trim() === ''}>
          {tc('actions.add')}
        </Button>
      </div>
    </div>
  )
}
