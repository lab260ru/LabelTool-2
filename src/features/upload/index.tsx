/**
 * Data upload wizard — /admin/projects/:id/upload.
 * Header with project and task-type chips, 4-step stepper (done/active/future,
 * back navigation over done steps).
 * The task type is set on project creation (Project.task_type) — the wizard does
 * NOT ask for it, all fragments inherit the project type. Upload via api.upload
 * in 4 parallel streams (semaphore), cancel — AbortController, errors do not
 * stop the batch (AC-4), retry of failures per-file and as a whole.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState, Spinner, Stepper, useToast } from '../../components'
import type { KeyValuePair } from '../../components'
import { IconFolder } from '../../components/icons'
import { api } from '../../api/client'
import type { Project } from '../../api/types'
import './i18n'
import './upload.css'
import type { ColumnTarget, LocalFile, RunState, WizardSummary } from './lib'
import {
  PARALLEL_STREAMS,
  UNIQUE_TARGETS,
  isUploadable,
  loadExistingFilenames,
  parseCsv,
  queuedRun,
  readDuration,
  sbsUploadable,
  targetsFromSuggested,
  buildMapping,
  validityOf,
} from './lib'
import { StepFiles } from './StepFiles'
import type { ManifestState } from './StepFiles'
import { StepMetadata } from './StepMetadata'
import { StepProgress } from './StepProgress'
import { StepSummary } from './StepSummary'

/** Step indexes (0-based): files → metadata → upload → summary. */
const STEP_FILES = 0
const STEP_META = 1
const STEP_UPLOAD = 2
const STEP_SUMMARY = 3

export default function UploadWizard() {
  const { t } = useTranslation('upload')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const navigate = useNavigate()
  const params = useParams()
  const projectId = Number(params.id)

  /* ── Project context (header chip, duplicate check via client) ──────────── */
  const [project, setProject] = useState<Project | null>(null)
  const [projectError, setProjectError] = useState(false)
  const [existingNames, setExistingNames] = useState<ReadonlySet<string>>(new Set())

  /* ── Wizard state ───────────────────────────────────────────────────────── */
  const [step, setStep] = useState(STEP_FILES)
  const [tab, setTab] = useState('files')
  const [files, setFiles] = useState<LocalFile[]>([])
  const [origTrb, setOrigTrb] = useState<Record<string, string>>({})
  const [pairs, setPairs] = useState<KeyValuePair[]>([])
  const [run, setRun] = useState<Record<string, RunState>>({})
  const [uploading, setUploading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [summary, setSummary] = useState<WizardSummary | null>(null)

  /* ── Manifest CSV/JSONL ─────────────────────────────────────────────────── */
  const [manifest, setManifest] = useState<ManifestState | null>(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  /* ── Upload engine refs (persist across renders) ────────────────────────── */
  const runRef = useRef<Record<string, RunState>>({})
  const sessionRef = useRef<string | null>(null)
  /** All files of the current session — for the summary and the step 4 list. */
  const sessionItemsRef = useRef<LocalFile[]>([])
  /** Shared semaphore queue: "Retry" pushes a file back in. */
  const queueRef = useRef<LocalFile[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    setProject(null)
    setProjectError(false)
    if (!Number.isFinite(projectId)) {
      setProjectError(true)
      return
    }
    api.projects
      .get(projectId)
      .then((p) => {
        if (alive) setProject(p)
      })
      .catch(() => {
        if (alive) setProjectError(true)
      })
    loadExistingFilenames(projectId)
      .then((names) => {
        if (alive) setExistingNames(names)
      })
      .catch(() => {
        /* the server checks duplicates when the session is created */
      })
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [projectId])

  // Side-by-Side: the project task type enables client-side assembly of _a/_b pairs.
  const isSbs = project?.task_type === 'sbs'

  const uploadable = useMemo(
    () =>
      isSbs
        ? sbsUploadable(files)
        : files.filter((f) => isUploadable(validityOf(f, existingNames))),
    [files, existingNames, isSbs],
  )

  /* ── Step 2: file selection ─────────────────────────────────────────────── */

  function addFiles(picked: File[]) {
    const items: LocalFile[] = picked.map((file) => ({
      clientId: crypto.randomUUID(),
      file,
      filename: file.name,
      size: file.size,
      mime: file.type,
      duration: null,
    }))
    setFiles((prev) => {
      const next = [...prev]
      for (const item of items) {
        const idx = next.findIndex((x) => x.filename === item.filename)
        if (idx >= 0) next[idx] = item
        else next.push(item)
      }
      return next
    })
    // Duration — asynchronously via the Audio API; "—" if it could not be read.
    for (const item of items) {
      void readDuration(item.file).then((duration) => {
        if (duration === null) return
        setFiles((cur) =>
          cur.map((x) => (x.clientId === item.clientId ? { ...x, duration } : x)),
        )
      })
    }
  }

  function removeFile(clientId: string) {
    setFiles((prev) => prev.filter((f) => f.clientId !== clientId))
    setOrigTrb((prev) => {
      if (!(clientId in prev)) return prev
      const next = { ...prev }
      delete next[clientId]
      return next
    })
  }

  /* ── Upload engine: semaphore of 4 streams + AbortController ────── */

  function patchRun(clientId: string, patch: Partial<RunState>) {
    const current = runRef.current[clientId]
    if (!current) return
    runRef.current = { ...runRef.current, [clientId]: { ...current, ...patch } }
    setRun(runRef.current)
  }

  async function runBatch(items: LocalFile[]) {
    const sessionId = sessionRef.current
    if (!sessionId) return
    const controller = new AbortController()
    abortRef.current = controller
    queueRef.current = [...items]
    setCancelling(false)
    setUploading(true)

    const worker = async () => {
      for (;;) {
        const item = queueRef.current.shift()
        if (!item) return
        if (controller.signal.aborted) {
          patchRun(item.clientId, { status: 'error', errorReason: 'cancelled', progress: 0 })
          continue
        }
        patchRun(item.clientId, {
          status: 'uploading',
          progress: 0,
          errorReason: null,
          failedAtPct: null,
        })
        try {
          const res = await api.upload.uploadFile(sessionId, item.clientId, item.file, {
            signal: controller.signal,
            onProgress: (pct) => patchRun(item.clientId, { progress: pct }),
          })
          if (res.ok) {
            patchRun(item.clientId, { status: 'done', progress: 100, errorReason: null })
          } else {
            // A file business error does not stop the batch (AC-4).
            patchRun(item.clientId, {
              status: 'error',
              errorReason: res.error_reason ?? 'network_failure',
              failedAtPct: res.failed_at_pct,
              ...(res.failed_at_pct !== null ? { progress: res.failed_at_pct } : {}),
            })
          }
        } catch (e) {
          const aborted = e instanceof DOMException && e.name === 'AbortError'
          patchRun(item.clientId, {
            status: 'error',
            errorReason: aborted ? 'cancelled' : 'network_failure',
            failedAtPct: null,
          })
        }
      }
    }

    await Promise.all(Array.from({ length: PARALLEL_STREAMS }, worker))
    setUploading(false)
    await finishAndSummarize()
  }

  async function finishAndSummarize() {
    let errorRowsUrl: string | null = null
    if (sessionRef.current) {
      try {
        const s = await api.upload.finishSession(sessionRef.current)
        errorRowsUrl = s.error_rows_url
      } catch {
        /* build the summary from the client-side state */
      }
    }
    const items = sessionItemsRef.current
    const states = runRef.current
    const failed = items
      .filter((i) => states[i.clientId] && states[i.clientId].status !== 'done')
      .map((i) => ({
        filename: i.filename,
        reason: states[i.clientId].errorReason ?? ('cancelled' as const),
        failedAtPct: states[i.clientId].failedAtPct,
      }))
    setSummary({
      source: 'files',
      total: items.length,
      uploaded: items.filter((i) => states[i.clientId]?.status === 'done').length,
      failed,
      errorRowsUrl,
    })
    setStep(STEP_SUMMARY)
  }

  async function startUpload() {
    const items = uploadable
    if (items.length === 0) return
    sessionItemsRef.current = items
    runRef.current = Object.fromEntries(items.map((i) => [i.clientId, queuedRun()]))
    setRun(runRef.current)
    setSummary(null)
    setStep(STEP_UPLOAD)
    try {
      const trb: Record<string, string> = {}
      for (const i of items) {
        const value = origTrb[i.clientId]?.trim()
        if (value) trb[i.clientId] = value
      }
      // We do not send the task type: the server inherits it from the project (Project.task_type).
      const info = await api.upload.createSession({
        project_id: projectId,
        metadata: Object.fromEntries(pairs.map((p) => [p.key, p.value])),
        orig_trb: trb,
        files: items.map((i) => ({
          client_id: i.clientId,
          filename: i.filename,
          size: i.size,
          duration: i.duration,
        })),
      })
      sessionRef.current = info.session_id
      await runBatch(items)
    } catch {
      toast({ kind: 'error', message: t('step3.sessionError') })
      setStep(STEP_META)
    }
  }

  function cancelRest() {
    setCancelling(true)
    abortRef.current?.abort()
  }

  /** "Retry" on a file at step 4 — back into the shared semaphore queue. */
  function retryFile(clientId: string) {
    if (!uploading) return
    const item = sessionItemsRef.current.find((i) => i.clientId === clientId)
    if (!item || runRef.current[clientId]?.status !== 'error') return
    patchRun(clientId, queuedRun())
    queueRef.current.push(item)
  }

  /** "Retry failed only" at step 5 — the same session, only the failures. */
  function retryFailed() {
    if (uploading || !sessionRef.current) return
    const items = sessionItemsRef.current.filter(
      (i) => runRef.current[i.clientId]?.status === 'error',
    )
    if (items.length === 0) return
    for (const i of items) patchRun(i.clientId, queuedRun())
    setSummary(null)
    setStep(STEP_UPLOAD)
    void runBatch(items)
  }

  /* ── Step 3: bulk CSV filename → text matching ──────────────────────────── */

  async function applyTrbCsv(file: File) {
    try {
      const rows = parseCsv(await file.text())
      const byName = new Map(uploadable.map((f) => [f.filename, f.clientId]))
      const patch: Record<string, string> = {}
      let matched = 0
      for (const row of rows) {
        const clientId = byName.get(row[0]?.trim() ?? '')
        const text = row.slice(1).join(',').trim()
        if (clientId && text) {
          patch[clientId] = text
          matched++
        }
      }
      if (matched > 0) {
        setOrigTrb((prev) => ({ ...prev, ...patch }))
        toast({ kind: 'ok', message: t('step3.csvMatched', { matched, total: uploadable.length }) })
      } else {
        toast({ kind: 'warn', message: t('step3.csvEmpty') })
      }
    } catch {
      toast({ kind: 'error', message: t('step3.csvError') })
    }
  }

  /* ── "Manifest CSV/JSONL" tab ───────────────────────────────────────────── */

  async function onManifestFile(picked: File[]) {
    const file = picked[0]
    if (!file) return
    setManifestLoading(true)
    try {
      const preview = await api.upload.previewManifest(file)
      setManifest({ preview, targets: targetsFromSuggested(preview, isSbs) })
    } catch {
      toast({ kind: 'error', message: t('manifest.loadError') })
    } finally {
      setManifestLoading(false)
    }
  }

  function onTargetChange(column: string, target: ColumnTarget) {
    setManifest((prev) => {
      if (!prev) return prev
      const targets = { ...prev.targets, [column]: target }
      // A unique target (filename[_a/_b]/task_type/orig_trb) can be carried by only one column.
      if ((UNIQUE_TARGETS as readonly string[]).includes(target)) {
        for (const col of prev.preview.columns) {
          if (col !== column && targets[col] === target) targets[col] = 'skip'
        }
      }
      return { ...prev, targets }
    })
  }

  async function importManifest() {
    if (!manifest) return
    const mapping = buildMapping(manifest.preview.columns, manifest.targets, isSbs)
    if (!mapping) return
    setImporting(true)
    try {
      const info = await api.upload.createSession({
        project_id: projectId,
        metadata: {},
        orig_trb: {},
        files: [],
      })
      const s = await api.upload.importManifest(info.session_id, mapping)
      setSummary({
        source: 'manifest',
        total: s.total,
        uploaded: s.uploaded,
        failed: s.failed.map((f) => ({ filename: f.filename, reason: f.reason, failedAtPct: null })),
        errorRowsUrl: s.error_rows_url,
      })
      setStep(STEP_SUMMARY)
    } catch {
      toast({ kind: 'error', message: t('manifest.importError') })
    } finally {
      setImporting(false)
    }
  }

  /* ── Summary: "Upload more" ─────────────────────────────────────────────── */

  function resetWizard() {
    setFiles([])
    setOrigTrb({})
    setPairs([])
    setRun({})
    runRef.current = {}
    sessionRef.current = null
    sessionItemsRef.current = []
    queueRef.current = []
    setSummary(null)
    setManifest(null)
    setTab('files')
    setStep(STEP_FILES)
    // Refresh the name list — the files just uploaded are duplicates too.
    loadExistingFilenames(projectId)
      .then(setExistingNames)
      .catch(() => {})
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (projectError) {
    return (
      <section className="lt-page lt-upload">
        <EmptyState
          title={t('projectError')}
          description={t('projectErrorHint')}
          action={<Link to="/admin/projects">{t('toProjects')}</Link>}
        />
      </section>
    )
  }

  if (project === null) {
    return (
      <section className="lt-page lt-upload lt-upload--loading">
        <Spinner size={36} label={t('title')} />
      </section>
    )
  }

  const stepLabels = [
    t('steps.files'),
    t('steps.metadata'),
    t('steps.uploading'),
    t('steps.summary'),
  ]

  // Back navigation over done steps — only until the upload has started (the upload
  // and summary steps have their own buttons: "Cancel the rest", "Upload more").
  const canStepBack = step <= STEP_META && !uploading

  return (
    <section className="lt-page lt-upload">
      <header className="lt-upload__header">
        <Link
          to={`/admin/projects/${projectId}`}
          className="lt-upload__back"
          aria-label={t('toProject')}
          title={t('toProject')}
        >
          ←
        </Link>
        <h1>{t('title')}</h1>
        <span className="lt-upload__chip">
          <IconFolder size={13} />
          <span className="lt-data">{project.name}</span>
        </span>
        {/* Project task type — fixed at creation, inherited by fragments */}
        <span className="lt-upload__chip lt-upload__chip--type" title={t('typeChip')}>
          {tc(`taskTypes.${project.task_type}`)}
        </span>
      </header>

      <Stepper
        steps={stepLabels}
        current={step}
        onStepClick={canStepBack ? setStep : undefined}
        className="lt-upload__stepper"
      />

      {step === STEP_FILES && (
        <StepFiles
          tab={tab}
          onTabChange={setTab}
          isSbs={isSbs}
          files={files}
          existingNames={existingNames}
          onAddFiles={addFiles}
          onRemoveFile={removeFile}
          onNext={() => setStep(STEP_META)}
          manifest={manifest}
          manifestLoading={manifestLoading}
          importing={importing}
          onManifestFile={(picked) => void onManifestFile(picked)}
          onTargetChange={onTargetChange}
          onImport={() => void importManifest()}
        />
      )}

      {step === STEP_META && (
        <StepMetadata
          files={uploadable}
          isSbs={isSbs}
          origTrb={origTrb}
          onOrigTrbChange={(clientId, value) =>
            setOrigTrb((prev) => ({ ...prev, [clientId]: value }))
          }
          onCsvFile={(file) => void applyTrbCsv(file)}
          pairs={pairs}
          onPairsChange={setPairs}
          onBack={() => setStep(STEP_FILES)}
          onStart={() => void startUpload()}
        />
      )}

      {step === STEP_UPLOAD && (
        <StepProgress
          items={sessionItemsRef.current}
          run={run}
          uploading={uploading}
          cancelling={cancelling}
          onCancel={cancelRest}
          onRetryFile={retryFile}
        />
      )}

      {step === STEP_SUMMARY && summary !== null && (
        <StepSummary
          summary={summary}
          projectName={project.name}
          taskType={project.task_type}
          onRetryFailed={retryFailed}
          onUploadMore={resetWizard}
          onToProject={() => void navigate(`/admin/projects/${projectId}`)}
        />
      )}
    </section>
  )
}
