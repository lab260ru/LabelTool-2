import { useTranslation } from 'react-i18next'
import { Button, TextField } from '../../components'
import { IconX } from '../../components/icons'
import type { MosScaleDraft } from './lib'
import { MAX_MOS_SCALES, MIN_MOS_SCALES, MOS_LABEL_KEYS, newMosScaleDraft } from './lib'

/**
 * Editor of a MOS project's customizable scales (the "Customizable MOS scales"
 * contract): the scale itself is always 1–5; the scale name and point labels are
 * configurable. A list of 1..5 scales: name required and unique; point labels are
 * a collapsible <details> block, placeholders are localized defaults (an empty
 * label = default). Validation is built into the form's shared "why the button is
 * disabled" mechanism (mosScaleDraftsProblem in ProjectFormModal).
 */
export interface MosScalesEditorProps {
  value: MosScaleDraft[]
  onChange: (next: MosScaleDraft[]) => void
  /** Server error (409 project_has_results) — shown below the list. */
  error: string | null
}

export function MosScalesEditor({ value, onChange, error }: MosScalesEditorProps) {
  const { t } = useTranslation('projects')

  const duplicate = (draft: MosScaleDraft): boolean => {
    const needle = draft.name.trim().toLowerCase()
    if (needle === '') return false
    return value.some((d) => d.id !== draft.id && d.name.trim().toLowerCase() === needle)
  }

  function patch(id: number, change: Partial<MosScaleDraft>) {
    onChange(value.map((d) => (d.id === id ? { ...d, ...change } : d)))
  }

  return (
    <div className="ltp-scales">
      <p className="ltp-hint lt-caption">{t('mosScales.hint')}</p>

      <ul className="ltp-scales__list" aria-label={t('mosScales.title')}>
        {value.map((draft, i) => (
          <li key={draft.id} className="ltp-scale">
            <div className="ltp-scale__row">
              <TextField
                className="ltp-scale__name"
                label={t('mosScales.name', { n: i + 1 })}
                placeholder={t('mosScales.namePlaceholder')}
                value={draft.name}
                error={duplicate(draft) ? t('mosScales.duplicate') : undefined}
                onChange={(e) => patch(draft.id, { name: e.target.value })}
              />
              <button
                type="button"
                className="ltp-rowbtn ltp-rowbtn--danger ltp-scale__remove"
                aria-label={t('mosScales.remove', { n: i + 1 })}
                disabled={value.length <= MIN_MOS_SCALES}
                onClick={() => onChange(value.filter((d) => d.id !== draft.id))}
              >
                <IconX size={14} />
              </button>
            </div>
            <details className="ltp-scale__labels">
              <summary className="lt-caption">{t('mosScales.labelsToggle')}</summary>
              <div className="ltp-scale__points">
                {MOS_LABEL_KEYS.map((k) => (
                  <TextField
                    key={k}
                    label={t('mosScales.pointLabel', { n: k })}
                    placeholder={t(`mosScales.default.${k}`)}
                    value={draft.labels[k]}
                    onChange={(e) =>
                      patch(draft.id, { labels: { ...draft.labels, [k]: e.target.value } })
                    }
                  />
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>

      <div className="ltp-scales__foot">
        <Button
          variant="secondary"
          size="sm"
          disabled={value.length >= MAX_MOS_SCALES}
          onClick={() => onChange([...value, newMosScaleDraft()])}
        >
          {t('mosScales.add')}
        </Button>
        {/* Contract warning: after the first submissions scales cannot be changed (409) */}
        <span className="lt-caption ltp-scales__warn" role="note">
          {t('mosScales.lockWarn')}
        </span>
      </div>

      {error !== null && (
        <p className="lt-caption ltp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
