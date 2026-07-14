/**
 * Annotator workspace /label/task: a single frame —
 * player with a waveform on top, a center zone by task type, a sliding
 * instruction panel, "Submit" with auto-advance to the next task.
 * Hotkeys: Space — play/pause, S — new segment, 1–9 — class/label/speaker,
 * 1–5 — rating of the active MOS scale (focus moves to the next unrated one).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../../api/client'
import type { Task, TaskType } from '../../api/types'
import { SBS_PREFERENCES } from '../../api/types'
import { Banner, Button, Card, EmptyState, Spinner, useToast } from '../../components'
import { AudioPlayer } from '../../components/audio'
import type { AudioPlayerHandle, WaveRegion } from '../../components/audio'
import {
  ClassificationEditor,
  MosEditor,
  RegionsEditor,
  SbsScale,
  TranscriptionEditor,
  VerificationEditor,
} from './editors'
import type { Draft } from './lib'
import {
  FALLBACK_REGION_COLOR,
  activeMosScale,
  apiErrorKey,
  buildResult,
  initDraft,
  nextDraftId,
  regionOptions,
  round2,
  validationKey,
} from './lib'

type Phase =
  | { name: 'loading' }
  | { name: 'error'; key: string }
  | { name: 'empty' }
  | { name: 'ready'; task: Task }

interface AudioSource {
  url: string
  /** Lifetime of the presigned URL; the original audio_url has no expiry. */
  expiresAt: string | null
}

/** Hotkeys hint under the player. */
function HotkeysHint({ type }: { type: TaskType }) {
  const { t } = useTranslation('workspace')
  const rows: { keys: string; action: string }[] = [
    { keys: t('hotkeys.space'), action: t('hotkeys.spaceAction') },
  ]
  if (type === 'classification') {
    rows.push({ keys: t('hotkeys.digits'), action: t('hotkeys.digitsClass') })
  }
  if (type === 'mos') {
    rows.push({ keys: t('hotkeys.digits5'), action: t('hotkeys.digitsScore') })
  }
  if (type === 'sbs') {
    rows.push({ keys: t('hotkeys.digits5'), action: t('hotkeys.digitsPref') })
  }
  if (type === 'segmentation' || type === 'diarization') {
    rows.push({ keys: t('hotkeys.s'), action: t('hotkeys.sAction') })
    rows.push({
      keys: t('hotkeys.digits'),
      action: t(type === 'segmentation' ? 'hotkeys.digitsLabel' : 'hotkeys.digitsSpeaker'),
    })
  }
  return (
    <p className="ws-hotkeys lt-caption" aria-label={t('hotkeys.title')}>
      {rows.map((row) => (
        <span key={row.keys} className="ws-hotkeys__item">
          <kbd className="ws-kbd">{row.keys}</kbd> {row.action}
        </span>
      ))}
    </p>
  )
}

export function TaskWorkspace() {
  const { t } = useTranslation('workspace')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [audio, setAudio] = useState<AudioSource | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [instructionOpen, setInstructionOpen] = useState(true)

  const playerRef = useRef<AudioPlayerHandle>(null)
  /** Second player (Side-by-Side only): "Variant 2". */
  const playerBRef = useRef<AudioPlayerHandle>(null)
  /** Last active sbs player (1|2) — Space acts on it. */
  const activePlayerRef = useRef<1 | 2>(1)
  const taskRef = useRef<Task | null>(null)
  useEffect(() => {
    taskRef.current = phase.name === 'ready' ? phase.task : null
  })

  // ── Fetch task: /task/random WITHOUT params (no filters in the API yet) ─────
  const fetchTask = useCallback(async () => {
    setPhase({ name: 'loading' })
    setDraft(null)
    setAudio(null)
    try {
      const task = await api.tasks.random()
      setDraft(initDraft(task))
      setAudio({ url: task.fragment.audio_url, expiresAt: null })
      setPhase({ name: 'ready', task })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.detail === 'no_tasks_available') {
        setPhase({ name: 'empty' })
      } else {
        setPhase({ name: 'error', key: apiErrorKey(e) })
      }
    }
  }, [])

  useEffect(() => {
    void fetchTask()
  }, [fetchTask])

  // ── Presigned URL: "Refresh link" when expired ─────────────────────
  const refreshUrl = useCallback(() => {
    const task = taskRef.current
    if (!task) return
    void api.fragments
      .presigned(task.fragment.id)
      .then((p) => setAudio({ url: p.url, expiresAt: p.expires_at }))
      .catch((e: unknown) => {
        toast({ kind: 'error', message: t(apiErrorKey(e)) })
      })
  }, [toast, t])

  // ── Classes/speakers and regions for the player ────────────────────────────
  const options = useMemo(
    () =>
      phase.name === 'ready'
        ? regionOptions(phase.task, (n) => t('seg.speakerN', { n }))
        : [],
    [phase, t],
  )

  const waveRegions = useMemo<WaveRegion[]>(() => {
    if (draft?.kind !== 'regions') return []
    return draft.segments.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      color: options[s.labelIdx]?.color ?? FALLBACK_REGION_COLOR,
      content: options[s.labelIdx]?.name,
    }))
  }, [draft, options])

  const regionsMode = draft?.kind === 'regions'

  const onRegionCreate = useCallback((region: { id: string; start: number; end: number }) => {
    setDraft((prev) =>
      prev?.kind === 'regions'
        ? {
            ...prev,
            segments: [
              ...prev.segments,
              {
                id: region.id,
                start: round2(region.start),
                end: round2(region.end),
                labelIdx: prev.armedIdx,
              },
            ],
            activeId: region.id,
          }
        : prev,
    )
  }, [])

  const onRegionChange = useCallback((id: string, start: number, end: number) => {
    setDraft((prev) =>
      prev?.kind === 'regions'
        ? {
            ...prev,
            segments: prev.segments.map((s) =>
              s.id === id ? { ...s, start: round2(start), end: round2(end) } : s,
            ),
          }
        : prev,
    )
  }, [])

  const onRegionClick = useCallback((id: string) => {
    setDraft((prev) => (prev?.kind === 'regions' ? { ...prev, activeId: id } : prev))
  }, [])

  /** New segment at the current position (button and hotkey S). */
  const addSegmentAtCursor = useCallback(() => {
    const player = playerRef.current
    const task = taskRef.current
    if (!player || !task) return
    if (task.type !== 'segmentation' && task.type !== 'diarization') return
    const duration = player.duration()
    if (duration <= 0) return
    const start = Math.min(player.currentTime(), Math.max(0, duration - 0.1))
    const end = Math.min(start + Math.max(0.5, duration * 0.05), duration)
    const id = nextDraftId()
    setDraft((prev) =>
      prev?.kind === 'regions'
        ? {
            ...prev,
            segments: [
              ...prev.segments,
              { id, start: round2(start), end: round2(end), labelIdx: prev.armedIdx },
            ],
            activeId: id,
          }
        : prev,
    )
  }, [])

  // ── Hotkeys: Space / S / 1–9 ───────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable)

      if (e.code === 'Space') {
        // don't intercept for input fields and focused buttons/links
        if (editable || tag === 'BUTTON' || tag === 'A' || e.repeat) return
        e.preventDefault()
        // Side-by-Side: Space controls the LAST active player.
        const active =
          taskRef.current?.type === 'sbs' && activePlayerRef.current === 2
            ? playerBRef.current
            : playerRef.current
        active?.playPause()
        return
      }
      if (editable) return

      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        addSegmentAtCursor()
        return
      }

      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
      if (!digit) return
      const idx = Number(digit[1]) - 1
      const task = taskRef.current
      if (!task) return

      if (task.type === 'classification') {
        const labels = task.payload.labels
        if (idx >= labels.length) return
        e.preventDefault()
        setDraft((prev) =>
          prev?.kind === 'classification' ? { ...prev, selected: labels[idx].name } : prev,
        )
      } else if (task.type === 'mos') {
        // MOS: hotkeys 1–5 rate the ACTIVE scale (the first unrated one)
        // and move focus to the next unrated one (6–9 are ignored).
        if (idx >= 5) return
        e.preventDefault()
        setDraft((prev) => {
          if (prev?.kind !== 'mos') return prev
          const scales = task.payload.mos_scales
          const active = activeMosScale(scales, prev.scores)
          if (active === null) return prev
          const scores = { ...prev.scores, [active]: (idx + 1) as 1 | 2 | 3 | 4 | 5 }
          const next = activeMosScale(scales, scores)
          if (next !== null) {
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLElement>(`[data-mos-scale="${CSS.escape(next)}"]`)
                ?.focus()
            })
          }
          return { ...prev, scores }
        })
      } else if (task.type === 'sbs') {
        // Hotkeys 1–5 → preference scale left to right (-2..+2).
        if (idx >= 5) return
        e.preventDefault()
        setDraft((prev) =>
          prev?.kind === 'sbs' ? { ...prev, preference: SBS_PREFERENCES[idx] } : prev,
        )
      } else if (task.type === 'segmentation' || task.type === 'diarization') {
        e.preventDefault()
        setDraft((prev) => {
          if (prev?.kind !== 'regions') return prev
          const count =
            task.type === 'segmentation' ? task.payload.labels.length : task.payload.max_speakers
          if (idx >= count) return prev
          return {
            ...prev,
            armedIdx: idx,
            segments: prev.activeId
              ? prev.segments.map((s) => (s.id === prev.activeId ? { ...s, labelIdx: idx } : s))
              : prev.segments,
          }
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addSegmentAtCursor])

  // ── Submit + auto-advance to the next task ─────────────────────────────────
  const result =
    phase.name === 'ready' && draft ? buildResult(phase.task, draft, options) : null
  const invalidKey = phase.name === 'ready' && draft ? validationKey(phase.task, draft) : null

  async function submit() {
    if (phase.name !== 'ready' || !result) return
    setSubmitting(true)
    try {
      await api.tasks.submit(result)
      toast({ kind: 'ok', title: t('ws.submitted'), message: t('ws.nextTask') })
      setSubmitting(false)
      void fetchTask()
    } catch (e) {
      setSubmitting(false)
      toast({ kind: 'error', title: t('errors.submit'), message: t(apiErrorKey(e)) })
    }
  }

  // ── Screen states ──────────────────────────────────────────────────────────
  if (phase.name === 'loading') {
    return (
      <section className="lt-page ws-page ws-page--center">
        <Spinner size={32} label={tc('loading')} />
      </section>
    )
  }

  if (phase.name === 'empty') {
    return (
      <section className="lt-page ws-page">
        <EmptyState
          title={t('ws.noTasksTitle')}
          description={t('ws.noTasksDescription')}
          action={
            <div className="ws-actions">
              <Button variant="secondary" onClick={() => void fetchTask()}>
                {tc('actions.retry')}
              </Button>
              <Link to="/label" className="ws-back">
                {t('ws.toHub')}
              </Link>
            </div>
          }
        />
      </section>
    )
  }

  if (phase.name === 'error') {
    return (
      <section className="lt-page ws-page">
        <Banner
          kind="warning"
          action={
            <Button size="sm" variant="secondary" onClick={() => void fetchTask()}>
              {tc('actions.retry')}
            </Button>
          }
        >
          {t('errors.load')} {t(phase.key)}
        </Banner>
      </section>
    )
  }

  const { task } = phase

  return (
    <section className="lt-page ws-page">
      <header className="ws-head">
        <Link to="/label" className="ws-back">
          ← {t('ws.back')}
        </Link>
        <h1 className="ws-title">{tc(`taskTypes.${task.type}`)}</h1>
        <span className="ws-ctx">{task.project_name}</span>
        <span className="ws-ctx lt-data">{task.fragment.filename}</span>
        <span className="ws-head__spacer" />
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={instructionOpen}
          onClick={() => setInstructionOpen((v) => !v)}
        >
          {instructionOpen ? t('ws.instructionHide') : t('ws.instructionShow')}
        </Button>
      </header>

      <div className={`ws-layout${instructionOpen ? '' : ' ws-layout--full'}`}>
        <div className="ws-main">
          {task.type === 'sbs' ? (
            /* Side-by-Side: TWO players side by side (stacked on narrow); only
               variant numbers, WITHOUT system names (blind comparison). */
            <Card>
              <div className="ws-sbs-players">
                <div
                  className="ws-sbs-col"
                  onPointerDownCapture={() => (activePlayerRef.current = 1)}
                  onFocusCapture={() => (activePlayerRef.current = 1)}
                >
                  <span className="ws-sbs-col__label">{t('sbs.variant1')}</span>
                  <AudioPlayer key={`${task.id}-1`} ref={playerRef} src={task.payload.audio_url_1} />
                </div>
                <div
                  className="ws-sbs-col"
                  onPointerDownCapture={() => (activePlayerRef.current = 2)}
                  onFocusCapture={() => (activePlayerRef.current = 2)}
                >
                  <span className="ws-sbs-col__label">{t('sbs.variant2')}</span>
                  <AudioPlayer
                    key={`${task.id}-2`}
                    ref={playerBRef}
                    src={task.payload.audio_url_2}
                  />
                </div>
              </div>
              <HotkeysHint type={task.type} />
            </Card>
          ) : (
            <Card>
              <AudioPlayer
                key={task.id} /* new task — player from scratch (position, zoom) */
                ref={playerRef}
                src={audio?.url ?? null}
                expiresAt={audio?.expiresAt}
                onRefreshUrl={refreshUrl}
                regionsEnabled={regionsMode}
                regions={waveRegions}
                activeRegionId={draft?.kind === 'regions' ? draft.activeId : null}
                createColor={
                  draft?.kind === 'regions'
                    ? (options[draft.armedIdx]?.color ?? FALLBACK_REGION_COLOR)
                    : undefined
                }
                onRegionCreate={onRegionCreate}
                onRegionChange={onRegionChange}
                onRegionClick={onRegionClick}
              />
              <HotkeysHint type={task.type} />
            </Card>
          )}

          {draft?.kind === 'sbs' && (
            <SbsScale
              value={draft.preference}
              onSelect={(preference) => setDraft({ ...draft, preference })}
            />
          )}

          {draft?.kind === 'transcription' && (
            <TranscriptionEditor
              text={draft.text}
              onChange={(text) => setDraft({ ...draft, text })}
            />
          )}

          {draft?.kind === 'verification' && task.type === 'verification' && (
            <VerificationEditor
              text={task.payload.text}
              author={task.payload.author_fio}
              choice={draft.choice}
              corrected={draft.corrected}
              onChoice={(choice) => setDraft({ ...draft, choice })}
              onCorrected={(corrected) => setDraft({ ...draft, corrected })}
            />
          )}

          {draft?.kind === 'classification' && task.type === 'classification' && (
            <ClassificationEditor
              labels={task.payload.labels}
              selected={draft.selected}
              onSelect={(name) => setDraft({ ...draft, selected: name })}
            />
          )}

          {draft?.kind === 'mos' && task.type === 'mos' && (
            <MosEditor
              scales={task.payload.mos_scales}
              scores={draft.scores}
              activeName={activeMosScale(task.payload.mos_scales, draft.scores)}
              onRate={(scale, score) =>
                setDraft({ ...draft, scores: { ...draft.scores, [scale]: score } })
              }
            />
          )}

          {draft?.kind === 'regions' &&
            (task.type === 'segmentation' || task.type === 'diarization') && (
              <RegionsEditor
                mode={task.type}
                options={options}
                segments={draft.segments}
                activeId={draft.activeId}
                armedIdx={draft.armedIdx}
                onArm={(idx) =>
                  setDraft({
                    ...draft,
                    armedIdx: idx,
                    segments: draft.activeId
                      ? draft.segments.map((s) =>
                          s.id === draft.activeId ? { ...s, labelIdx: idx } : s,
                        )
                      : draft.segments,
                  })
                }
                onSelect={(id) => setDraft({ ...draft, activeId: id })}
                onSetLabel={(id, labelIdx) =>
                  setDraft({
                    ...draft,
                    segments: draft.segments.map((s) => (s.id === id ? { ...s, labelIdx } : s)),
                  })
                }
                onRemove={(id) =>
                  setDraft({
                    ...draft,
                    segments: draft.segments.filter((s) => s.id !== id),
                    activeId: draft.activeId === id ? null : draft.activeId,
                  })
                }
                onAdd={addSegmentAtCursor}
                onPlaySegment={(id) => playerRef.current?.playRegion(id)}
              />
            )}

          <div className="ws-actions">
            <Button
              onClick={() => void submit()}
              loading={submitting}
              disabled={!result}
            >
              {submitting ? t('ws.submitting') : t('ws.submit')}
            </Button>
            {/* Skip: not wired to POST /task/{id}/skip yet, so the button stays disabled */}
            <span className="ws-skip" title={t('ws.skipSoon')}>
              <Button variant="secondary" disabled title={t('ws.skipSoon')}>
                {t('ws.skip')}
              </Button>
            </span>
            {!result && invalidKey && (
              <span className="ws-validation lt-caption" role="status">
                {t(invalidKey)}
              </span>
            )}
          </div>
        </div>

        {instructionOpen && (
          <aside className="ws-aside" aria-label={t('ws.instruction')}>
            <Card title={t('ws.instruction')}>
              <div className="ws-instruction">
                {task.instruction || <span className="ws-muted">{t('ws.instructionEmpty')}</span>}
              </div>
            </Card>
          </aside>
        )}
      </div>
    </section>
  )
}
