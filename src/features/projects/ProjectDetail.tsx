import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../../api/client'
import type { AudioFragment, Project } from '../../api/types'
import {
  Banner,
  Button,
  Card,
  DataTable,
  EmptyState,
  Modal,
  SectionDivider,
  Select,
  Spinner,
  StatusBadge,
  TrackProgress,
  useToast,
} from '../../components'
import type { DataTableColumn, StatusBadgeProps } from '../../components'
import { IconUpload, IconX } from '../../components/icons'
import { LabelChip } from './LabelChip'
import { ProjectFormModal } from './ProjectFormModal'
import { S3SourcesSection } from './S3SourcesSection'
import { formatDuration, formatMb, fragmentStatus, typeUsesLabels } from './lib'
import type { FragmentStatus } from './lib'

/**
 * Project page /admin/projects/:id:
 * header (name, single-task-type chip, ×K consensus badge, progress,
 * instruction), fragment browser (DataTable: status from finished on the
 * backend, tasks column "tasks_done/tasks_required"), an <audio> player via a
 * presigned URL, deletion with confirmation, Upload/Export transitions.
 * The task type is shared across the project — it is not editable per fragment.
 */

const STATUS_BADGE: Record<FragmentStatus, StatusBadgeProps['kind']> = {
  finished: 'ok',
  in_progress: 'progress',
  queued: 'neutral',
}

const STATUS_KEY: Record<FragmentStatus, string> = {
  finished: 'fragments.statusFinished',
  in_progress: 'fragments.statusInProgress',
  queued: 'fragments.statusQueued',
}

type PlayerState = { id: number; filename: string; url: string | null }

export function ProjectDetail({ projectId }: { projectId: number }) {
  const { t, i18n } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [fragments, setFragments] = useState<AudioFragment[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [editOpen, setEditOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AudioFragment | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    if (!Number.isFinite(projectId)) {
      setNotFound(true)
      setLoading(false)
      return
    }
    Promise.all([api.projects.get(projectId), api.fragments.list(projectId, { limit: 1000 })])
      .then(([p, frags]) => {
        if (cancelled) return
        setProject(p)
        setFragments(frags.items)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadKey])

  // The type filter is gone: the type is shared across the whole project (Project.task_type).
  const filteredFragments = useMemo(
    () => fragments.filter((f) => statusFilter === '' || fragmentStatus(f) === statusFilter),
    [fragments, statusFilter],
  )

  async function play(f: AudioFragment) {
    setPlayer({ id: f.id, filename: f.filename, url: null })
    try {
      const presigned = await api.fragments.presigned(f.id)
      setPlayer((cur) => (cur && cur.id === f.id ? { ...cur, url: presigned.url } : cur))
    } catch {
      setPlayer((cur) => (cur && cur.id === f.id ? null : cur))
      toast({ kind: 'error', message: t('fragments.playerError') })
    }
  }

  async function removeFragment() {
    if (!confirmDelete) return
    const target = confirmDelete
    setDeleting(true)
    try {
      await api.fragments.remove(target.id)
      setFragments((list) => list.filter((x) => x.id !== target.id))
      setPlayer((cur) => (cur && cur.id === target.id ? null : cur))
      setConfirmDelete(null)
      toast({ kind: 'ok', message: t('fragments.deleted') })
    } catch {
      toast({ kind: 'error', message: t('fragments.deleteError') })
    } finally {
      setDeleting(false)
    }
  }

  const columns: DataTableColumn<AudioFragment>[] = [
    {
      key: 'play',
      header: '',
      align: 'center',
      width: '44px',
      render: (f) => (
        <button
          type="button"
          className={`ltp-play${player?.id === f.id ? ' ltp-play--active' : ''}`}
          aria-label={t('fragments.playAria', { name: f.filename })}
          aria-pressed={player?.id === f.id}
          onClick={() => void play(f)}
        >
          <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false">
            <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
          </svg>
        </button>
      ),
    },
    { key: 'filename', header: t('fragments.colFile'), sortable: true, numeric: true },
    {
      key: 'duration_sec',
      header: t('fragments.colDuration'),
      sortable: true,
      numeric: true,
      align: 'center',
      width: '120px',
      sortValue: (f) => f.duration_sec ?? -1,
      render: (f) => formatDuration(f.duration_sec),
    },
    {
      key: 'size_bytes',
      header: t('fragments.colSize'),
      sortable: true,
      numeric: true,
      align: 'center',
      width: '110px',
      sortValue: (f) => f.size_bytes,
      render: (f) => formatMb(f.size_bytes, i18n.language),
    },
    {
      // The type is shared across the project (Project.task_type) — shown as text, not editable.
      key: 'task_type',
      header: t('fragments.colType'),
      align: 'center',
      width: '150px',
      render: (f) => <span className="ltp-muted">{tc(`taskTypes.${f.task_type}`)}</span>,
    },
    {
      key: 'status',
      header: t('fragments.colStatus'),
      align: 'center',
      sortable: true,
      width: '130px',
      sortValue: (f) => fragmentStatus(f),
      render: (f) => {
        const status = fragmentStatus(f)
        return <StatusBadge kind={STATUS_BADGE[status]} label={t(STATUS_KEY[status])} />
      },
    },
    {
      // Consensus: done / required (tasks_required = the project's consensus_overlap).
      key: 'tasks',
      header: t('fragments.colTasks'),
      sortable: true,
      numeric: true,
      align: 'center',
      width: '110px',
      sortValue: (f) => f.tasks_done,
      render: (f) => `${f.tasks_done}/${f.tasks_required}`,
    },
    {
      key: 'actions',
      header: '',
      width: '44px',
      align: 'center',
      render: (f) => (
        <button
          type="button"
          className="ltp-rowbtn ltp-rowbtn--danger"
          aria-label={t('fragments.deleteAria', { name: f.filename })}
          onClick={() => setConfirmDelete(f)}
        >
          <IconX size={14} />
        </button>
      ),
    },
  ]

  if (notFound) {
    return (
      <section className="lt-page">
        <Card padding="lg">
          <EmptyState
            title={t('detail.notFound')}
            description={t('detail.notFoundHint')}
            action={
              <Button variant="secondary" onClick={() => navigate('/admin/projects')}>
                {tc('nav.projects')}
              </Button>
            }
          />
        </Card>
      </section>
    )
  }

  return (
    <section className="lt-page">
      <Link className="ltp-back" to="/admin/projects">
        ← {tc('nav.projects')}
      </Link>

      {failed && (
        <Banner
          kind="warning"
          className="ltp-banner"
          action={
            <Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              {tc('actions.retry')}
            </Button>
          }
        >
          {t('detail.loadError')}
        </Banner>
      )}

      {loading && (
        <div className="ltp-loading">
          <Spinner size={36} label={tc('loading')} />
        </div>
      )}

      {!loading && project && (
        <>
          {/* --- Header: name, actions, progress ------------------------------- */}
          <header className="ltp-dhead">
            <div className="ltp-dhead__row">
              <div className="ltp-dhead__titlebox">
                <h1>{project.name}</h1>
                <span className="ltp-typechip">{tc(`taskTypes.${project.task_type}`)}</span>
                {/* Consensus badge: K>=2 annotators per fragment */}
                {project.consensus_overlap >= 2 && (
                  <span className="ltp-conschip">
                    {t('consensus.badge', { count: project.consensus_overlap })}
                  </span>
                )}
              </div>
              <div className="ltp-dhead__actions">
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  {t('detail.edit')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/admin/projects/${project.id}/export`)}
                >
                  {tc('sections.export')}
                </Button>
                <Button
                  leftIcon={<IconUpload size={16} />}
                  onClick={() => navigate(`/admin/projects/${project.id}/upload`)}
                >
                  {tc('sections.upload')}
                </Button>
              </div>
            </div>
            <SectionDivider className="ltp-divider" />
            {project.description !== '' && <p className="ltp-dhead__desc">{project.description}</p>}
            <div className="ltp-progressline">
              <div className="ltp-progressline__track">
                <TrackProgress value={project.counters.progress_pct} label={t('detail.progress')} />
              </div>
              <span className="lt-data ltp-progressline__counters">
                {t('counters.fragments', { count: project.counters.fragments_total })} ·{' '}
                {t('counters.labeled', { value: project.counters.fragments_labeled })} ·{' '}
                {t('counters.inProgress', { value: project.counters.fragments_in_progress })}
                {project.counters.zombie_tasks > 0 && (
                  <>
                    {' · '}
                    <span className="ltp-zombie">
                      {t('counters.zombie', { value: project.counters.zombie_tasks })}
                    </span>
                  </>
                )}
              </span>
            </div>
          </header>

          {/* --- Instruction, classes (classification/segmentation) or MOS scales
                (a mos project shows its scales instead of the labels block), members --- */}
          <div
            className={`ltp-info${
              typeUsesLabels(project.task_type) ||
              project.task_type === 'mos' ||
              project.task_type === 'sbs'
                ? ''
                : ' ltp-info--nolabels'
            }`}
          >
            <Card title={t('detail.instruction')}>
              {project.instruction !== '' ? (
                <p className="ltp-instruction">{project.instruction}</p>
              ) : (
                <p className="ltp-muted">{t('detail.noInstruction')}</p>
              )}
            </Card>
            {typeUsesLabels(project.task_type) && (
              <Card
                title={t(
                  project.task_type === 'segmentation'
                    ? 'labels.titleSegmentation'
                    : 'labels.titleClassification',
                )}
              >
                <div className="ltp-labels__chips">
                  {project.label_list.length === 0 && (
                    <span className="ltp-muted lt-caption">{t('labels.empty')}</span>
                  )}
                  {project.label_list.map((l) => (
                    <LabelChip key={l.name} label={l} />
                  ))}
                </div>
              </Card>
            )}
            {project.task_type === 'mos' && (
              <Card title={t('mosScales.title')}>
                <div className="ltp-labels__chips">
                  {(project.mos_scales ?? []).map((s) => (
                    <span key={s.name} className="ltp-scalechip">
                      {s.name}
                    </span>
                  ))}
                </div>
              </Card>
            )}
            {/* SBS: system names — admin panel only (never shown to the annotator) */}
            {project.task_type === 'sbs' && project.sbs_systems && (
              <Card title={t('sbsSystems.title')}>
                <div className="ltp-labels__chips">
                  <span
                    className="ltp-scalechip"
                    aria-label={t('sbsSystems.systemA', { name: project.sbs_systems.a })}
                  >
                    <span className="ltp-sbs-badge" aria-hidden="true">
                      {t('sbsSystems.badgeA')}
                    </span>
                    {project.sbs_systems.a}
                  </span>
                  <span
                    className="ltp-scalechip"
                    aria-label={t('sbsSystems.systemB', { name: project.sbs_systems.b })}
                  >
                    <span className="ltp-sbs-badge" aria-hidden="true">
                      {t('sbsSystems.badgeB')}
                    </span>
                    {project.sbs_systems.b}
                  </span>
                </div>
                <p className="ltp-muted lt-caption">{t('sbsSystems.blindNote')}</p>
              </Card>
            )}
            <Card title={t('detail.members')}>
              {project.participants.length === 0 ? (
                <p className="ltp-muted lt-caption">{t('members.empty')}</p>
              ) : (
                /* A scrollable region must be reachable via keyboard
                   (axe serious "scrollable-region-focusable") */
                <ul className="ltp-members-list" tabIndex={0} aria-label={t('detail.members')}>
                  {project.participants.map((m) => (
                    <li key={m.user_id} className="ltp-members-list__item">
                      <span>{m.fio}</span>
                      <span className="ltp-members-list__group lt-caption lt-data">
                        {m.group ?? t('members.noGroup')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* --- Fragment browser --------------------------------------- */}
          <Card
            title={t('fragments.title')}
            actions={
              <span className="lt-caption ltp-muted lt-data">
                {t('counters.fragments', { count: filteredFragments.length })}
              </span>
            }
          >
            <div className="ltp-frags__filters">
              <Select
                className="ltp-frags__filter"
                label={t('fragments.filterStatus')}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{t('fragments.all')}</option>
                <option value="finished">{t('fragments.statusFinished')}</option>
                <option value="in_progress">{t('fragments.statusInProgress')}</option>
                <option value="queued">{t('fragments.statusQueued')}</option>
              </Select>
            </div>

            {player && (
              <div className="ltp-player">
                <span className="ltp-player__name lt-data">{player.filename}</span>
                {player.url !== null ? (
                  <audio
                    className="ltp-player__audio"
                    controls
                    autoPlay
                    src={player.url}
                    aria-label={t('fragments.playerLabel', { name: player.filename })}
                  />
                ) : (
                  <Spinner size={16} inline label={tc('loading')} />
                )}
                <button
                  type="button"
                  className="ltp-rowbtn"
                  aria-label={tc('actions.close')}
                  onClick={() => setPlayer(null)}
                >
                  <IconX size={14} />
                </button>
              </div>
            )}

            <DataTable
              columns={columns}
              rows={filteredFragments}
              rowKey={(f) => f.id}
              filterable
              filterPlaceholder={t('fragments.searchPlaceholder')}
              filterFn={(f, q) => f.filename.toLowerCase().includes(q)}
              pageSize={10}
              emptyTitle={t('fragments.empty')}
              emptyDescription={t('fragments.emptyHint')}
            />
          </Card>

          {/* --- S3 data sources (reference-in-place) --------------------------- */}
          <S3SourcesSection project={project} onChanged={() => setReloadKey((k) => k + 1)} />

          {/* --- Modals: project settings, delete confirmation ------------------ */}
          <ProjectFormModal
            open={editOpen}
            project={project}
            onClose={() => setEditOpen(false)}
            onSaved={(p) => {
              setProject(p)
              // Changing consensus_overlap recalculates fragment tasks on the backend —
              // reload the list so the "done/required" column and statuses stay fresh.
              setReloadKey((k) => k + 1)
            }}
          />

          <Modal
            open={confirmDelete !== null}
            onClose={() => setConfirmDelete(null)}
            title={t('fragments.deleteTitle')}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                >
                  {tc('actions.cancel')}
                </Button>
                <Button variant="danger" onClick={() => void removeFragment()} loading={deleting}>
                  {tc('actions.delete')}
                </Button>
              </>
            }
          >
            <p>{t('fragments.deleteBody', { name: confirmDelete?.filename ?? '' })}</p>
          </Modal>
        </>
      )}
    </section>
  )
}
