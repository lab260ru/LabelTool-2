// Typed API client for LabelTool 2.
// Features use ONLY this client — no fetch inside src/features.
// Base is '/api'; the frontend always talks to the real backend (dev via vite proxy).

import type {
  AgreementStats,
  AudioFragment,
  ColumnMapping,
  DashboardStats,
  ExportJob,
  ExportRequest,
  CreateUserRequest,
  FragmentsQuery,
  HistoryQuery,
  InviteUsersRequest,
  InviteUsersResult,
  LabelingResult,
  LoginRequest,
  ManifestPreview,
  MosScale,
  Paginated,
  PresignedUrl,
  Project,
  S3ImportResult,
  S3PreviewResult,
  S3Source,
  S3SourceCreate,
  SbsSystems,
  ProjectProgress,
  RandomTaskQuery,
  RegisterRequest,
  StatisticsQuery,
  StatisticsRow,
  SubmitResult,
  Task,
  TaskHistoryItem,
  TaskPermissions,
  TaskType,
  UpdateUserRequest,
  UploadFileResult,
  UploadSessionInfo,
  UploadSessionRequest,
  UploadSummary,
  User,
  UsersQuery,
} from './types';

export const API_BASE = '/api';

/** API error: status — HTTP code, detail — machine-readable code for i18n. */
export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

type QueryValue = string | number | boolean | null | undefined;

function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { credentials: 'same-origin', ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error');
  }
  if (!res.ok) {
    let detail = res.statusText || 'request_failed';
    try {
      const body: unknown = await res.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { detail?: unknown }).detail === 'string'
      ) {
        detail = (body as { detail: string }).detail;
      }
    } catch {
      // body is not JSON — keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(API_BASE + path, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, res.statusText || 'request_failed');
  return res.blob();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (body: LoginRequest) =>
    request<User>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * POST /auth/register — public self-registration of an annotator (role=user) +
   * auto-login. Errors: 400 'fio_required' | 'bad_login' | 'password_too_short',
   * 409 'login_taken'.
   */
  register: (body: RegisterRequest) =>
    request<User>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),
};

// ── Profile: changing your own password ──────────────────────────────

/** POST /user/password body — field names 1:1 with backend/src/schemas/user.py. */
export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export const userApi = {
  /**
   * POST /user/password — change your own password.
   * Errors: 400 detail='wrong_old_password' (wrong current password) |
   * 'password_too_short' (shorter than 8 characters).
   */
  changePassword: (body: ChangePasswordRequest) =>
    request<{ ok: boolean }>('/user/password', { method: 'POST', body: JSON.stringify(body) }),
};

// ── Projects (+aggregates, instruction) ─────────────────────────────────────

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  get: (id: number) => request<Project>(`/project/${id}`),
  create: (body: {
    name: string;
    /** Single task type of the project — required at creation (all fragments inherit it). */
    task_type: TaskType;
    /** Consensus 1..5 (annotators per fragment); without the field the backend sets 1. */
    consensus_overlap?: number;
    /**
     * MOS scales (only task_type='mos'): 1..5 scales, names non-empty and
     * unique (422 detail='bad_mos_scales'); without the field the backend sets
     * the default [{name: 'Качество звучания'}].
     */
    mos_scales?: MosScale[];
    /**
     * Names of compared systems (only task_type='sbs'): non-empty (422
     * detail='bad_sbs_systems'); without the field the backend sets the default
     * {a: 'Система A', b: 'Система B'}. Never shown to the annotator.
     */
    sbs_systems?: SbsSystems;
    description?: string;
    instruction?: string;
    label_list?: Project['label_list'];
    participants?: number[];
  }) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * PATCH /project/{id}. Changing consensus_overlap is allowed at any time:
   * the backend recomputes the fragments' open tasks up to the new K
   * (done/in_progress are left untouched) and recomputes finished.
   * Changing mos_scales is allowed AS LONG AS the project has no done tasks:
   * otherwise 409 detail='project_has_results'.
   */
  update: (id: number, body: Partial<Omit<Project, 'id' | 'counters' | 'created_at'>>) =>
    request<Project>(`/project/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/project/${id}`, { method: 'DELETE' }),
  /** Project instruction (reading is available to the annotator). */
  getInstruction: (id: number) =>
    request<{ project_id: number; instruction: string }>(`/project/${id}/instruction`),
  /** Editing the instruction — via PATCH /project/{id}. */
  setInstruction: (id: number, instruction: string) =>
    request<Project>(`/project/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ instruction }),
    }).then((p) => ({ project_id: p.id, instruction: p.instruction })),
  /** Project progress. */
  progress: (id: number) => request<ProjectProgress>(`/project/${id}/progress`),
  /** Agreement metrics for the project. */
  agreement: (id: number) => request<AgreementStats>(`/project/${id}/agreement`),
};

// ── Fragments ────────────────────────────────────────────────────────

export const fragmentsApi = {
  list: (projectId: number, query: FragmentsQuery = {}) =>
    request<Paginated<AudioFragment>>(`/project/${projectId}/fragments${qs(query)}`),
  remove: (fragmentId: number) => request<void>(`/fragment/${fragmentId}`, { method: 'DELETE' }),
  // setTaskType removed: the task type is single per project (Project.task_type),
  // it is not editable on an individual fragment.
  presigned: (fragmentId: number) => request<PresignedUrl>(`/fragment/${fragmentId}/presigned`),
};

// ── S3 data sources (reference-in-place, admin) ──────────────────────────────

export const s3SourcesApi = {
  /** GET /project/{id}/s3-sources — project sources (without secrets). */
  list: (projectId: number) => request<S3Source[]>(`/project/${projectId}/s3-sources`),
  /**
   * POST /project/{id}/s3-sources — connect a source. Body with secret_key;
   * the backend verifies the connection (list limit=1) and on failure returns
   * 400 detail='s3_connection_failed' (the source is not created). 201 + S3Source
   * without the secret.
   */
  create: (projectId: number, body: S3SourceCreate) =>
    request<S3Source>(`/project/${projectId}/s3-sources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /**
   * DELETE /s3-source/{id} — delete a source. Fragments referencing it
   * are deleted along with it (warn in the UI).
   */
  remove: (sourceId: number) => request<void>(`/s3-source/${sourceId}`, { method: 'DELETE' }),
  /** POST /s3-source/{id}/preview — listing of audio objects under prefix. */
  preview: (sourceId: number) =>
    request<S3PreviewResult>(`/s3-source/${sourceId}/preview`, { method: 'POST' }),
  /**
   * POST /s3-source/{id}/import — create an AudioFragment for each NEW object
   * (for sbs — for each _a/_b pair). Idempotent: re-importing the same
   * prefix → imported=0.
   */
  import: (sourceId: number) =>
    request<S3ImportResult>(`/s3-source/${sourceId}/import`, { method: 'POST' }),
};

// ── Batch upload ─────────────────────────────────────────────────────

export type UploadFileOptions = {
  /** Progress 0..100 (monotonic). */
  onProgress?: (pct: number) => void;
  /** Cancel ("Cancel the rest"): the promise is rejected with AbortError. */
  signal?: AbortSignal;
};

/**
 * Upload a single session file via XHR with progress.
 * If granular upload events do not arrive, progress is additionally emulated
 * by a timer (up to 90%) until the server responds.
 * File business errors arrive as 200 + UploadFileResult{ok:false} —
 * errors do not stop the batch.
 */
export function uploadSessionFile(
  sessionId: string,
  clientId: string,
  file: Blob,
  opts: UploadFileOptions = {},
): Promise<UploadFileResult> {
  return new Promise<UploadFileResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `${API_BASE}/upload/session/${encodeURIComponent(sessionId)}/file/${encodeURIComponent(clientId)}`,
    );

    let reported = 0;
    const report = (pct: number) => {
      const clamped = Math.min(100, Math.max(reported, Math.round(pct)));
      if (clamped !== reported) {
        reported = clamped;
        opts.onProgress?.(clamped);
      }
    };

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) report((e.loaded / e.total) * 90);
    };

    // Progress emulation: speed depends on file size, deterministic.
    const estMs = Math.min(2800, 400 + file.size / 4096);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      report(Math.min(90, ((Date.now() - startedAt) / estMs) * 90));
    }, 120);
    const cleanup = () => window.clearInterval(timer);

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const detach = () => opts.signal?.removeEventListener('abort', onAbort);

    xhr.onload = () => {
      cleanup();
      detach();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as UploadFileResult;
          report(100);
          resolve(body);
        } catch {
          reject(new ApiError(xhr.status, 'bad_response'));
        }
      } else {
        let detail = 'request_failed';
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: string };
          if (typeof body.detail === 'string') detail = body.detail;
        } catch {
          // not JSON
        }
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => {
      cleanup();
      detach();
      reject(new ApiError(0, 'network_error'));
    };
    xhr.onabort = () => {
      cleanup();
      detach();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.send(file);
  });
}

export const uploadApi = {
  /** Create a batch-upload session: the server returns name duplicates and format rejects. */
  createSession: (body: UploadSessionRequest) =>
    request<UploadSessionInfo>('/upload/session', { method: 'POST', body: JSON.stringify(body) }),
  uploadFile: uploadSessionFile,
  /** Session summary (step 5): how many uploaded, list of failures with reasons. */
  finishSession: (sessionId: string) =>
    request<UploadSummary>(`/upload/session/${encodeURIComponent(sessionId)}/finish`, {
      method: 'POST',
    }),
  /** Preview of a CSV/JSONL manifest: columns, rows, validity, suggested mapping. */
  previewManifest: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ManifestPreview>('/upload/manifest/preview', { method: 'POST', body: form });
  },
  /** Import the manifest into the session with column mapping. */
  importManifest: (sessionId: string, mapping: ColumnMapping) =>
    request<UploadSummary>(`/upload/session/${encodeURIComponent(sessionId)}/manifest`, {
      method: 'POST',
      body: JSON.stringify({ mapping }),
    }),
};

// ── Export ───────────────────────────────────────────────────────────

export const exportsApi = {
  /** POST /project/{id}/export — start building the dataset. */
  start: (projectId: number, body: ExportRequest) =>
    request<ExportJob>(`/project/${projectId}/export`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Build progress ("Building… 43% · 2.1 GB"). */
  status: (projectId: number, jobId: number) =>
    request<ExportJob>(`/project/${projectId}/export/${jobId}`),
  cancel: (projectId: number, jobId: number) =>
    request<ExportJob>(`/project/${projectId}/export/${jobId}`, { method: 'DELETE' }),
  /** GET /project/{id}/exports — export history. */
  history: (projectId: number) => request<ExportJob[]>(`/project/${projectId}/exports`),
  /** Download the ready archive. */
  download: (jobId: number) => requestBlob(`/export/${jobId}/download`),
};

// ── Dashboard ────────────────────────────────────────────────────────

export const dashboardApi = {
  get: () => request<DashboardStats>('/dashboard'),
};

// ── Users and permissions ────────────────────────────────────────────────────

export const usersApi = {
  list: (query: UsersQuery = {}) => request<Paginated<User>>(`/users${qs(query)}`),
  create: (body: CreateUserRequest) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: UpdateUserRequest) =>
    request<User>(`/user/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/user/${id}`, { method: 'DELETE' }),
  /** Permission matrix for task types (user/admin × allow/block). */
  setPermissions: (id: number, permissions: Partial<TaskPermissions>) =>
    request<User>(`/user/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  invite: (body: InviteUsersRequest) =>
    request<InviteUsersResult>('/users/invite', { method: 'POST', body: JSON.stringify(body) }),
};

// ── Admins (super-admin) ──────────────────────────────────────────────

export const adminsApi = {
  list: () => request<User[]>('/admins'),
  /** Grant admin rights (optionally with can_add_admins right away). */
  grant: (userId: number, canAddAdmins = false) =>
    request<User>(`/user/${userId}/admin`, {
      method: 'POST',
      body: JSON.stringify({ can_add_admins: canAddAdmins }),
    }),
  /** Revoke admin rights. The last super-admin is protected: 409 detail='last_super_admin'. */
  revoke: (userId: number) => request<User>(`/user/${userId}/admin`, { method: 'DELETE' }),
  setCanAddAdmins: (userId: number, canAddAdmins: boolean) =>
    request<User>(`/user/${userId}/admin`, {
      method: 'PATCH',
      body: JSON.stringify({ can_add_admins: canAddAdmins }),
    }),
};

// ── Statistics ───────────────────────────────────────────────────────

export const statisticsApi = {
  list: (query: StatisticsQuery = {}) =>
    request<Paginated<StatisticsRow>>(`/statistics${qs(query)}`),
  /** Export the table to CSV (with the same filters). */
  exportCsv: (query: StatisticsQuery = {}) => requestBlob(`/statistics/export${qs(query)}`),
};

// ── Annotator tasks ──────────────────────────────────────────────────────────

export const tasksApi = {
  /** GET /task/random — random task; filters project_id / task_type. */
  random: (query: RandomTaskQuery = {}) => request<Task>(`/task/random${qs(query)}`),
  submit: (result: LabelingResult) =>
    request<SubmitResult>(`/task/${result.task_id}/submit`, {
      method: 'POST',
      body: JSON.stringify(result),
    }),
  skip: (taskId: number) => request<SubmitResult>(`/task/${taskId}/skip`, { method: 'POST' }),
  history: (query: HistoryQuery = {}) =>
    request<Paginated<TaskHistoryItem>>(`/task/history${qs(query)}`),
};

// ── Single entry point ───────────────────────────────────────────────────────

export const api = {
  auth: authApi,
  user: userApi,
  projects: projectsApi,
  fragments: fragmentsApi,
  s3Sources: s3SourcesApi,
  upload: uploadApi,
  exports: exportsApi,
  dashboard: dashboardApi,
  users: usersApi,
  admins: adminsApi,
  statistics: statisticsApi,
  tasks: tasksApi,
};
