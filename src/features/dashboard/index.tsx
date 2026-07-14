import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { AnnotatorScore, DashboardStats, Project, ZombieTask } from '../../api/types'
import {
  Banner,
  Button,
  Card,
  DataTable,
  SectionDivider,
  Select,
  Spinner,
  StatusBadge,
  TrackProgress,
} from '../../components'
import type { DataTableColumn } from '../../components'
import { IconPlus, IconUpload } from '../../components/icons'
import './i18n'
import './dashboard.css'

/**
 * Dashboard: summary cards, zombie tasks,
 * top/bottom annotators, quick actions. Data — via api only.
 */

/** "Zombie" threshold: a task taken more than N hours ago and not submitted. */
const ZOMBIE_THRESHOLD_HOURS = 24

function AnnotatorsCard({
  title,
  hint,
  items,
  muted,
}: {
  title: string
  hint: string
  items: AnnotatorScore[]
  muted?: boolean
}) {
  const { t } = useTranslation('dashboard')
  return (
    <Card title={title}>
      <p className="ltd-annot-hint lt-caption">{hint}</p>
      <ol className="ltd-annot">
        {items.map((a, i) => (
          <li key={a.user_id} className="ltd-annot__row">
            <span
              className={`ltd-annot__rank lt-data${muted ? ' ltd-annot__rank--muted' : ''}`}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="ltd-annot__who">
              <span className="ltd-annot__name">{a.fio}</span>
              <span className="ltd-annot__group">{a.group ?? t('annotators.noGroup')}</span>
            </span>
            <span className="ltd-annot__stats">
              <span className="ltd-annot__tasks lt-data">
                {t('annotators.tasks', { count: a.tasks_done })}
              </span>
              <span className="ltd-annot__agr lt-data">
                {t('annotators.agreement', { value: a.agreement_pct })}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export default function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [quickProjectId, setQuickProjectId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    Promise.all([api.dashboard.get(), api.projects.list()])
      .then(([s, ps]) => {
        if (cancelled) return
        setStats(s)
        setProjects(ps)
        setQuickProjectId((prev) => (prev !== '' ? prev : ps[0] ? String(ps[0].id) : ''))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const zombieColumns: DataTableColumn<ZombieTask>[] = [
    {
      key: 'fragment_filename',
      header: t('zombie.colFragment'),
      sortable: true,
      numeric: true,
    },
    {
      key: 'project_name',
      header: t('zombie.colProject'),
      sortable: true,
      render: (z) => <Link to={`/admin/projects/${z.project_id}`}>{z.project_name}</Link>,
    },
    {
      key: 'task_type',
      header: t('zombie.colType'),
      align: 'center',
      sortable: true,
      render: (z) => tc(`taskTypes.${z.task_type}`),
    },
    { key: 'taken_by', header: t('zombie.colTakenBy'), sortable: true },
    {
      key: 'hours_stuck',
      header: t('zombie.colHours'),
      sortable: true,
      align: 'center',
      width: '110px',
      sortValue: (z) => z.hours_stuck,
      render: (z) => <StatusBadge kind="warn" label={t('zombie.hours', { hours: z.hours_stuck })} />,
    },
  ]

  return (
    <section className="lt-page">
      <header>
        <h1>{t('title')}</h1>
        <SectionDivider className="ltd-divider" />
      </header>

      {failed && (
        <Banner
          kind="warning"
          className="ltd-banner"
          action={
            <Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              {tc('actions.retry')}
            </Button>
          }
        >
          {t('loadError')}
        </Banner>
      )}

      {loading && (
        <div className="ltd-loading">
          <Spinner size={36} label={tc('loading')} />
        </div>
      )}

      {!loading && stats && (
        <>
          {/* --- Summary: projects / users / fragments / % labeled -------------- */}
          <div className="ltd-stats">
            <Card className="ltd-stat">
              <span className="ltd-stat__value lt-data">{stats.projects_total}</span>
              <span className="ltd-stat__label">{t('summary.projects')}</span>
            </Card>
            <Card className="ltd-stat">
              <span className="ltd-stat__value lt-data">{stats.users_total}</span>
              <span className="ltd-stat__label">{t('summary.users')}</span>
            </Card>
            <Card className="ltd-stat">
              <span className="ltd-stat__value lt-data">{stats.fragments_total}</span>
              <span className="ltd-stat__label">
                {t('summary.fragments')} · {t('summary.inProgress', { value: stats.fragments_in_progress })}
              </span>
            </Card>
            <Card className="ltd-stat ltd-stat--progress">
              <span className="ltd-stat__label">{t('summary.labeled')}</span>
              <TrackProgress value={stats.labeled_pct} label={t('summary.labeled')} />
              <span className="ltd-stat__sub lt-caption lt-data">
                {t('summary.labeledOf', {
                  labeled: stats.fragments_labeled,
                  total: stats.fragments_total,
                })}
              </span>
            </Card>
          </div>

          {/* --- Zombie tasks + quick actions ---------------------------------- */}
          <div className="ltd-main">
            <Card title={t('zombie.title')}>
              <p className="ltd-zombie-hint lt-caption">
                {t('zombie.hint', { hours: ZOMBIE_THRESHOLD_HOURS })}
              </p>
              <DataTable
                columns={zombieColumns}
                rows={stats.zombie_tasks}
                rowKey={(z) => z.id}
                emptyTitle={t('zombie.empty')}
                emptyDescription={t('zombie.emptyHint')}
              />
            </Card>

            <Card title={t('quick.title')}>
              <div className="ltd-quick__body">
                <Button
                  leftIcon={<IconPlus size={16} />}
                  onClick={() => navigate('/admin/projects?new=1')}
                >
                  {t('quick.newProject')}
                </Button>
                <Select
                  label={t('quick.project')}
                  value={quickProjectId}
                  onChange={(e) => setQuickProjectId(e.target.value)}
                  disabled={projects.length === 0}
                  hint={projects.length === 0 ? t('quick.noProjects') : undefined}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <div className="ltd-quick__row">
                  <Button
                    variant="secondary"
                    leftIcon={<IconUpload size={16} />}
                    disabled={quickProjectId === ''}
                    onClick={() => navigate(`/admin/projects/${quickProjectId}/upload`)}
                  >
                    {t('quick.import')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={quickProjectId === ''}
                    onClick={() => navigate(`/admin/projects/${quickProjectId}/export`)}
                  >
                    {t('quick.export')}
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* --- Top 3 and bottom 3 annotators ---------------------------------- */}
          <div className="ltd-annotators">
            <AnnotatorsCard
              title={t('annotators.top')}
              hint={t('annotators.topHint')}
              items={stats.top_annotators}
            />
            <AnnotatorsCard
              title={t('annotators.outsiders')}
              hint={t('annotators.outsidersHint')}
              items={stats.outsider_annotators}
              muted
            />
          </div>
        </>
      )}
    </section>
  )
}
