/**
 * Step 5 — summary: green check, "Uploaded 112 of 118",
 * "<project> · <type> · 6 files failed", error block with reasons +
 * coral "Retry failed only", "Download error rows" (client-side
 * CSV), "↑ Upload more" / "To project".
 */
import { useTranslation } from 'react-i18next'
import { Button, Card } from '../../components'
import { IconCheck } from '../../components/icons'
import type { TaskType } from '../../api/types'
import type { WizardSummary } from './lib'
import { downloadTextFile, failedRowsCsv } from './lib'

export interface StepSummaryProps {
  summary: WizardSummary
  projectName: string
  taskType: TaskType
  onRetryFailed: () => void
  onUploadMore: () => void
  onToProject: () => void
}

export function StepSummary(props: StepSummaryProps) {
  const { t } = useTranslation('upload')
  const { t: tc } = useTranslation('common')
  const { summary } = props
  const failedCount = summary.failed.length

  const subtitle = [
    props.projectName,
    tc(`taskTypes.${props.taskType}`),
    failedCount > 0 ? t('step5.errFiles', { count: failedCount }) : t('step5.noErrors'),
  ].join(' · ')

  const reasonLabel = (row: WizardSummary['failed'][number]): string =>
    row.reason === 'network_failure' && row.failedAtPct !== null
      ? t('step5.reason.network_failure_pct', { pct: row.failedAtPct })
      : t(`step5.reason.${row.reason}`)

  return (
    <Card padding="lg" className="lt-upload__panel lt-upload__summary">
      <div className="lt-upload__s-head">
        <span className="lt-upload__s-check" role="img" aria-label={t('step5.successAria')}>
          <IconCheck size={22} />
        </span>
        <div>
          <h2 className="lt-upload__subtitle">
            {t('step5.title', { uploaded: summary.uploaded, total: summary.total })}
          </h2>
          <p className="lt-caption lt-upload__note">{subtitle}</p>
        </div>
      </div>

      {failedCount > 0 && (
        <div className="lt-upload__errbox">
          <div className="lt-upload__errbox-head">
            <span className="lt-upload__errbox-title">
              {t('step5.errorsTitle', { files: t('step5.files', { count: failedCount }) })}
            </span>
            <span className="lt-upload__spacer" />
            {summary.source === 'files' && (
              <Button variant="danger" size="sm" onClick={props.onRetryFailed}>
                {t('step5.retryFailed')}
              </Button>
            )}
          </div>
          <ul className="lt-upload__err-rows" aria-label={t('step5.errorList')}>
            {summary.failed.map((row, i) => (
              <li key={`${row.filename}-${i}`} className="lt-upload__err-row">
                <span className="lt-data lt-upload__err-name" title={row.filename}>
                  {row.filename}
                </span>
                <span className="lt-caption lt-upload__err-why">{reasonLabel(row)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="lt-upload__actions">
        <Button variant="secondary" onClick={props.onUploadMore}>
          {t('step5.uploadMore')}
        </Button>
        {failedCount > 0 && (
          <Button
            variant="secondary"
            onClick={() =>
              downloadTextFile('upload-errors.csv', failedRowsCsv(summary.failed), 'text/csv;charset=utf-8')
            }
          >
            {t('step5.downloadErrors')}
          </Button>
        )}
        <Button onClick={props.onToProject}>{t('step5.toProject')}</Button>
      </div>
    </Card>
  )
}
