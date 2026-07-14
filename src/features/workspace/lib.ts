/**
 * Labeling draft model: editor state by task type,
 * mapping into LabelingResult and workspace utilities.
 */
import { ApiError } from '../../api/client'
import type {
  LabelClass,
  LabelingResult,
  MosScale,
  MosScore,
  SbsPreference,
  Task,
} from '../../api/types'

/** Segment on the waveform (segmentation/diarization): labelIdx — index into options. */
export interface RegionDraft {
  id: string
  start: number
  end: number
  labelIdx: number
}

export type VerificationChoice = 'yes' | 'no' | 'fix'

/** Draft of the current task — source of truth for the editor and the player regions. */
export type Draft =
  | { kind: 'transcription'; text: string }
  | { kind: 'verification'; choice: VerificationChoice | null; corrected: string }
  | { kind: 'classification'; selected: string | null }
  | { kind: 'regions'; segments: RegionDraft[]; activeId: string | null; armedIdx: number }
  /** MOS: project scale name → chosen score (partial, until all are rated). */
  | { kind: 'mos'; scores: Record<string, MosScore> }
  /** Side-by-Side: preference in terms of the shown order (null — not chosen). */
  | { kind: 'sbs'; preference: SbsPreference | null }

export function initDraft(task: Task): Draft {
  switch (task.type) {
    case 'transcription':
      return { kind: 'transcription', text: task.payload.orig_trb ?? '' }
    case 'verification':
      // corrected is prefilled with the original text — "Fix" edits it
      return { kind: 'verification', choice: null, corrected: task.payload.text }
    case 'classification':
      return { kind: 'classification', selected: null }
    case 'segmentation':
    case 'diarization':
      return { kind: 'regions', segments: [], activeId: null, armedIdx: 0 }
    case 'mos':
      return { kind: 'mos', scores: {} }
    case 'sbs':
      return { kind: 'sbs', preference: null }
  }
}

/**
 * The active MOS scale — the first unrated one (in project scale order):
 * the editor highlights it (aria-current) and the 1–5 hotkeys act on it.
 * null — all scales are rated.
 */
export function activeMosScale(
  scales: MosScale[],
  scores: Record<string, MosScore>,
): string | null {
  return scales.find((s) => scores[s.name] === undefined)?.name ?? null
}

/**
 * Speaker palette for diarization — brand palette tones (violet, violet-light,
 * gray; coral — last, sparingly ≤10%).
 */
export const SPEAKER_COLORS = ['#6d5ae6', '#b9aff3', '#8e95a5', '#e8604c'] as const

/** Region color when the label is not found (= --violet). */
export const FALLBACK_REGION_COLOR = '#6d5ae6'

/**
 * Classes/speakers for the center zone and regions:
 * segmentation — the project's label_list, diarization — "Speaker 1..N".
 */
export function regionOptions(task: Task, speakerName: (n: number) => string): LabelClass[] {
  if (task.type === 'segmentation') return task.payload.labels
  if (task.type === 'diarization') {
    return Array.from({ length: Math.max(1, task.payload.max_speakers) }, (_, i) => ({
      name: speakerName(i + 1),
      color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
    }))
  }
  return []
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

let draftIdSeq = 0

/** Local id of a segment created by the button/hotkey S. */
export function nextDraftId(): string {
  draftIdSeq += 1
  return `seg-${Date.now().toString(36)}-${draftIdSeq}`
}

/** Draft → result for POST /task/{id}/submit; null — nothing to submit. */
export function buildResult(task: Task, draft: Draft, options: LabelClass[]): LabelingResult | null {
  switch (draft.kind) {
    case 'transcription': {
      const text = draft.text.trim()
      return text ? { task_id: task.id, type: 'transcription', text } : null
    }
    case 'verification': {
      if (draft.choice === 'yes') {
        return { task_id: task.id, type: 'verification', verdict: 'approve', corrected_text: null }
      }
      if (draft.choice === 'no') {
        return { task_id: task.id, type: 'verification', verdict: 'reject', corrected_text: null }
      }
      if (draft.choice === 'fix') {
        const corrected = draft.corrected.trim()
        // "Fix" = the original text is wrong (reject) + the correct version
        return corrected
          ? { task_id: task.id, type: 'verification', verdict: 'reject', corrected_text: corrected }
          : null
      }
      return null
    }
    case 'classification':
      return draft.selected
        ? { task_id: task.id, type: 'classification', labels: [draft.selected] }
        : null
    case 'mos': {
      // MOS: {scores} result per-scale — "Submit" is enabled when ALL project
      // scales are rated; keys are collected in payload scale order.
      if (task.type !== 'mos') return null
      const scales = task.payload.mos_scales
      if (scales.length === 0 || scales.some((s) => draft.scores[s.name] === undefined)) {
        return null
      }
      return {
        task_id: task.id,
        type: 'mos',
        scores: Object.fromEntries(scales.map((s) => [s.name, draft.scores[s.name]])),
      }
    }
    case 'sbs':
      // The preference is submitted IN TERMS OF THE SHOWN order (contract clause 6);
      // the backend normalizes for the swap.
      return draft.preference !== null
        ? { task_id: task.id, type: 'sbs', preference: draft.preference }
        : null
    case 'regions': {
      if (draft.segments.length === 0) return null
      const ordered = [...draft.segments].sort((a, b) => a.start - b.start)
      if (task.type === 'segmentation') {
        return {
          task_id: task.id,
          type: 'segmentation',
          segments: ordered.map((s) => ({
            start_sec: round2(s.start),
            end_sec: round2(s.end),
            label: options[s.labelIdx]?.name ?? '',
          })),
        }
      }
      if (task.type === 'diarization') {
        return {
          task_id: task.id,
          type: 'diarization',
          segments: ordered.map((s) => ({
            start_sec: round2(s.start),
            end_sec: round2(s.end),
            speaker: options[s.labelIdx]?.name ?? '',
          })),
        }
      }
      return null
    }
  }
}

/** Why submitting is unavailable (i18n key in namespace 'workspace') or null. */
export function validationKey(task: Task, draft: Draft): string | null {
  switch (draft.kind) {
    case 'transcription':
      return draft.text.trim() ? null : 'tr.required'
    case 'verification':
      if (draft.choice === 'fix') return draft.corrected.trim() ? null : 'ver.required'
      return draft.choice ? null : 'ver.required'
    case 'classification':
      if (task.type === 'classification' && task.payload.labels.length === 0) return 'cls.noLabels'
      return draft.selected ? null : 'cls.required'
    case 'regions':
      return draft.segments.length > 0 ? null : 'seg.required'
    case 'mos': {
      if (task.type !== 'mos') return 'mos.required'
      const scales = task.payload.mos_scales
      return scales.length > 0 && activeMosScale(scales, draft.scores) === null
        ? null
        : 'mos.required'
    }
    case 'sbs':
      return draft.preference !== null ? null : 'sbs.required'
  }
}

/**
 * API error → message key (namespace 'workspace').
 * The client does no silent session refresh — 401 is shown explicitly.
 */
export function apiErrorKey(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'errors.session'
    if (e.status === 0) return 'errors.network'
  }
  return 'errors.generic'
}
