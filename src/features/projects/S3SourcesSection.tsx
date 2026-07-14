import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { Project, S3PreviewResult, S3Source } from '../../api/types'
import { Banner, Button, Card, Modal, Spinner, useToast } from '../../components'
import { IconPlus, IconX } from '../../components/icons'
import { S3ConnectModal } from './S3ConnectModal'

/**
 * "S3 data sources" section on the project page (the "Connecting S3 data"
 * contract, item 4): a list of connected sources with Preview / Import / Delete
 * actions and an empty state with a connect button.
 * Import creates fragments that reference the source objects (reference-in-place)
 * and refreshes the project's fragment browser via onChanged.
 */
export interface S3SourcesSectionProps {
  project: Project
  /** Called after import/deletion — the parent reloads the fragment browser. */
  onChanged: () => void
}

export function S3SourcesSection({ project, onChanged }: S3SourcesSectionProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [sources, setSources] = useState<S3Source[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<S3Source | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSources(null)
    setLoadFailed(false)
    api.s3Sources
      .list(project.id)
      .then((list) => {
        if (!cancelled) setSources(list)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  async function removeSource() {
    if (!confirmDelete) return
    const target = confirmDelete
    setDeleting(true)
    try {
      await api.s3Sources.remove(target.id)
      setSources((list) => (list ? list.filter((s) => s.id !== target.id) : list))
      setConfirmDelete(null)
      toast({ kind: 'ok', message: t('s3.remove.done') })
      // Fragments that referenced the source are deleted — refresh the browser.
      onChanged()
    } catch {
      toast({ kind: 'error', message: t('s3.remove.error') })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      title={t('s3.title')}
      actions={
        <Button size="sm" variant="secondary" leftIcon={<IconPlus size={16} />} onClick={() => setConnectOpen(true)}>
          {t('s3.connect')}
        </Button>
      }
    >
      <p className="lt-caption ltp-hint ltp-s3__hint">{t('s3.hint')}</p>

      {loadFailed && <Banner kind="warning">{t('s3.loadError')}</Banner>}

      {sources === null && !loadFailed && (
        <div className="ltp-s3__loading">
          <Spinner size={22} inline label={t('s3.title')} />
        </div>
      )}

      {sources !== null && sources.length === 0 && (
        <div className="ltp-s3__empty">
          <p className="ltp-s3__empty-title">{t('s3.empty')}</p>
          <p className="lt-caption ltp-muted">{t('s3.emptyHint')}</p>
        </div>
      )}

      {sources !== null && sources.length > 0 && (
        <ul className="ltp-s3__list">
          {sources.map((source) => (
            <S3SourceCard
              key={source.id}
              source={source}
              onImported={onChanged}
              onDelete={() => setConfirmDelete(source)}
            />
          ))}
        </ul>
      )}

      <S3ConnectModal
        open={connectOpen}
        projectId={project.id}
        onClose={() => setConnectOpen(false)}
        onConnected={(source) =>
          setSources((list) => (list ? [...list, source] : [source]))
        }
      />

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('s3.remove.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              {tc('actions.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void removeSource()} loading={deleting}>
              {t('s3.remove.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('s3.remove.body', { name: confirmDelete?.name ?? '' })}</p>
      </Modal>
    </Card>
  )
}

/** A single source card: metadata + Preview / Import / Delete. */
function S3SourceCard({
  source,
  onImported,
  onDelete,
}: {
  source: S3Source
  onImported: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('projects')
  const { toast } = useToast()

  const [preview, setPreview] = useState<S3PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  async function runPreview() {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      setPreview(await api.s3Sources.preview(source.id))
    } catch {
      setPreviewError(t('s3.preview.error'))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function runImport() {
    setImporting(true)
    try {
      const result = await api.s3Sources.import(source.id)
      if (result.imported > 0) {
        toast({ kind: 'ok', message: t('s3.import.done', { count: result.imported }) })
      } else {
        toast({ kind: 'info', message: t('s3.import.nothing') })
      }
      if (result.unpaired && result.unpaired > 0) {
        toast({ kind: 'info', message: t('s3.import.unpairedNote', { value: result.unpaired }) })
      }
      onImported()
      // The preview numbers changed — refresh it if it is open.
      if (preview !== null) await runPreview()
    } catch {
      toast({ kind: 'error', message: t('s3.import.error') })
    } finally {
      setImporting(false)
    }
  }

  return (
    <li className="ltp-s3card">
      <div className="ltp-s3card__main">
        <div className="ltp-s3card__head">
          <span className="ltp-s3card__name">{source.name}</span>
          <span className="ltp-s3card__count lt-caption ltp-muted lt-data">
            {t('s3.card.objects', { count: source.object_count ?? 0 })}
          </span>
        </div>
        <dl className="ltp-s3card__meta lt-caption">
          <div className="ltp-s3card__metarow">
            <dt className="ltp-muted">{t('s3.card.bucket')}</dt>
            <dd className="lt-data">
              {source.endpoint_url} / {source.bucket}
            </dd>
          </div>
          <div className="ltp-s3card__metarow">
            <dt className="ltp-muted">{t('s3.card.prefix')}</dt>
            <dd className="lt-data">
              {source.prefix === '' ? (
                <span className="ltp-muted">{t('s3.card.prefixEmpty')}</span>
              ) : (
                source.prefix
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="ltp-s3card__actions">
        <Button size="sm" variant="secondary" onClick={() => void runPreview()} loading={previewLoading}>
          {t('s3.card.preview')}
        </Button>
        <Button size="sm" onClick={() => void runImport()} loading={importing}>
          {t('s3.card.import')}
        </Button>
        <Button size="sm" variant="secondary" className="ltp-s3card__del" onClick={onDelete}>
          {t('s3.card.delete')}
        </Button>
      </div>

      {previewError !== null && (
        <div className="ltp-s3card__preview">
          <Banner kind="warning">{previewError}</Banner>
        </div>
      )}

      {preview !== null && (
        <div className="ltp-s3card__preview">
          <div className="ltp-s3card__preview-head">
            <h4 className="ltp-s3card__preview-title">{t('s3.preview.title')}</h4>
            <button
              type="button"
              className="ltp-rowbtn"
              aria-label={t('s3.preview.hide')}
              onClick={() => setPreview(null)}
            >
              <IconX size={14} />
            </button>
          </div>
          <ul className="ltp-s3card__stats lt-caption" aria-label={t('s3.preview.title')}>
            <li>{t('s3.preview.totalAudio', { value: preview.total_audio })}</li>
            {preview.pairs != null && (
              <li>{t('s3.preview.pairs', { value: preview.pairs })}</li>
            )}
            {preview.unpaired != null && preview.unpaired > 0 && (
              <li className="ltp-s3card__stat-warn">
                {t('s3.preview.unpaired', { value: preview.unpaired })}
              </li>
            )}
            <li>{t('s3.preview.alreadyImported', { value: preview.already_imported })}</li>
            <li className="ltp-s3card__stat-hi">
              {t('s3.preview.toImport', { value: preview.to_import })}
            </li>
          </ul>
          {preview.truncated && (
            <p className="lt-caption ltp-s3card__stat-warn">{t('s3.preview.truncated')}</p>
          )}
          {preview.sample.length === 0 ? (
            <p className="lt-caption ltp-muted">{t('s3.preview.none')}</p>
          ) : (
            <>
              <p className="lt-caption ltp-muted ltp-s3card__sample-label">
                {t('s3.preview.sample')}
              </p>
              <ul
                className="ltp-s3card__sample lt-data"
                tabIndex={0}
                aria-label={t('s3.preview.sample')}
              >
                {preview.sample.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  )
}
