import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { Project } from '../../api/types'
import {
  Banner,
  Button,
  Card,
  EmptyState,
  SectionDivider,
  Spinner,
  TrackProgress,
} from '../../components'
import { IconPlus, IconUpload } from '../../components/icons'
import { LabelChip } from './LabelChip'
import { ProjectFormModal } from './ProjectFormModal'
import { typeUsesLabels } from './lib'

/**
 * Project list: cards with progress (TrackProgress),
 * members, fragment counters and Upload/Export/Open transitions.
 * ?new=1 (the dashboard quick action) opens the create modal.
 */

function membersLine(
  p: Project,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (p.participants.length === 0) return t('list.noMembers')
  const names = p.participants.slice(0, 2).map((m) => m.fio)
  const rest = p.participants.length - names.length
  const head = t('list.members', { count: p.participants.length })
  return `${head} · ${names.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
}

export default function ProjectsList() {
  const { t, i18n } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [projects, setProjects] = useState<Project[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    api.projects
      .list()
      .then((ps) => {
        if (!cancelled) setProjects(ps)
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

  // "New project" quick action from the dashboard: /admin/projects?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') setCreateOpen(true)
  }, [searchParams])

  function closeCreate() {
    setCreateOpen(false)
    if (searchParams.get('new') !== null) {
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }

  return (
    <section className="lt-page">
      <header>
        <div className="ltp-head__row">
          <h1>{tc('nav.projects')}</h1>
          <Button leftIcon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            {t('list.new')}
          </Button>
        </div>
        <SectionDivider className="ltp-divider" />
      </header>

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
          {t('list.loadError')}
        </Banner>
      )}

      {loading && (
        <div className="ltp-loading">
          <Spinner size={36} label={tc('loading')} />
        </div>
      )}

      {!loading && projects !== null && projects.length === 0 && (
        <Card padding="lg">
          <EmptyState
            title={t('list.empty')}
            description={t('list.emptyHint')}
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                {tc('actions.create')}
              </Button>
            }
          />
        </Card>
      )}

      {!loading && projects !== null && projects.length > 0 && (
        <div className="ltp-grid">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="ltp-pcard"
              title={p.name}
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/admin/projects/${p.id}`)}
                >
                  {tc('actions.open')}
                </Button>
              }
            >
              <div className="ltp-chiprow">
                <span className="ltp-typechip">{tc(`taskTypes.${p.task_type}`)}</span>
                {/* Consensus badge: K>=2 annotators per fragment */}
                {p.consensus_overlap >= 2 && (
                  <span className="ltp-conschip">
                    {t('consensus.badge', { count: p.consensus_overlap })}
                  </span>
                )}
              </div>
              <p className="ltp-pcard__desc">{p.description}</p>
              <TrackProgress value={p.counters.progress_pct} label={t('detail.progress')} />
              <p className="ltp-pcard__counters lt-data">
                {t('counters.fragments', { count: p.counters.fragments_total })} ·{' '}
                {t('counters.labeled', { value: p.counters.fragments_labeled })} ·{' '}
                {t('counters.inProgress', { value: p.counters.fragments_in_progress })}
              </p>
              <p className="ltp-pcard__members lt-caption">{membersLine(p, t)}</p>
              {/* Class labels exist only for classification/segmentation */}
              {typeUsesLabels(p.task_type) && p.label_list.length > 0 && (
                <div className="ltp-pcard__chips">
                  {p.label_list.map((l) => (
                    <LabelChip key={l.name} label={l} />
                  ))}
                </div>
              )}
              {/* A MOS project shows its rating scales instead of labels */}
              {p.task_type === 'mos' && (p.mos_scales?.length ?? 0) > 0 && (
                <div className="ltp-pcard__chips">
                  {(p.mos_scales ?? []).map((s) => (
                    <span key={s.name} className="ltp-scalechip">
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
              {/* An SBS project shows the names of the compared systems (admin panel) */}
              {p.task_type === 'sbs' && p.sbs_systems && (
                <div className="ltp-pcard__chips">
                  <span
                    className="ltp-scalechip"
                    aria-label={t('sbsSystems.systemA', { name: p.sbs_systems.a })}
                  >
                    <span className="ltp-sbs-badge" aria-hidden="true">
                      {t('sbsSystems.badgeA')}
                    </span>
                    {p.sbs_systems.a}
                  </span>
                  <span
                    className="ltp-scalechip"
                    aria-label={t('sbsSystems.systemB', { name: p.sbs_systems.b })}
                  >
                    <span className="ltp-sbs-badge" aria-hidden="true">
                      {t('sbsSystems.badgeB')}
                    </span>
                    {p.sbs_systems.b}
                  </span>
                </div>
              )}
              <footer className="ltp-pcard__actions">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<IconUpload size={14} />}
                  onClick={() => navigate(`/admin/projects/${p.id}/upload`)}
                >
                  {t('list.upload')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/admin/projects/${p.id}/export`)}
                >
                  {tc('actions.export')}
                </Button>
                <span className="ltp-pcard__created lt-caption lt-data">
                  {t('list.created', {
                    date: new Date(p.created_at).toLocaleDateString(i18n.language),
                  })}
                </span>
              </footer>
            </Card>
          ))}
        </div>
      )}

      <ProjectFormModal
        open={createOpen}
        project={null}
        onClose={closeCreate}
        onSaved={(p) => navigate(`/admin/projects/${p.id}`)}
      />
    </section>
  )
}
