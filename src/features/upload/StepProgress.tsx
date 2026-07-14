/**
 * Step 4 — upload: "Uploading… 74 / 118 · 62%" + TrackProgress,
 * "4 parallel uploads · errors do not stop the batch", danger button
 * "Cancel the rest", per-file statuses: Done ✓ / error ✗ + "Retry" /
 * NN% (spinner) / Queued (clock).
 */
import { useTranslation } from 'react-i18next'
import { Button, Card, Spinner, TrackProgress } from '../../components'
import { IconCheck, IconX } from '../../components/icons'
import type { LocalFile, RunState } from './lib'
import { IconClock } from './local-icons'

export interface StepProgressProps {
  items: LocalFile[]
  run: Record<string, RunState>
  uploading: boolean
  cancelling: boolean
  onCancel: () => void
  onRetryFile: (clientId: string) => void
}

export function StepProgress(props: StepProgressProps) {
  const { t } = useTranslation('upload')

  const states = props.items.map((i) => props.run[i.clientId])
  const done = states.filter((s) => s?.status === 'done').length
  const total = props.items.length
  const overallPct =
    total === 0
      ? 0
      : Math.round(
          states.reduce((sum, s) => sum + (s?.status === 'done' ? 100 : (s?.progress ?? 0)), 0) /
            total,
        )

  return (
    <Card padding="lg" className="lt-upload__panel">
      <div className="lt-upload__p-head">
        <div className="lt-upload__p-main">
          <div className="lt-upload__p-title" role="status">
            <h2 className="lt-upload__subtitle">{t('step4.title')}</h2>
            <span className="lt-data lt-upload__p-counter">
              {t('step4.counter', { done, total, pct: overallPct })}
            </span>
          </div>
          <TrackProgress value={overallPct} label={t('step4.progressLabel')} />
          <span className="lt-caption lt-upload__note">{t('step4.note')}</span>
        </div>
        <Button
          variant="danger"
          disabled={!props.uploading || props.cancelling}
          onClick={props.onCancel}
        >
          {t('step4.cancel')}
        </Button>
      </div>

      <ul className="lt-upload__p-rows" aria-label={t('step4.listLabel')}>
        {props.items.map((item) => {
          const state = props.run[item.clientId]
          if (!state) return null
          return (
            <li key={item.clientId} className={`lt-upload__p-row lt-upload__p-row--${state.status}`}>
              <span className="lt-upload__p-ico" aria-hidden="true">
                {state.status === 'done' && <IconCheck size={14} />}
                {state.status === 'error' && <IconX size={14} />}
                {state.status === 'uploading' && <Spinner size={14} inline />}
                {state.status === 'queued' && <IconClock size={14} />}
              </span>
              <span className="lt-data lt-upload__p-name" title={item.filename}>
                {item.filename}
              </span>
              <span
                className="lt-upload__p-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.progress)}
                aria-label={t('step4.fileProgressLabel', { name: item.filename })}
              >
                <span className="lt-upload__p-fill" style={{ width: `${state.progress}%` }} />
              </span>
              <span className="lt-upload__p-status">
                {state.status === 'done' && (
                  <span className="lt-upload__p-st-done">{t('step4.status.done')}</span>
                )}
                {state.status === 'queued' && (
                  <span className="lt-upload__p-st-queued">{t('step4.status.queued')}</span>
                )}
                {state.status === 'uploading' && (
                  <span className="lt-data">{Math.round(state.progress)}%</span>
                )}
                {state.status === 'error' && (
                  <>
                    <span className="lt-upload__p-st-error">
                      {t(`step4.status.${state.errorReason ?? 'network_failure'}`)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="lt-upload__p-retry"
                      aria-label={t('step4.retryAria', { name: item.filename })}
                      onClick={() => props.onRetryFile(item.clientId)}
                    >
                      {t('step4.retry')}
                    </Button>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
