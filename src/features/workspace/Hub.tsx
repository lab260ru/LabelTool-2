/**
 * Annotator hub /label "Task work":
 * "Take a task" (/task/random with no params — no filters in the API yet),
 * project instruction and the submission history.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { Project, TaskHistoryItem } from '../../api/types'
import {
  Banner,
  Button,
  Card,
  DataTable,
  SectionDivider,
  Select,
  Spinner,
  StatusBadge,
} from '../../components'
import type { DataTableColumn, StatusBadgeProps } from '../../components'
import { apiErrorKey } from './lib'

const STATUS_KIND: Record<TaskHistoryItem['status'], StatusBadgeProps['kind']> = {
  accepted: 'ok',
  pending: 'progress',
  consensus: 'neutral',
}

type Remote<T> =
  | { state: 'loading' }
  | { state: 'error'; key: string }
  | { state: 'ready'; data: T }

export function Hub() {
  const { t, i18n } = useTranslation('workspace')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  const [projects, setProjects] = useState<Remote<Project[]>>({ state: 'loading' })
  const [projectId, setProjectId] = useState<number | null>(null)
  const [instruction, setInstruction] = useState<Remote<string>>({ state: 'loading' })
  const [history, setHistory] = useState<Remote<TaskHistoryItem[]>>({ state: 'loading' })

  const loadProjects = useCallback(async () => {
    setProjects({ state: 'loading' })
    try {
      const list = await api.projects.list()
      setProjects({ state: 'ready', data: list })
      setProjectId((prev) => prev ?? list[0]?.id ?? null)
    } catch (e) {
      setProjects({ state: 'error', key: apiErrorKey(e) })
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistory({ state: 'loading' })
    try {
      const page = await api.tasks.history({ limit: 50 })
      setHistory({ state: 'ready', data: page.items })
    } catch (e) {
      setHistory({ state: 'error', key: apiErrorKey(e) })
    }
  }, [])

  useEffect(() => {
    void loadProjects()
    void loadHistory()
  }, [loadProjects, loadHistory])

  // Public read of the project instruction by the annotator
  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    setInstruction({ state: 'loading' })
    api.projects
      .getInstruction(projectId)
      .then((res) => {
        if (!cancelled) setInstruction({ state: 'ready', data: res.instruction })
      })
      .catch((e: unknown) => {
        if (!cancelled) setInstruction({ state: 'error', key: apiErrorKey(e) })
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const dateFormat = new Intl.DateTimeFormat(i18n.language.startsWith('ru') ? 'ru-RU' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const columns: DataTableColumn<TaskHistoryItem>[] = [
    {
      key: 'submitted_at',
      header: t('hub.history.date'),
      align: 'center',
      sortable: true,
      numeric: true,
      width: '140px',
      render: (row) => dateFormat.format(new Date(row.submitted_at)),
      sortValue: (row) => row.submitted_at,
    },
    {
      key: 'project_name',
      header: t('hub.history.project'),
      sortable: true,
    },
    {
      key: 'task_type',
      header: t('hub.history.type'),
      align: 'center',
      sortable: true,
      render: (row) => tc(`taskTypes.${row.task_type}`),
      sortValue: (row) => row.task_type,
    },
    {
      key: 'fragment_filename',
      header: t('hub.history.fragment'),
      numeric: true,
    },
    {
      key: 'status',
      header: t('hub.history.status'),
      align: 'center',
      sortable: true,
      width: '170px',
      render: (row) => (
        <StatusBadge kind={STATUS_KIND[row.status]} label={t(`hub.status.${row.status}`)} />
      ),
      sortValue: (row) => row.status,
    },
  ]

  return (
    <section className="lt-page ws-page">
      <header>
        <h1>{tc('sections.workspace')}</h1>
        <SectionDivider />
      </header>

      <div className="ws-hub-grid">
        <Card title={t('hub.take.title')} className="ws-hub-take">
          <p className="ws-hub-take__text">{t('hub.take.description')}</p>
          <Button onClick={() => void navigate('/label/task')}>{t('hub.take.button')}</Button>
        </Card>

        <Card
          title={t('hub.instruction.title')}
          className="ws-hub-instruction"
          actions={
            projects.state === 'ready' && projects.data.length > 0 ? (
              <Select
                aria-label={t('hub.instruction.project')}
                value={projectId ?? ''}
                onChange={(e) => setProjectId(Number(e.target.value))}
              >
                {projects.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : undefined
          }
        >
          {projects.state === 'loading' && <Spinner size={22} label={tc('loading')} />}
          {projects.state === 'error' && (
            <Banner
              kind="warning"
              action={
                <Button size="sm" variant="secondary" onClick={() => void loadProjects()}>
                  {tc('actions.retry')}
                </Button>
              }
            >
              {t('errors.projects')} {t(projects.key)}
            </Banner>
          )}
          {projects.state === 'ready' && (
            <>
              {instruction.state === 'loading' && <Spinner size={22} label={tc('loading')} />}
              {instruction.state === 'error' && (
                <Banner kind="warning">
                  {t('errors.instruction')} {t(instruction.key)}
                </Banner>
              )}
              {instruction.state === 'ready' && (
                <div className="ws-instruction">
                  {instruction.data || (
                    <span className="ws-muted">{t('hub.instruction.empty')}</span>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title={t('hub.history.title')} className="ws-hub-history">
        {history.state === 'error' ? (
          <Banner
            kind="warning"
            action={
              <Button size="sm" variant="secondary" onClick={() => void loadHistory()}>
                {tc('actions.retry')}
              </Button>
            }
          >
            {t('errors.history')} {t(history.key)}
          </Banner>
        ) : (
          <DataTable<TaskHistoryItem>
            columns={columns}
            rows={history.state === 'ready' ? history.data : []}
            rowKey={(row) => row.task_id}
            loading={history.state === 'loading'}
            pageSize={8}
            emptyTitle={t('hub.history.empty')}
            emptyDescription={t('hub.history.emptyHint')}
          />
        )}
      </Card>
    </section>
  )
}
