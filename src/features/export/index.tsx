import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { ExportFormat, ExportJob, ExportScope, Project, TaskType } from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  SectionDivider,
  Spinner,
  TrackProgress,
  useToast,
} from '../../components'
import { IconCheck, IconFolder, IconX } from '../../components/icons'
import { registerFeatureI18n } from '../../i18n'
import { en, ru } from './i18n'
import './export.css'

registerFeatureI18n('export', { ru, en })

/** Order of format cards. */
const FORMATS: readonly ExportFormat[] = ['jsonl', 'csv', 'nemo', 'textgrid', 'conll', 'srt_vtt']

/** Build-status polling interval, ms. */
const POLL_INTERVAL_MS = 700

/** Icons not in the shared library (local to the feature). */
function IconDownload({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v11M7 12l5 4 5-4M5 19h14" />
    </svg>
  )
}

export default function ExportScreen() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)
  const { t, i18n } = useTranslation('export')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [history, setHistory] = useState<ExportJob[]>([])

  // Format (radio), scope (mutually exclusive checkboxes), metadata.
  const [format, setFormat] = useState<ExportFormat>('jsonl')
  const [scope, setScope] = useState<ExportScope>('consensus')
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<TaskType>>(new Set())

  // The export being built (poll via client) and launch.
  const [running, setRunning] = useState<ExportJob | null>(null)
  const [starting, setStarting] = useState(false)

  const locale = i18n.language.startsWith('ru') ? 'ru-RU' : 'en-GB'

  const formatSize = useCallback(
    (bytes: number): string => {
      const units = [t('units.b'), t('units.kb'), t('units.mb'), t('units.gb'), t('units.tb')]
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      const nf = new Intl.NumberFormat(locale, {
        maximumFractionDigits: value >= 10 || unit === 0 ? 0 : 1,
      })
      return `${nf.format(value)} ${units[unit]}`
    },
    [t, locale],
  )

  const formatDate = useCallback(
    (iso: string): string =>
      new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(
        new Date(iso),
      ),
    [locale],
  )

  const loadHistory = useCallback(async (pid: number) => {
    const jobs = await api.exports.history(pid)
    setHistory(jobs)
  }, [])

  // Initial load: project (chip, task types) + export history.
  useEffect(() => {
    if (!Number.isFinite(projectId)) {
      setLoading(false)
      setLoadError(true)
      return
    }
    let disposed = false
    setLoading(true)
    setLoadError(false)
    Promise.all([api.projects.get(projectId), api.exports.history(projectId)])
      .then(([proj, jobs]) => {
        if (disposed) return
        setProject(proj)
        setHistory(jobs)
        setSelectedTypes(new Set(proj.task_types))
      })
      .catch(() => {
        if (!disposed) setLoadError(true)
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [projectId])

  // Poll build status: "Building… 43% · 2.1 GB" → done → into history.
  const runningId = running !== null && running.status === 'running' ? running.id : null
  useEffect(() => {
    if (runningId === null || !Number.isFinite(projectId)) return
    let disposed = false
    let inFlight = false
    const timer = window.setInterval(() => {
      if (inFlight) return
      inFlight = true
      api.exports
        .status(projectId, runningId)
        .then((job) => {
          if (disposed) return
          if (job.status === 'done') {
            setRunning(null)
            toast({ kind: 'ok', message: t('toasts.done', { name: job.filename }) })
            void loadHistory(projectId).catch(() => undefined)
          } else if (job.status === 'cancelled' || job.status === 'error') {
            setRunning(null)
            toast({
              kind: job.status === 'error' ? 'error' : 'info',
              message: job.status === 'error' ? t('toasts.startFailed') : t('toasts.cancelled'),
            })
          } else {
            setRunning(job)
          }
        })
        .catch(() => {
          if (disposed) return
          setRunning(null)
          toast({ kind: 'error', message: t('toasts.pollFailed') })
        })
        .finally(() => {
          inFlight = false
        })
    }, POLL_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [runningId, projectId, loadHistory, toast, t])

  const toggleType = (type: TaskType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const handleStart = async () => {
    if (project === null || selectedTypes.size === 0) return
    setStarting(true)
    try {
      const job = await api.exports.start(project.id, {
        format,
        scope,
        include_metadata: includeMetadata,
        task_types: TASK_TYPES.filter((type) => selectedTypes.has(type)),
      })
      setRunning(job)
    } catch {
      toast({ kind: 'error', message: t('toasts.startFailed') })
    } finally {
      setStarting(false)
    }
  }

  const handleCancel = async () => {
    if (project === null || running === null) return
    try {
      await api.exports.cancel(project.id, running.id)
      setRunning(null)
      toast({ kind: 'info', message: t('toasts.cancelled') })
    } catch {
      toast({ kind: 'error', message: t('toasts.cancelFailed') })
    }
  }

  const handleDownload = async (job: ExportJob) => {
    try {
      const blob = await api.exports.download(job.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = job.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast({ kind: 'error', message: t('toasts.downloadFailed') })
    }
  }

  if (loading) {
    return (
      <section className="lt-page ex-page">
        <div className="ex-loading">
          <Spinner size={32} label={tc('loading')} />
        </div>
      </section>
    )
  }

  if (loadError || project === null) {
    return (
      <section className="lt-page ex-page">
        <h1>{t('title')}</h1>
        <SectionDivider />
        <EmptyState
          title={t('errors.projectNotFound')}
          description={t('errors.projectNotFoundHint')}
          action={<Link to="/admin/projects">{t('errors.toProjects')}</Link>}
        />
      </section>
    )
  }

  const noTypesSelected = selectedTypes.size === 0

  return (
    <section className="lt-page ex-page">
      {/* Header: back to project · title · project chip (context) */}
      <div className="ex-head">
        <Link
          to={`/admin/projects/${project.id}`}
          className="ex-back"
          aria-label={t('toProject')}
          title={t('toProject')}
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1>{t('title')}</h1>
        <span className="ex-proj" title={t('projectChip')}>
          <IconFolder size={13} aria-hidden="true" />
          {project.name}
        </span>
      </div>
      <SectionDivider />

      <div className="ex-layout">
        {/* ── Left column: export parameters ──────────────────────────── */}
        <Card padding="lg">
          <div className="ex-form">
            {/* Task types (prototype D7): multi-select with chips */}
            <fieldset className="ex-fieldset">
              <legend className="ex-legend">{t('types.legend')}</legend>
              <div className="ex-types">
                {project.task_types.map((type) => {
                  const on = selectedTypes.has(type)
                  return (
                    <button
                      key={type}
                      type="button"
                      className="ex-type"
                      aria-pressed={on}
                      onClick={() => toggleType(type)}
                    >
                      <span className="ex-type__dot" aria-hidden="true" />
                      {tc(`taskTypes.${type}`)}
                    </button>
                  )
                })}
              </div>
              {noTypesSelected && <p className="ex-types-hint">{t('types.empty')}</p>}
            </fieldset>

            {/* 6 format cards, single selection (radio semantics) */}
            <fieldset className="ex-fieldset">
              <legend className="ex-legend">{t('format.legend')}</legend>
              <div className="ex-formats" role="radiogroup" aria-label={t('format.legend')}>
                {FORMATS.map((fmt) => {
                  const selected = format === fmt
                  return (
                    <label
                      key={fmt}
                      className={selected ? 'ex-fmt ex-fmt--selected' : 'ex-fmt'}
                    >
                      <input
                        type="radio"
                        name="export-format"
                        className="ex-fmt__input"
                        value={fmt}
                        checked={selected}
                        onChange={() => setFormat(fmt)}
                      />
                      <span className="ex-fmt__name lt-data">
                        {t(`formats.${fmt}.name`)}
                        {selected && (
                          <IconCheck size={12} className="ex-fmt__check" aria-hidden="true" />
                        )}
                      </span>
                      <span className="ex-fmt__desc">{t(`formats.${fmt}.desc`)}</span>
                      <span className="ex-fmt__purpose">{t(`formats.${fmt}.purpose`)}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            {/* Options; consensus and «all versions» are mutually exclusive (scope) */}
            <fieldset className="ex-fieldset">
              <legend className="ex-legend">{t('options.legend')}</legend>
              <div className="ex-options">
                <Checkbox
                  label={t('options.consensus')}
                  hint={t('options.consensusHint')}
                  checked={scope === 'consensus'}
                  onChange={(e) => {
                    if (e.target.checked) setScope('consensus')
                  }}
                />
                <Checkbox
                  label={t('options.all')}
                  hint={t('options.allHint')}
                  checked={scope === 'all'}
                  onChange={(e) => {
                    if (e.target.checked) setScope('all')
                  }}
                />
                <Checkbox
                  label={t('options.meta')}
                  hint={t('options.metaHint')}
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
              </div>
            </fieldset>

            {/* Launch the build */}
            <Button
              variant="primary"
              className="ex-submit"
              loading={starting}
              disabled={noTypesSelected || running !== null}
              onClick={() => void handleStart()}
            >
              {t('submit')}
            </Button>
          </div>
        </Card>

        {/* ── Right column: "Exports" — building + history ──────────── */}
        <Card title={t('history.title')}>
          <div className="ex-hist">
            {running !== null && (
              <div className="ex-run">
                <div className="ex-run__head">
                  <span className="ex-run__name lt-data">{running.filename}</span>
                  <button
                    type="button"
                    className="ex-iconbtn ex-iconbtn--danger"
                    onClick={() => void handleCancel()}
                    aria-label={t('history.cancel')}
                    title={t('history.cancel')}
                  >
                    <IconX size={13} />
                  </button>
                </div>
                <TrackProgress
                  value={running.progress}
                  showLabel={false}
                  label={t('history.making', {
                    pct: running.progress,
                    size: formatSize(running.size_bytes),
                  })}
                />
                <span className="ex-run__meta lt-data">
                  {t('history.making', {
                    pct: running.progress,
                    size: formatSize(running.size_bytes),
                  })}
                </span>
              </div>
            )}

            {history.length === 0 && running === null ? (
              <EmptyState
                compact
                title={t('history.empty')}
                description={t('history.emptyHint')}
              />
            ) : (
              history.map((job) => (
                <div key={job.id} className="ex-item">
                  <div className="ex-item__body">
                    <div className="ex-item__name lt-data">{job.filename}</div>
                    <div className="ex-item__meta lt-data">
                      {formatDate(job.created_at)} · {formatSize(job.size_bytes)} ·{' '}
                      {t(`formats.${job.format}.name`)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ex-iconbtn"
                    disabled={job.download_url === null}
                    onClick={() => void handleDownload(job)}
                    aria-label={`${t('history.download')}: ${job.filename}`}
                    title={t('history.download')}
                  >
                    <IconDownload />
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </section>
  )
}
