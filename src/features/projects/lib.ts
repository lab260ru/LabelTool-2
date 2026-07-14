// Helpers for the "Projects" feature: formatting and class presets.
import type { LabelClass, MosLabelKey, MosScale, TaskType } from '../../api/types'

/**
 * Minimum required label_list classes per task type (0 — labels are not used):
 * classification — at least 2 classes (otherwise the choice is meaningless),
 * segmentation — at least 1 segment label; the other types do not use label_list.
 */
export const MIN_LABELS: Record<TaskType, number> = {
  transcription: 0,
  verification: 0,
  classification: 2,
  segmentation: 1,
  diarization: 0,
  mos: 0,
  sbs: 0,
}

/** Whether class labels are used by this task type. */
export function typeUsesLabels(taskType: TaskType): boolean {
  return MIN_LABELS[taskType] > 0
}

/** Duration mm:ss; null — "—" (duration could not be read). */
export function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Size in MB with one decimal (localized separator: 1,9 / 1.9). */
export function formatMb(bytes: number, locale: string): string {
  return (bytes / (1024 * 1024)).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export type PresetVariant = 'speech' | 'music' | 'noise' | 'silence'

/**
 * Class presets: speech — lavender, music — coral,
 * noise — gray, silence — violet-light. HEX is label_list data returned by
 * the backend; chips are rendered via ClassChip variants on theme tokens.
 */
export const PRESET_CLASSES: readonly { key: PresetVariant; color: string }[] = [
  { key: 'speech', color: '#D9D4F7' },
  { key: 'music', color: '#E8604C' },
  { key: 'noise', color: '#8E95A5' },
  { key: 'silence', color: '#B9AFF3' },
]

/** ClassChip variant for a preset color; a custom color — undefined. */
export function variantForColor(color: string): PresetVariant | undefined {
  return PRESET_CLASSES.find((p) => p.color.toLowerCase() === color.toLowerCase())?.key
}

/**
 * Fragment status for the fragment browser (consensus):
 * "Done" — finished from the backend (tasks_done >= tasks_required, K = the
 * project's consensus_overlap); "in progress" — part of the K tasks submitted
 * (0 < tasks_done < required).
 */
export type FragmentStatus = 'finished' | 'in_progress' | 'queued'

export function fragmentStatus(f: { finished: boolean; tasks_done: number }): FragmentStatus {
  if (f.finished) return 'finished'
  return f.tasks_done > 0 ? 'in_progress' : 'queued'
}

/** Whether the list has a class with this name (case/whitespace-insensitive). */
export function hasLabelName(list: LabelClass[], name: string): boolean {
  const needle = name.trim().toLowerCase()
  return list.some((l) => l.name.trim().toLowerCase() === needle)
}

// ── Customizable MOS scales (editor in the project form) ─────────────────────

export const MOS_LABEL_KEYS: readonly MosLabelKey[] = ['1', '2', '3', '4', '5']

/** Contract bounds: a mos project has from 1 to 5 scales. */
export const MIN_MOS_SCALES = 1
export const MAX_MOS_SCALES = 5

/**
 * A scale draft in the editor: id — a local React key (names may coincide while
 * typing), labels — all 5 points ('' = default label).
 */
export interface MosScaleDraft {
  id: number
  name: string
  labels: Record<MosLabelKey, string>
}

let mosDraftSeq = 0

const emptyLabels = (): Record<MosLabelKey, string> => ({
  '1': '',
  '2': '',
  '3': '',
  '4': '',
  '5': '',
})

/** A new empty scale draft (the caller supplies the name). */
export function newMosScaleDraft(name = ''): MosScaleDraft {
  mosDraftSeq += 1
  return { id: mosDraftSeq, name, labels: emptyLabels() }
}

/** Project.mos_scales → editor drafts (missing labels → ''). */
export function toMosScaleDrafts(scales: MosScale[] | null | undefined): MosScaleDraft[] {
  if (!scales || scales.length === 0) return [newMosScaleDraft()]
  return scales.map((s) => {
    const draft = newMosScaleDraft(s.name)
    if (s.labels) {
      for (const k of MOS_LABEL_KEYS) draft.labels[k] = s.labels[k] ?? ''
    }
    return draft
  })
}

/**
 * Drafts → MosScale[] for the API. Labels: if all 5 are empty, labels are
 * omitted (defaults are localized on the frontend and not stored in the data);
 * if at least one is filled, the full set is sent and empty ones are filled in
 * with localized defaults (defaultLabel), i.e. fixed as custom.
 */
export function mosScaleDraftsToScales(
  drafts: MosScaleDraft[],
  defaultLabel: (key: MosLabelKey) => string,
): MosScale[] {
  return drafts.map((d) => {
    const scale: MosScale = { name: d.name.trim() }
    if (MOS_LABEL_KEYS.some((k) => d.labels[k].trim() !== '')) {
      scale.labels = Object.fromEntries(
        MOS_LABEL_KEYS.map((k) => [k, d.labels[k].trim() || defaultLabel(k)]),
      ) as Record<MosLabelKey, string>
    }
    return scale
  })
}

/**
 * Reason a scale set is invalid: 'name' — there is an empty name,
 * 'dup' — names are not unique (case/whitespace-insensitive), null — ok.
 */
export function mosScaleDraftsProblem(drafts: MosScaleDraft[]): 'name' | 'dup' | null {
  if (drafts.some((d) => d.name.trim() === '')) return 'name'
  const names = drafts.map((d) => d.name.trim().toLowerCase())
  return new Set(names).size !== names.length ? 'dup' : null
}

/** Whether the scale sets match (name + all labels) — to avoid an extra PATCH. */
export function sameMosScales(a: MosScale[], b: MosScale[] | null | undefined): boolean {
  if (!b || a.length !== b.length) return false
  return a.every((sa, i) => {
    const sb = b[i]
    if (sa.name !== sb.name) return false
    if (sa.labels === undefined || sb.labels === undefined) {
      return sa.labels === undefined && sb.labels === undefined
    }
    return MOS_LABEL_KEYS.every((k) => sa.labels?.[k] === sb.labels?.[k])
  })
}
