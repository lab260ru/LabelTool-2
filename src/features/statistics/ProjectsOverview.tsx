/**
 * The "Agreement metrics" and "Project progress" blocks.
 * Data — via src/api/client (projectsApi.progress / .agreement).
 */
import { useTranslation } from 'react-i18next'
import { Banner, Button, Card, Spinner, TrackProgress } from '../../components'
import type { AgreementStats, Project, ProjectProgress } from '../../api/types'

export interface ProjectsOverviewProps {
  projects: Project[]
  /** project_id → progress. */
  progress: Record<number, ProjectProgress>
  /** project_id → agreement metrics. */
  agreement: Record<number, AgreementStats>
  loading: boolean
  error: boolean
  onRetry: () => void
  /** Percentage format with one decimal (current language locale). */
  formatPct: (value: number) => string
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function ProjectsOverview({
  projects,
  progress,
  agreement,
  loading,
  error,
  onRetry,
  formatPct,
}: ProjectsOverviewProps) {
  const { t } = useTranslation('statistics')
  const { t: tc } = useTranslation('common')

  if (error) {
    return (
      <Banner
        kind="warning"
        className="st-blocks-error"
        action={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {tc('actions.retry')}
          </Button>
        }
      >
        {t('blocks.loadError')}
      </Banner>
    )
  }

  const avgAgreement = average(
    projects.map((p) => agreement[p.id]?.avg_agreement_pct).filter((v): v is number => v !== undefined),
  )
  const avgConsensus = average(
    projects.map((p) => progress[p.id]?.progress_pct).filter((v): v is number => v !== undefined),
  )

  return (
    <div className="st-grid">
      {/* Summary agreement metrics across projects */}
      <Card title={t('agreement.heading')}>
        {loading ? (
          <div className="st-card-loading">
            <Spinner size={24} label={tc('loading')} />
          </div>
        ) : (
          <>
            <dl className="st-stats">
              <div className="st-stats__item">
                <dt className="st-stats__label lt-caption">{t('agreement.avgAgreement')}</dt>
                <dd className="st-stats__value lt-data">{formatPct(avgAgreement)}</dd>
              </div>
              <div className="st-stats__item">
                <dt className="st-stats__label lt-caption">{t('agreement.avgConsensus')}</dt>
                <dd className="st-stats__value lt-data">{formatPct(avgConsensus)}</dd>
              </div>
            </dl>
            <table className="st-mini-table">
              <thead>
                <tr>
                  <th scope="col">{t('agreement.project')}</th>
                  <th scope="col" className="st-mini-table__num">
                    {t('agreement.colAgreement')}
                  </th>
                  <th scope="col" className="st-mini-table__num">
                    {t('agreement.colConsensus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const agr = agreement[p.id]?.avg_agreement_pct
                  const cov = progress[p.id]?.progress_pct
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="st-mini-table__num lt-data">
                        {agr === undefined ? '—' : formatPct(agr)}
                      </td>
                      <td className="st-mini-table__num lt-data">
                        {cov === undefined ? '—' : formatPct(cov)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </Card>

      {/* Project progress: TrackProgress (the «track» motif) */}
      <Card title={t('progress.heading')}>
        {loading ? (
          <div className="st-card-loading">
            <Spinner size={24} label={tc('loading')} />
          </div>
        ) : (
          <ul className="st-progress-list">
            {projects.map((p) => {
              const pr = progress[p.id]
              return (
                <li key={p.id} className="st-progress-list__item">
                  <div className="st-progress-list__head">
                    <span className="st-progress-list__name">{p.name}</span>
                    {pr && (
                      <span className="lt-caption st-progress-list__count lt-data">
                        {t('progress.fragments', {
                          labeled: pr.fragments_labeled,
                          total: pr.fragments_total,
                        })}
                      </span>
                    )}
                  </div>
                  <TrackProgress
                    value={pr?.progress_pct ?? 0}
                    segments={8}
                    label={t('progress.aria', { name: p.name })}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
