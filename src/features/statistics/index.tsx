/**
 * The Statistics screen (/admin/statistics):
 *  - labelers table: full name, group, tasks submitted, agreement/consensus, speed;
 *    student/group filters (Select) + search, pagination, client-side CSV export;
 *  - agreement metrics block and project progress (via src/api/client);
 *  - charts in pure SVG/CSS (theme tokens, no chart libraries).
 */
import './i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type {
  AgreementStats,
  Project,
  ProjectProgress,
  StatisticsRow,
  TaskType,
} from '../../api/types'
import {
  Banner,
  Button,
  Card,
  DataTable,
  SectionDivider,
  Select,
  Spinner,
  TextField,
  useToast,
} from '../../components'
import type { DataTableColumn } from '../../components'
import { TaskTypeDistribution, WeeklyBarChart } from './charts'
import { weeklyLabels, weeklySeries } from './weekly'
import { ProjectsOverview } from './ProjectsOverview'
import { buildCsv, downloadCsv } from './csv'
import './statistics.css'

/** All rows fit in a single server page. */
const FETCH_LIMIT = 500
const TABLE_PAGE_SIZE = 10
const LOW_AGREEMENT_PCT = 70

export default function StatisticsPage() {
  const { t, i18n } = useTranslation('statistics')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'ru-RU'
  const intFmt = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const pctFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  )
  const formatPct = useCallback((value: number) => `${pctFmt.format(value)}%`, [pctFmt])

  /* ── Filters: search + group — on the server, student — over the selection ── */

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [studentId, setStudentId] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  /* ── Labelers table ────────────────────────────────────────────────── */

  const [rows, setRows] = useState<StatisticsRow[]>([])
  /** Full (unfiltered) selection — the source of options for the Select filters. */
  const [baseline, setBaseline] = useState<StatisticsRow[] | null>(null)
  const [rowsLoading, setRowsLoading] = useState(true)
  const [rowsError, setRowsError] = useState(false)
  const [rowsReload, setRowsReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setRowsLoading(true)
    setRowsError(false)
    api.statistics
      .list({ search: search || undefined, group: group || undefined, limit: FETCH_LIMIT })
      .then((page) => {
        if (cancelled) return
        setRows(page.items)
        if (!search && !group) setBaseline(page.items)
      })
      .catch(() => {
        if (!cancelled) setRowsError(true)
      })
      .finally(() => {
        if (!cancelled) setRowsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [search, group, rowsReload])

  const visibleRows = useMemo(
    () => (studentId ? rows.filter((r) => String(r.user_id) === studentId) : rows),
    [rows, studentId],
  )

  const optionRows = baseline ?? rows
  const groups = useMemo(
    () =>
      Array.from(
        new Set(optionRows.map((r) => r.group).filter((g): g is string => g !== null)),
      ).sort((a, b) => a.localeCompare(b)),
    [optionRows],
  )
  const studentOptions = useMemo(() => {
    const list = group ? optionRows.filter((r) => r.group === group) : optionRows
    return [...list].sort((a, b) => a.fio.localeCompare(b.fio))
  }, [optionRows, group])

  const hasFilters = searchInput !== '' || group !== '' || studentId !== ''

  function changeGroup(next: string) {
    setGroup(next)
    if (studentId && next) {
      const selected = optionRows.find((r) => String(r.user_id) === studentId)
      if (selected?.group !== next) setStudentId('')
    }
  }

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setGroup('')
    setStudentId('')
  }

  /* ── Project blocks: progress + agreement + type distribution ─── */

  const [projects, setProjects] = useState<Project[]>([])
  const [progressMap, setProgressMap] = useState<Record<number, ProjectProgress>>({})
  const [agreementMap, setAgreementMap] = useState<Record<number, AgreementStats>>({})
  const [typeCounts, setTypeCounts] = useState<Partial<Record<TaskType, number>>>({})
  const [blocksLoading, setBlocksLoading] = useState(true)
  const [blocksError, setBlocksError] = useState(false)
  const [blocksReload, setBlocksReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setBlocksLoading(true)
    setBlocksError(false)
    ;(async () => {
      const list = await api.projects.list()
      const [progresses, agreements, fragmentPages] = await Promise.all([
        Promise.all(list.map((p) => api.projects.progress(p.id))),
        Promise.all(list.map((p) => api.projects.agreement(p.id))),
        Promise.all(list.map((p) => api.fragments.list(p.id, { limit: FETCH_LIMIT }))),
      ])
      if (cancelled) return
      setProjects(list)
      setProgressMap(Object.fromEntries(progresses.map((pr) => [pr.project_id, pr])))
      setAgreementMap(Object.fromEntries(agreements.map((a) => [a.project_id, a])))
      const counts: Partial<Record<TaskType, number>> = {}
      for (const page of fragmentPages) {
        for (const fragment of page.items) {
          counts[fragment.task_type] = (counts[fragment.task_type] ?? 0) + 1
        }
      }
      setTypeCounts(counts)
    })()
      .catch(() => {
        if (!cancelled) setBlocksError(true)
      })
      .finally(() => {
        if (!cancelled) setBlocksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [blocksReload])

  /* ── Table columns ───────────────────────────────────────────────────── */

  const columns = useMemo<DataTableColumn<StatisticsRow>[]>(
    () => [
      {
        key: 'fio',
        header: t('table.fio'),
        sortable: true,
        sortValue: (r) => r.fio,
        render: (r) => (
          <span className="st-user">
            <span>{r.fio}</span>
            <span className="lt-caption st-user__login lt-data">{r.login}</span>
          </span>
        ),
      },
      {
        key: 'group',
        header: t('table.group'),
        align: 'center',
        sortable: true,
        width: '110px',
        sortValue: (r) => r.group ?? '',
        render: (r) => r.group ?? '—',
      },
      {
        key: 'tasks_done',
        header: t('table.tasksDone'),
        sortable: true,
        numeric: true,
        align: 'center',
        width: '120px',
        sortValue: (r) => r.tasks_done,
        render: (r) => intFmt.format(r.tasks_done),
      },
      {
        key: 'agreement_pct',
        header: t('table.agreement'),
        sortable: true,
        numeric: true,
        align: 'center',
        width: '110px',
        sortValue: (r) => r.agreement_pct,
        render: (r) =>
          r.agreement_pct < LOW_AGREEMENT_PCT ? (
            // Coral — pinpoint: only problematic agreement values.
            <span className="st-low" title={t('table.lowAgreement')}>
              {formatPct(r.agreement_pct)}
            </span>
          ) : (
            formatPct(r.agreement_pct)
          ),
      },
      {
        key: 'consensus_rate_pct',
        header: t('table.consensus'),
        sortable: true,
        numeric: true,
        align: 'center',
        width: '130px',
        sortValue: (r) => r.consensus_rate_pct,
        render: (r) => formatPct(r.consensus_rate_pct),
      },
      {
        key: 'avg_task_sec',
        header: t('table.speed'),
        sortable: true,
        numeric: true,
        align: 'center',
        width: '130px',
        sortValue: (r) => r.avg_task_sec,
        render: (r) => t('table.speedValue', { sec: r.avg_task_sec }),
      },
    ],
    [t, intFmt, formatPct],
  )

  /* ── CSV export — client-side, from the current selection ──────────────────────── */

  function exportCsv() {
    if (visibleRows.length === 0) {
      toast({ kind: 'warn', message: t('annotators.exportEmpty') })
      return
    }
    const headers = [
      t('table.fio'),
      t('table.login'),
      t('table.group'),
      t('table.tasksDone'),
      t('table.agreement'),
      t('table.consensus'),
      t('table.speed'),
    ]
    const csv = buildCsv(
      headers,
      visibleRows.map((r) => [
        r.fio,
        r.login,
        r.group ?? '',
        r.tasks_done,
        r.agreement_pct,
        r.consensus_rate_pct,
        r.avg_task_sec,
      ]),
    )
    downloadCsv('annotators-statistics.csv', csv)
    toast({ kind: 'ok', message: t('annotators.exportDone', { count: visibleRows.length }) })
  }

  /* ── "tasks per week" chart data — over the current selection ─────────────── */

  const weekValues = useMemo(() => weeklySeries(visibleRows), [visibleRows])
  const weekLabels = useMemo(() => weeklyLabels(locale), [locale])
  const weekSummary = weekLabels.map((label, i) => `${label}: ${weekValues[i]}`).join(', ')

  return (
    <section className="lt-page st-page">
      <header>
        <h1>{t('title')}</h1>
        <SectionDivider className="st-divider" />
      </header>

      {/* Labelers table */}
      <Card
        title={t('annotators.heading')}
        actions={
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={rowsLoading}>
            {t('annotators.exportCsv')}
          </Button>
        }
      >
        <form
          className="st-filters"
          role="search"
          aria-label={t('filters.legend')}
          onSubmit={(e) => e.preventDefault()}
        >
          <TextField
            type="search"
            label={t('filters.search')}
            placeholder={t('filters.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select label={t('filters.group')} value={group} onChange={(e) => changeGroup(e.target.value)}>
            <option value="">{t('filters.allGroups')}</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select
            label={t('filters.student')}
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">{t('filters.allStudents')}</option>
            {studentOptions.map((s) => (
              <option key={s.user_id} value={String(s.user_id)}>
                {s.fio}
              </option>
            ))}
          </Select>
          {hasFilters && (
            <Button
              size="sm"
              variant="secondary"
              className="st-filters__reset"
              onClick={resetFilters}
            >
              {t('filters.reset')}
            </Button>
          )}
        </form>

        {rowsError ? (
          <Banner
            kind="warning"
            action={
              <Button size="sm" variant="secondary" onClick={() => setRowsReload((n) => n + 1)}>
                {tc('actions.retry')}
              </Button>
            }
          >
            {t('annotators.loadError')}
          </Banner>
        ) : (
          <DataTable
            key={`${search}|${group}|${studentId}`}
            columns={columns}
            rows={visibleRows}
            rowKey={(r) => r.user_id}
            pageSize={TABLE_PAGE_SIZE}
            loading={rowsLoading}
            emptyTitle={t('annotators.empty')}
            emptyDescription={t('annotators.emptyHint')}
          />
        )}
      </Card>

      {/* Charts: pure SVG/CSS on theme tokens */}
      <div className="st-grid">
        <Card title={t('charts.weeklyHeading')}>
          <p className="lt-caption st-hint">{t('charts.weeklyHint')}</p>
          {rowsLoading ? (
            <div className="st-card-loading">
              <Spinner size={24} label={tc('loading')} />
            </div>
          ) : (
            <WeeklyBarChart
              values={weekValues}
              labels={weekLabels}
              ariaLabel={t('charts.weeklyAria', { summary: weekSummary })}
            />
          )}
        </Card>
        <Card title={t('charts.typesHeading')}>
          <p className="lt-caption st-hint">{t('charts.typesHint')}</p>
          {blocksLoading ? (
            <div className="st-card-loading">
              <Spinner size={24} label={tc('loading')} />
            </div>
          ) : (
            <TaskTypeDistribution counts={typeCounts} ariaLabel={t('charts.typesAria')} />
          )}
        </Card>
      </div>

      {/* Agreement metrics + project progress */}
      <ProjectsOverview
        projects={projects}
        progress={progressMap}
        agreement={agreementMap}
        loading={blocksLoading}
        error={blocksError}
        onRetry={() => setBlocksReload((n) => n + 1)}
        formatPct={formatPct}
      />
    </section>
  )
}
