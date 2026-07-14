// Domain types of LabelTool 2.
// All backend responses must conform to these types.
// IMPORTANT: the server returns only machine-readable codes (error_reason,
// detail, etc.) — human-readable strings are produced by the UI via i18n (ru/en).

// ── Base ─────────────────────────────────────────────────────────────────────

/**
 * Labeling task types (including MOS scoring and Side-by-Side).
 */
export type TaskType =
  | 'transcription'
  | 'verification'
  | 'classification'
  | 'segmentation'
  | 'diarization'
  | 'mos'
  | 'sbs';

/** Full list of task types — for iteration, filters, permission matrix. */
export const TASK_TYPES: readonly TaskType[] = [
  'transcription',
  'verification',
  'classification',
  'segmentation',
  'diarization',
  'mos',
  'sbs',
];

/** MOS score (Mean Opinion Score): subjective audio quality 1–5. */
export type MosScore = 1 | 2 | 3 | 4 | 5;

/** MOS items — for iterating over workspace buttons/hotkeys. */
export const MOS_SCORES: readonly MosScore[] = [1, 2, 3, 4, 5];

/** Key of a MOS item in the labels of a customizable scale ('1'..'5'). */
export type MosLabelKey = '1' | '2' | '3' | '4' | '5';

/**
 * Customizable scale of a MOS project: the scale itself is always 1–5 (MOS
 * standard); the scale name and item labels are configurable. labels are
 * optional — without them the frontend shows localized defaults (1 bad ·
 * 2 poor · 3 acceptable · 4 good · 5 excellent); only custom ones are stored in data.
 */
export interface MosScale {
  name: string;
  labels?: Record<MosLabelKey, string>;
}

/**
 * Side-by-Side (sbs): preference on a 5-point scale IN TERMS OF THE SHOWN
 * order (-2 — "Variant 1 is much better", 0 — equal, +2 — "Variant 2
 * is much better"). On submit the backend normalizes by Task.swap and stores
 * the result in terms of SYSTEMS (minus = A better, plus = B better).
 */
export type SbsPreference = -2 | -1 | 0 | 1 | 2;

/** Preference-scale items — for iterating over buttons/hotkeys 1–5. */
export const SBS_PREFERENCES: readonly SbsPreference[] = [-2, -1, 0, 1, 2];

/**
 * Names of the compared systems of an sbs project (e.g., two TTS engines).
 * Visible ONLY to the admin (project card/page, export) — NEVER shown to the
 * annotator (blind comparison).
 */
export interface SbsSystems {
  a: string;
  b: string;
}

export type Role = 'user' | 'admin';

/** Paginated response of list endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/** API error body: { detail: 'machine_readable_code' }. */
export interface ApiErrorBody {
  detail: string;
}

// ── Project ──────────────────────────────────────────────────────────────────

/** Labeling class (chip) and its color. */
export interface LabelClass {
  name: string;
  color: string;
}

export interface ProjectParticipant {
  user_id: number;
  fio: string;
  group: string | null;
}

/** Project counters/progress. */
export interface ProjectCounters {
  fragments_total: number;
  fragments_labeled: number;
  fragments_in_progress: number;
  zombie_tasks: number;
  /** 0..100, rounded completion percentage. */
  progress_pct: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  /** Instruction for the annotator, markdown/plain text. */
  instruction: string;
  label_list: LabelClass[];
  participants: ProjectParticipant[];
  /**
   * Single task type of the project (chosen at creation, applies to all
   * fragments; fragments inherit it automatically). Changing it while
   * fragments exist is forbidden: 409 detail='project_has_fragments'.
   */
  task_type: TaskType;
  /**
   * Consensus: how many DIFFERENT annotators must label each fragment
   * (1..5). 1 — no consensus (a single done task closes the fragment), 2–3 —
   * typical consensus: K open tasks are created per fragment, the reference
   * is assembled by majority. Changing the value on an existing project is
   * allowed and recomputes the open tasks (done/in_progress are left untouched).
   */
  consensus_overlap: number;
  /**
   * MOS scoring scales — only for task_type='mos', null for other types.
   * When creating a mos project without explicit scales the backend sets the
   * default [{name: 'Качество звучания'}]. Validation: 1..5 scales, names
   * non-empty and unique (422 detail='bad_mos_scales'). Changing scales is
   * allowed as long as the project has no done tasks (409 detail='project_has_results').
   */
  mos_scales: MosScale[] | null;
  /**
   * Names of the compared systems — only for task_type='sbs', null for other
   * types. When creating an sbs project without explicit names the backend
   * sets the default {a: 'Система A', b: 'Система B'}. Visible only to the
   * admin — never shown to the annotator (blind comparison).
   */
  sbs_systems: SbsSystems | null;
  /** Task types occurring in the project (with the single model = [task_type]). */
  task_types: TaskType[];
  counters: ProjectCounters;
  created_at: string;
}

/** Project progress as a separate endpoint. */
export interface ProjectProgress extends ProjectCounters {
  project_id: number;
}

/** Agreement metrics for the project. */
export interface AgreementStats {
  project_id: number;
  avg_agreement_pct: number;
  per_type: { task_type: TaskType; agreement_pct: number }[];
}

// ── Audio fragment ───────────────────────────────────────────────────

export interface AudioFragment {
  id: number;
  project_id: number;
  filename: string;
  /** null — duration could not be read (shown as «—» in the list). */
  duration_sec: number | null;
  size_bytes: number;
  task_type: TaskType;
  /** ASR draft, shown to the annotator. */
  orig_trb: string | null;
  /** key-value metadata of the batch/fragment. */
  metadata: Record<string, string>;
  /**
   * Side-by-Side: PAIR fragment. The *_b fields are filled only in sbs projects
   * (the regular filename/size/duration/audio_url = variant A, *_b = variant B);
   * null for other types.
   */
  filename_b: string | null;
  duration_sec_b: number | null;
  size_bytes_b: number | null;
  /** URL of variant B (presigned S3 URL); null outside sbs. */
  audio_url_b: string | null;
  /** Labeling complete: tasks_done >= tasks_required (consensus assembled). */
  finished: boolean;
  /** Legacy alias of tasks_done (how many tasks for the fragment are submitted). */
  task_count: number;
  /** How many done tasks for the fragment are submitted. */
  tasks_done: number;
  /** How many done tasks are needed for completion (= project's consensus_overlap). */
  tasks_required: number;
  /** URL for playback (presigned S3 URL). */
  audio_url: string;
  /**
   * Data source (S3Source.id). null/absent — the object lives in the app's
   * storage (like a regular upload); otherwise the fragment REFERENCES an
   * object in the source bucket (reference-in-place), presigned is generated
   * against the source.
   */
  source_id?: number | null;
}

/** Presigned URL for playback. */
export interface PresignedUrl {
  url: string;
  expires_at: string;
}

// ── S3 data sources (reference-in-place) ─────────────────────────────────────

/**
 * Project data source: an S3/MinIO bucket from which audio is imported
 * WITHOUT copying bytes — fragments merely reference the source's objects, and
 * the presigned URL is generated against it. In API responses secret_key is
 * NEVER returned (it is the user's infrastructure config, write-only).
 */
export interface S3Source {
  id: number;
  project_id: number;
  name: string;
  endpoint_url: string;
  bucket: string;
  /** Object prefix (may be '' — the whole bucket). */
  prefix: string;
  /** Region (nullable — usually not set for MinIO). */
  region: string | null;
  /** path-style addressing (bucket in the path, not in the subdomain) — for MinIO. */
  path_style: boolean;
  created_at: string;
  /** Number of audio objects under prefix, if the backend counted during listing. */
  object_count?: number;
}

/**
 * POST request body for creating a source — a separate type with secrets
 * (access_key/secret_key). secret_key is sent to the server only on creation and
 * is NEVER returned back (see S3Source).
 */
export interface S3SourceCreate {
  name: string;
  endpoint_url: string;
  bucket: string;
  /** Object prefix (default '' — the whole bucket). */
  prefix?: string;
  access_key: string;
  secret_key: string;
  region?: string | null;
  /** Default true (MinIO). */
  path_style?: boolean;
}

/**
 * Preview of the source listing (POST …/preview): objects under prefix,
 * filtered by audio extensions (mp3/wav/flac/ogg).
 */
export interface S3PreviewResult {
  /** Total audio objects under prefix (actual or up to the cap of 10000). */
  total_audio: number;
  /** Up to 20 sample keys. */
  sample: string[];
  /** How many objects are already imported into the project (for sbs — pairs). */
  already_imported: number;
  /** How many new objects/pairs remain to import. */
  to_import: number;
  /** true — the listing reached the cap (total_audio is incomplete). */
  truncated?: boolean;
  /** Side-by-Side: number of complete _a/_b pairs under prefix. */
  pairs?: number;
  /** Side-by-Side: number of unpaired audio objects (will not be imported). */
  unpaired?: number;
}

/** Result of importing from a source (POST …/import). Idempotent by the project's keys. */
export interface S3ImportResult {
  /** How many fragments were created (for sbs — one per pair). */
  imported: number;
  /** How many objects/pairs were skipped as already imported. */
  skipped: number;
  /** Side-by-Side: how many unpaired objects were skipped. */
  unpaired?: number;
}

// ── Users and permissions ────────────────────────────────────────────────────

/**
 * Permission for a task type (permission matrix):
 *  - user_allow / user_block — set by the user themselves;
 *  - admin_allow / admin_block — forced by the admin (read-only for the user).
 */
export type PermissionValue = 'user_allow' | 'user_block' | 'admin_allow' | 'admin_block';

export type TaskPermissions = Record<TaskType, PermissionValue>;

export interface UserMetrics {
  tasks_done: number;
  tasks_skipped: number;
  avg_task_sec: number;
  agreement_pct: number;
  last_active_at: string | null;
}

export interface User {
  id: number;
  fio: string;
  login: string;
  role: Role;
  /** Super-admin: can grant/revoke admin rights. */
  can_add_admins: boolean;
  /** Study group (for students), null for admins. */
  group: string | null;
  metrics: UserMetrics;
  permissions: TaskPermissions;
}

export interface LoginRequest {
  login: string;
  password: string;
}

/**
 * Public self-registration of an annotator (POST /auth/register): creates
 * a user of role 'user' and auto-logs in. group is optional (study group).
 * Server validation: fio non-empty (400 'fio_required'); login [a-zA-Z0-9._-]{3,}
 * (400 'bad_login'), unique (409 'login_taken'); password ≥ 8 (400 'password_too_short').
 */
export interface RegisterRequest {
  fio: string;
  login: string;
  password: string;
  group?: string | null;
}

export type CreateUserRequest = {
  fio: string;
  login: string;
  password?: string;
  role?: Role;
  group?: string | null;
  permissions?: Partial<TaskPermissions>;
};

export type UpdateUserRequest = Partial<{
  fio: string;
  login: string;
  group: string | null;
  role: Role;
  permissions: Partial<TaskPermissions>;
}>;

export type InviteUsersRequest = {
  logins: string[];
  group: string | null;
};

export interface InviteUsersResult {
  invited: number;
  users: User[];
}

// ── Upload ───────────────────────────────────────────────────────────

/**
 * File status in the upload wizard:
 *  ready — passed client validation; duplicate — the name already exists in the project;
 *  unsupported — format outside MP3/WAV/FLAC/OGG; queued/uploading/done/error — step 4.
 */
export type UploadItemStatus =
  | 'ready'
  | 'duplicate'
  | 'unsupported'
  | 'queued'
  | 'uploading'
  | 'done'
  | 'error';

/**
 * Machine-readable upload error reasons. Correspondence to prototype strings (i18n in the UI):
 *  s3_timeout → "S3 unavailable (timeout)"; network_failure → "Network failure at N%"
 *  (N — failed_at_pct); unsupported_format → "Unsupported format";
 *  file_too_large → "File over 200 MB"; cancelled → "Cancelled";
 *  duplicate_name → file reject in conflict='reject' mode.
 */
export type UploadErrorReason =
  | 's3_timeout'
  | 'network_failure'
  | 'unsupported_format'
  | 'file_too_large'
  | 'cancelled'
  | 'duplicate_name'
  /** Side-by-Side: a file without a <base>_a/<base>_b pair — is not uploaded. */
  | 'unpaired';

export interface UploadItem {
  /** Client id (generated by the UI before the session is created). */
  client_id: string;
  filename: string;
  /** Size in bytes. */
  size: number;
  /** Duration in seconds; null — could not be read. */
  duration: number | null;
  status: UploadItemStatus;
  /** 0..100 — file upload progress. */
  progress: number;
  error_reason: UploadErrorReason | null;
}

export interface UploadFileMeta {
  client_id: string;
  filename: string;
  size: number;
  duration: number | null;
}

/**
 * Name-conflict resolution mode in the project (no silent overwrite):
 *  rename (default) — the file is saved under a new name «name (2).ext»;
 *  reject — per-file error error_reason='duplicate_name'.
 */
export type UploadConflictMode = 'reject' | 'rename';

export interface UploadSessionRequest {
  project_id: number;
  /** key-value metadata for the whole batch. */
  metadata: Record<string, string>;
  /** ASR hints: client_id → text. */
  orig_trb: Record<string, string>;
  /** ASR hint in bulk — for files without a per-file value. */
  orig_trb_all?: string | null;
  /** Name dedup: default 'rename'. */
  conflict?: UploadConflictMode;
  files: UploadFileMeta[];
}

export interface UploadSessionInfo {
  session_id: string;
  /** File names already existing in the project (conflict banner). */
  duplicates: string[];
  /** File names with an unsupported format (server validation). */
  unsupported: string[];
}

export interface UploadFileResult {
  client_id: string;
  ok: boolean;
  /** id of the created fragment on success. */
  fragment_id: number | null;
  error_reason: UploadErrorReason | null;
  /** For network_failure — at what percent it aborted (e.g. 82). */
  failed_at_pct: number | null;
}

export interface UploadFailedRow {
  client_id: string;
  filename: string;
  reason: UploadErrorReason | 'invalid_row';
}

export interface UploadSummary {
  project_id: number;
  /** Task type of the batch — inherited from the project (Project.task_type). */
  task_type: TaskType;
  total: number;
  uploaded: number;
  failed: UploadFailedRow[];
  /** CSV with manifest error rows ("Download error rows"), otherwise null. */
  error_rows_url: string | null;
}

// ── CSV/JSONL manifest (tab 2) ────────────────────────────────────────

export interface ManifestRow {
  /** Row number in the source file (from 1). */
  index: number;
  /** Values by columns of the source file. */
  cells: Record<string, string>;
  valid: boolean;
  /** Row error code (e.g. 'empty_orig_trb', 'missing_file') or null. */
  error: string | null;
}

/** Manifest column mapping: target field → source column name. */
export interface ColumnMapping {
  filename: string;
  task_type: string | null;
  orig_trb: string | null;
  /**
   * Side-by-Side: columns for the pair variants' names (only sbs projects). In
   * sbs the manifest carries filename_a/filename_b instead of a single filename/orig_trb.
   */
  filename_a?: string | null;
  filename_b?: string | null;
  /** Metadata key → source column. */
  metadata: Record<string, string>;
}

export interface ManifestPreview {
  filename: string;
  columns: string[];
  /** First rows for preview. */
  rows: ManifestRow[];
  total_rows: number;
  valid_count: number;
  error_count: number;
  suggested_mapping: ColumnMapping;
}

// ── Export ───────────────────────────────────────────────────────────

export type ExportFormat = 'jsonl' | 'csv' | 'nemo' | 'textgrid' | 'conll' | 'srt_vtt';

/**
 * Export scope: consensus — only the reference versions (majority of
 * K = consensus_overlap submitted results per fragment), all — all versions.
 */
export type ExportScope = 'consensus' | 'all';

export type ExportStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export type ExportRequest = {
  format: ExportFormat;
  scope: ExportScope;
  include_metadata: boolean;
  /** Limit to task types (chips on the export screen); empty/absent — all. */
  task_types?: TaskType[];
};

export interface ExportJob {
  id: number;
  project_id: number;
  format: ExportFormat;
  scope: ExportScope;
  include_metadata: boolean;
  task_types: TaskType[];
  status: ExportStatus;
  /** 0..100 ("Building… 43%"). */
  progress: number;
  /** Current (while running) or final archive size in bytes. */
  size_bytes: number;
  filename: string;
  /** Download link when status === 'done'. */
  download_url: string | null;
  created_at: string;
}

// ── Dashboard and statistics ─────────────────────────────────────────

export interface ZombieTask {
  id: number;
  project_id: number;
  project_name: string;
  fragment_filename: string;
  task_type: TaskType;
  taken_by: string;
  taken_at: string;
  hours_stuck: number;
}

export interface AnnotatorScore {
  user_id: number;
  fio: string;
  group: string | null;
  tasks_done: number;
  agreement_pct: number;
}

export interface DashboardStats {
  projects_total: number;
  users_total: number;
  fragments_total: number;
  fragments_labeled: number;
  fragments_in_progress: number;
  /** % labeled across all projects, 0..100. */
  labeled_pct: number;
  zombie_tasks: ZombieTask[];
  top_annotators: AnnotatorScore[];
  outsider_annotators: AnnotatorScore[];
}

/** Row of the Statistics table. */
export interface StatisticsRow {
  user_id: number;
  fio: string;
  login: string;
  group: string | null;
  tasks_done: number;
  tasks_skipped: number;
  avg_task_sec: number;
  agreement_pct: number;
  /** Share of tasks that reached consensus, 0..100. */
  consensus_rate_pct: number;
  last_active_at: string | null;
}

// ── Annotator tasks (workspace) ──────────────────────────────────────────────

export interface Segment {
  start_sec: number;
  end_sec: number;
  label: string;
}

export interface SpeakerSegment {
  start_sec: number;
  end_sec: number;
  speaker: string;
}

interface TaskBase {
  id: number;
  project_id: number;
  project_name: string;
  fragment: AudioFragment;
  /** Project instruction — instruction panel in the workspace. */
  instruction: string;
}

/** Labeling task: discriminated by the type field, payload depends on the type. */
export type Task = TaskBase &
  (
    | { type: 'transcription'; payload: { orig_trb: string | null } }
    | { type: 'verification'; payload: { text: string; author_fio: string | null } }
    | { type: 'classification'; payload: { labels: LabelClass[]; multiple: boolean } }
    | { type: 'segmentation'; payload: { labels: LabelClass[] } }
    | { type: 'diarization'; payload: { max_speakers: number } }
    | { type: 'mos'; payload: { mos_scales: MosScale[] } }
    /**
     * Side-by-Side: two audio links in DISPLAY order (the backend has already
     * applied Task.swap; there are NO system names in the payload — blind comparison).
     */
    | { type: 'sbs'; payload: { audio_url_1: string; audio_url_2: string } }
  );

/** Labeling result sent to /task/{id}/submit. */
export type LabelingResult =
  | { task_id: number; type: 'transcription'; text: string }
  | {
      task_id: number;
      type: 'verification';
      verdict: 'approve' | 'reject';
      corrected_text: string | null;
    }
  | { task_id: number; type: 'classification'; labels: string[] }
  | { task_id: number; type: 'segmentation'; segments: Segment[] }
  | { task_id: number; type: 'diarization'; segments: SpeakerSegment[] }
  /**
   * MOS: key — project scale name, value 1..5. Submit validates that ALL of
   * the project's scales and only them are scored (422 detail='bad_result').
   * Legacy results {score: N} remain readable on export
   * (treated as {scores: {'MOS': N}}).
   */
  | { task_id: number; type: 'mos'; scores: Record<string, number> }
  /**
   * Side-by-Side: preference IN TERMS OF THE SHOWN order (-2 = "Variant 1
   * is much better", 0 = equal, +2 = "Variant 2 is much better"). On submit the
   * backend normalizes by Task.swap. Validation: int -2..2 (422 'bad_result').
   */
  | { task_id: number; type: 'sbs'; preference: SbsPreference };

export interface SubmitResult {
  ok: boolean;
  task_id: number;
}

export interface TaskHistoryItem {
  task_id: number;
  task_type: TaskType;
  project_id: number;
  project_name: string;
  fragment_filename: string;
  submitted_at: string;
  status: 'accepted' | 'pending' | 'consensus';
}

// ── Query params of list endpoints (type aliases — for the qs helper) ────────

export type FragmentsQuery = {
  offset?: number;
  limit?: number;
  task_type?: TaskType;
  finished?: boolean;
  search?: string;
};

export type UsersQuery = {
  offset?: number;
  limit?: number;
  search?: string;
  group?: string;
  role?: Role;
};

export type StatisticsQuery = {
  offset?: number;
  limit?: number;
  /** Search by full name/login (the "student" filter). */
  search?: string;
  group?: string;
};

export type RandomTaskQuery = {
  project_id?: number;
  task_type?: TaskType;
};

export type HistoryQuery = {
  offset?: number;
  limit?: number;
};
