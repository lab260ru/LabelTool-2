/**
 * Upload wizard helpers: client-side validation BEFORE upload,
 * duration reading via the Audio API, data formatting, CSV utilities,
 * manifest column mapping. All data — only through src/api/client.
 */
import type { ColumnMapping, ManifestPreview, UploadErrorReason } from '../../api/types'
import { api } from '../../api/client'

/** Format restriction: MP3 · WAV · FLAC · OGG. */
const AUDIO_EXT = /\.(mp3|wav|flac|ogg)$/i
/** Size restriction: up to 200 MB per file. */
const MAX_FILE_SIZE = 200 * 1024 * 1024

export const UPLOAD_ACCEPT = '.mp3,.wav,.flac,.ogg'
export const MANIFEST_ACCEPT = '.csv,.jsonl'
/** 4 parallel upload streams. */
export const PARALLEL_STREAMS = 4

/** File selected in the wizard (before/during upload). */
export interface LocalFile {
  clientId: string
  file: File
  filename: string
  size: number
  mime: string
  /** Duration in seconds; null — could not be read ("—"). */
  duration: number | null
}

/** Client-side file validation (step 2). */
export type FileValidity = 'ready' | 'duplicate' | 'unsupported' | 'too_large'

export function validityOf(
  item: Pick<LocalFile, 'filename' | 'size' | 'mime'>,
  existingNames: ReadonlySet<string>,
): FileValidity {
  const extOk = AUDIO_EXT.test(item.filename)
  const mimeOk =
    item.mime === '' ||
    item.mime.startsWith('audio/') ||
    item.mime === 'application/ogg' ||
    item.mime === 'video/ogg'
  if (!extOk || !mimeOk) return 'unsupported'
  if (item.size > MAX_FILE_SIZE) return 'too_large'
  if (existingNames.has(item.filename)) return 'duplicate'
  return 'ready'
}

/** File will be uploaded (a duplicate overwrites S3 — we warn but still upload). */
export const isUploadable = (v: FileValidity): boolean => v === 'ready' || v === 'duplicate'

/* ── Side-by-Side: client-side pair assembly ─────────────────────────────── */

/**
 * SBS: parse a pair variant name "<base>_a.<ext>" / "<base>_b.<ext>"
 * (case-insensitive, exactly the _a/_b suffix before the extension). The base
 * is compared case-insensitively. null — the name does not match the pair pattern.
 */
export function sbsPairKey(filename: string): { base: string; side: 'a' | 'b' } | null {
  const m = /^(.*)_([ab])\.(?:mp3|wav|flac|ogg)$/i.exec(filename)
  return m ? { base: m[1].toLowerCase(), side: m[2].toLowerCase() as 'a' | 'b' } : null
}

/** File status in an sbs upload: pair assembled / no pair / format-size defect. */
export type SbsFileStatus = 'paired' | 'unpaired' | 'unsupported' | 'too_large'

/**
 * Client-side pair assembly (the "Side-by-Side" contract, clause 4): pairs are
 * assembled by _a/_b suffixes on a shared base. Both files of a valid pair → 'paired';
 * a lone file or a name without a suffix → 'unpaired' (warning, not uploaded); a
 * format/size defect — its own status. Name duplicates are not flagged in sbs (the backend renames).
 */
export function sbsStatuses(
  files: Pick<LocalFile, 'clientId' | 'filename' | 'size' | 'mime'>[],
): Map<string, SbsFileStatus> {
  const out = new Map<string, SbsFileStatus>()
  const groups = new Map<string, { a?: string; b?: string }>()
  const noNames: ReadonlySet<string> = new Set()
  for (const f of files) {
    const v = validityOf(f, noNames)
    if (v === 'unsupported' || v === 'too_large') {
      out.set(f.clientId, v)
      continue
    }
    const key = sbsPairKey(f.filename)
    if (!key) {
      out.set(f.clientId, 'unpaired')
      continue
    }
    const g = groups.get(key.base) ?? {}
    g[key.side] = f.clientId
    groups.set(key.base, g)
  }
  for (const g of groups.values()) {
    const both = g.a !== undefined && g.b !== undefined
    for (const side of ['a', 'b'] as const) {
      const cid = g[side]
      if (cid !== undefined) out.set(cid, both ? 'paired' : 'unpaired')
    }
  }
  return out
}

/**
 * Uploadable units of an sbs batch — pair representatives (the variant A file of each
 * assembled pair). The backend creates ONE fragment per pair; it derives the variant B
 * name by replacing the suffix.
 */
export function sbsUploadable(files: LocalFile[]): LocalFile[] {
  const statuses = sbsStatuses(files)
  return files.filter(
    (f) => statuses.get(f.clientId) === 'paired' && sbsPairKey(f.filename)?.side === 'a',
  )
}

/** Per-file state at step 4. */
export type RunStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface RunState {
  status: RunStatus
  /** 0..100. */
  progress: number
  errorReason: UploadErrorReason | null
  failedAtPct: number | null
}

export const queuedRun = (): RunState => ({
  status: 'queued',
  progress: 0,
  errorReason: null,
  failedAtPct: null,
})

/** Row in the error block at step 5. */
export interface FailedRow {
  filename: string
  reason: UploadErrorReason | 'invalid_row'
  failedAtPct: number | null
}

/** Wizard summary (step 5) — from client-side state (files) or the backend response (manifest). */
export interface WizardSummary {
  source: 'files' | 'manifest'
  total: number
  uploaded: number
  failed: FailedRow[]
  errorRowsUrl: string | null
}

/* ── Duration via the Audio API ──────────────────────────────────────────── */

/** Reads the duration from <audio> metadata; null — if the file cannot be read. */
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 7000)
    audio.onloadedmetadata = () => {
      const d = audio.duration
      finish(Number.isFinite(d) && d >= 0 ? d : null)
    }
    audio.onerror = () => finish(null)
    audio.src = url
  })
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** "2:05", "1:02:18"; null → "—". */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export interface ByteUnits {
  b: string
  kb: string
  mb: string
  gb: string
}

/** "1,9 МБ" (ru) / "1.9 MB" (en) — the locale decides the separator. */
export function formatBytes(bytes: number, locale: string, units: ByteUnits): string {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (bytes < 1024) return `${nf.format(bytes)} ${units.b}`
  const kb = bytes / 1024
  if (kb < 1024) return `${nf.format(kb)} ${units.kb}`
  const mb = kb / 1024
  if (mb < 1024) return `${nf.format(mb)} ${units.mb}`
  return `${nf.format(mb / 1024)} ${units.gb}`
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */

/** Minimal CSV parser: quotes, "" escaping and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const pushRow = () => {
    row.push(cell)
    cell = ''
    if (row.length > 1 || row[0].trim() !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else {
      cell += ch
    }
  }
  pushRow()
  return rows
}

const csvEscape = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)

/** CSV "error rows" — built on the client. */
export function failedRowsCsv(failed: FailedRow[]): string {
  const lines = failed.map((f) =>
    [csvEscape(f.filename), f.reason, f.failedAtPct === null ? '' : String(f.failedAtPct)].join(','),
  )
  return ['filename,reason,failed_at_pct', ...lines, ''].join('\n')
}

/** Client-side text file download. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/* ── Project fragment names (duplicate check via client) ─────────────────── */

/** Collects names of already-uploaded project fragments (paginated). */
export async function loadExistingFilenames(projectId: number): Promise<Set<string>> {
  const names = new Set<string>()
  const limit = 500
  let offset = 0
  // Guard against an infinite loop — no more than 40 pages (20k names).
  for (let page = 0; page < 40; page++) {
    const res = await api.fragments.list(projectId, { offset, limit })
    for (const f of res.items) names.add(f.filename)
    offset += res.items.length
    if (res.items.length === 0 || offset >= res.total) break
  }
  return names
}

/* ── Manifest column mapping (tab 2) ──────────────────────────────── */

export type ColumnTarget =
  | 'filename'
  | 'filename_a'
  | 'filename_b'
  | 'task_type'
  | 'orig_trb'
  | 'metadata'
  | 'skip'

export const COLUMN_TARGETS: readonly ColumnTarget[] = [
  'filename',
  'task_type',
  'orig_trb',
  'metadata',
  'skip',
]

/** SBS: the manifest carries a filename_a/filename_b pair (no task_type/orig_trb). */
export const SBS_COLUMN_TARGETS: readonly ColumnTarget[] = [
  'filename_a',
  'filename_b',
  'metadata',
  'skip',
]

/** Targets that only one column can carry (regular + sbs mode). */
export const UNIQUE_TARGETS: readonly ColumnTarget[] = [
  'filename',
  'filename_a',
  'filename_b',
  'task_type',
  'orig_trb',
]

/** Target list for the current project mode. */
export const columnTargetsFor = (isSbs: boolean): readonly ColumnTarget[] =>
  isSbs ? SBS_COLUMN_TARGETS : COLUMN_TARGETS

/** Initial column assignments from the preview's suggested_mapping. */
export function targetsFromSuggested(
  preview: ManifestPreview,
  isSbs = false,
): Record<string, ColumnTarget> {
  const targets: Record<string, ColumnTarget> = {}
  for (const col of preview.columns) targets[col] = 'skip'
  // For sbs there are no filename_a/filename_b suggestions — the admin assigns them manually.
  if (isSbs) return targets
  const m = preview.suggested_mapping
  if (m.filename && m.filename in targets) targets[m.filename] = 'filename'
  if (m.task_type && m.task_type in targets) targets[m.task_type] = 'task_type'
  if (m.orig_trb && m.orig_trb in targets) targets[m.orig_trb] = 'orig_trb'
  for (const col of Object.values(m.metadata)) {
    if (col in targets && targets[col] === 'skip') targets[col] = 'metadata'
  }
  return targets
}

/**
 * Builds a ColumnMapping. A regular project needs a filename column; sbs —
 * a filename_a + filename_b pair. null — required columns are not assigned.
 */
export function buildMapping(
  columns: string[],
  targets: Record<string, ColumnTarget>,
  isSbs = false,
): ColumnMapping | null {
  const metadata: Record<string, string> = {}
  for (const c of columns) if (targets[c] === 'metadata') metadata[c] = c
  if (isSbs) {
    const filenameA = columns.find((c) => targets[c] === 'filename_a')
    const filenameB = columns.find((c) => targets[c] === 'filename_b')
    if (!filenameA || !filenameB) return null
    return {
      filename: '',
      task_type: null,
      orig_trb: null,
      filename_a: filenameA,
      filename_b: filenameB,
      metadata,
    }
  }
  const filename = columns.find((c) => targets[c] === 'filename')
  if (!filename) return null
  return {
    filename,
    task_type: columns.find((c) => targets[c] === 'task_type') ?? null,
    orig_trb: columns.find((c) => targets[c] === 'orig_trb') ?? null,
    metadata,
  }
}
