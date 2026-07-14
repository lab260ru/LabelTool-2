import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api/client'
import type {
  LabelClass,
  MosLabelKey,
  MosScale,
  Project,
  ProjectParticipant,
  SbsSystems,
  TaskType,
  User,
} from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import { Button, Modal, TextArea, TextField, useToast } from '../../components'
import { LabelListEditor } from './LabelListEditor'
import { MosScalesEditor } from './MosScalesEditor'
import { ParticipantsField } from './ParticipantsField'
import type { MosScaleDraft } from './lib'
import {
  MIN_LABELS,
  mosScaleDraftsProblem,
  mosScaleDraftsToScales,
  newMosScaleDraft,
  sameMosScales,
  toMosScaleDrafts,
} from './lib'

/**
 * Create/edit a project. Field order: name → type → consensus →
 * description → instruction → task-type section → members.
 * Task-type section: classification/segmentation — the label_list editor
 * (required: min. 2 classes / min. 1 label), mos — the "Rating scales" editor
 * (1..5 scales, names non-empty/unique, point labels 1–5 optional;
 * scales can be changed while the project has no submitted results —
 * 409 'project_has_results'), the other types — a hint.
 * Submit is blocked while the form is invalid (the reason is a hint in the footer).
 * project == null → create; otherwise — edit (type disabled if fragments already
 * exist; 409 'project_has_fragments' is handled separately).
 */
export interface ProjectFormModalProps {
  open: boolean
  project: Project | null
  onClose: () => void
  onSaved: (project: Project, created: boolean) => void
}

/** Radio cards for choosing the task type (the radio group name is fixed). */
function TaskTypePicker({
  value,
  onChange,
  disabled,
  error,
  lockedNote,
}: {
  value: TaskType | null
  onChange: (value: TaskType) => void
  disabled: boolean
  error: string | null
  lockedNote: string | null
}) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')

  return (
    <fieldset className="ltp-typeset">
      <legend className="ltp-form__legend ltp-typeset__legend">{t('type.legend')}</legend>
      <p className="lt-caption ltp-hint">{lockedNote ?? t('type.note')}</p>
      <div className="ltp-types">
        {TASK_TYPES.map((taskType) => (
          <label
            key={taskType}
            className={[
              'ltp-type',
              value === taskType ? 'ltp-type--selected' : '',
              disabled ? 'ltp-type--disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={disabled ? (lockedNote ?? undefined) : undefined}
          >
            <input
              type="radio"
              name="project-task-type"
              value={taskType}
              checked={value === taskType}
              disabled={disabled}
              onChange={() => onChange(taskType)}
              className="ltp-type__input"
            />
            <span className="ltp-type__name">{tc(`taskTypes.${taskType}`)}</span>
            <span className="lt-caption ltp-type__desc">{t(`type.desc.${taskType}`)}</span>
          </label>
        ))}
      </div>
      {error !== null && (
        <p className="lt-caption ltp-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Consensus values (annotators per fragment): 1 — no consensus, 2–3 — typical. */
const OVERLAP_OPTIONS = [1, 2, 3, 4, 5] as const

/** Default consensus for a NEW project in the UI (in the DB server_default = 1). */
const DEFAULT_OVERLAP = 2

/**
 * "Consensus" 1..5 segmented control. When editing, the field is active:
 * changing the value recalculates open tasks on the backend (warning caption).
 */
function ConsensusPicker({
  value,
  onChange,
  editWarn,
}: {
  value: number
  onChange: (value: number) => void
  editWarn: boolean
}) {
  const { t } = useTranslation('projects')

  return (
    <fieldset className="ltp-consensus">
      <legend className="ltp-form__legend ltp-typeset__legend">{t('consensus.legend')}</legend>
      <p className="lt-caption ltp-hint">{t('consensus.hint')}</p>
      <div className="ltp-consensus__row">
        <div className="ltp-consensus__seg">
          {OVERLAP_OPTIONS.map((k) => (
            <label
              key={k}
              className={`ltp-consensus__opt${value === k ? ' ltp-consensus__opt--selected' : ''}`}
            >
              <input
                type="radio"
                name="project-consensus-overlap"
                value={k}
                checked={value === k}
                onChange={() => onChange(k)}
                className="ltp-type__input"
                aria-label={t('consensus.annotators', { count: k })}
              />
              <span className="ltp-consensus__num lt-data">{k}</span>
            </label>
          ))}
        </div>
        <span className="lt-caption ltp-consensus__unit">{t('consensus.perFragment')}</span>
      </div>
      {editWarn && (
        <p className="lt-caption ltp-consensus__warn" role="status">
          {t('consensus.editWarn')}
        </p>
      )}
    </fieldset>
  )
}

export function ProjectFormModal({ open, project, onClose, onSaved }: ProjectFormModalProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const nameId = useId()

  const [name, setName] = useState('')
  const [taskType, setTaskType] = useState<TaskType | null>(null)
  const [overlap, setOverlap] = useState<number>(DEFAULT_OVERLAP)
  const [description, setDescription] = useState('')
  const [instruction, setInstruction] = useState('')
  const [labels, setLabels] = useState<LabelClass[]>([])
  const [mosScales, setMosScales] = useState<MosScaleDraft[]>([])
  const [sbsSystems, setSbsSystems] = useState<SbsSystems>({ a: '', b: '' })
  const [participants, setParticipants] = useState<ProjectParticipant[]>([])
  const [typeError, setTypeError] = useState<string | null>(null)
  const [scalesError, setScalesError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [users, setUsers] = useState<User[] | null>(null)
  const [usersFailed, setUsersFailed] = useState(false)

  // The type cannot be changed once the project has fragments (single type per project).
  const typeLocked = project !== null && project.counters.fragments_total > 0

  // Reset the form for the current project on every open + focus the first field.
  // The parent effect runs AFTER the Modal effect (child-first), so focus moves
  // from the dialog panel to the "Name" field.
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setTaskType(project?.task_type ?? null)
    setOverlap(project?.consensus_overlap ?? DEFAULT_OVERLAP)
    setDescription(project?.description ?? '')
    setInstruction(project?.instruction ?? '')
    setLabels(project?.label_list.map((l) => ({ ...l })) ?? [])
    // MOS scales: for an existing mos project — its scales; otherwise one
    // default (name — the contract's localized default).
    setMosScales(
      project?.task_type === 'mos'
        ? toMosScaleDrafts(project.mos_scales)
        : [newMosScaleDraft(t('mosScales.defaultName'))],
    )
    // sbs systems: for an existing sbs project — its names; otherwise the localized
    // "System A/B" defaults (matching the backend's server_default).
    setSbsSystems(
      project?.task_type === 'sbs' && project.sbs_systems
        ? { ...project.sbs_systems }
        : { a: t('sbsSystems.defaultA'), b: t('sbsSystems.defaultB') },
    )
    setParticipants(project?.participants.map((p) => ({ ...p })) ?? [])
    setTypeError(null)
    setScalesError(null)
    document.getElementById(nameId)?.focus()
    // deps without t: changing the language while the modal is open must not reset the form
  }, [open, project, nameId])

  // Users for the members picker — loaded once on the first open.
  useEffect(() => {
    if (!open || users !== null) return
    let cancelled = false
    setUsersFailed(false)
    api.users
      .list({ limit: 200 })
      .then((r) => {
        if (!cancelled) setUsers(r.items)
      })
      .catch(() => {
        if (!cancelled) {
          setUsersFailed(true)
          toast({ kind: 'error', message: t('members.usersLoadError') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, users])

  // ── Validation: reasons why submit is unavailable ────────────────────────
  const minLabels = taskType === null ? 0 : MIN_LABELS[taskType]
  const problems: string[] = []
  if (name.trim() === '') problems.push(t('form.nameRequired'))
  if (taskType === null) problems.push(t('type.required'))
  if (minLabels > 0 && labels.length < minLabels) {
    problems.push(t(taskType === 'classification' ? 'labels.needMin2' : 'labels.needMin1'))
  }
  // MOS scales: names non-empty and unique (the editor itself enforces 1..5 scales)
  const scaleProblem = taskType === 'mos' ? mosScaleDraftsProblem(mosScales) : null
  if (scaleProblem === 'name') problems.push(t('mosScales.nameRequired'))
  if (scaleProblem === 'dup') problems.push(t('mosScales.duplicate'))
  // sbs systems: both names non-empty (backend — 422 'bad_sbs_systems')
  if (taskType === 'sbs' && (sbsSystems.a.trim() === '' || sbsSystems.b.trim() === '')) {
    problems.push(t('sbsSystems.nameRequired'))
  }
  const valid = problems.length === 0

  /** Scale drafts → MosScale[] (empty labels are filled in with localized defaults). */
  const builtMosScales = (): MosScale[] =>
    mosScaleDraftsToScales(mosScales, (k: MosLabelKey) => t(`mosScales.default.${k}`))

  /** Trimmed sbs system names (for sending to the server). */
  const builtSbsSystems = (): SbsSystems => ({ a: sbsSystems.a.trim(), b: sbsSystems.b.trim() })

  async function save() {
    if (!valid || taskType === null) return
    // Labels are sent to the server only for the types that use them
    // (when switching away from classification/segmentation the old label_list is cleared).
    const effectiveLabels = minLabels > 0 ? labels : []
    setSaving(true)
    try {
      let result: Project
      if (project) {
        // MOS scales — only on an actual change: a PATCH with modified scales
        // is rejected with 409 'project_has_results' when the project already has submissions.
        const nextScales = taskType === 'mos' ? builtMosScales() : null
        const sendScales =
          taskType === 'mos' &&
          (project.task_type !== 'mos' || !sameMosScales(nextScales ?? [], project.mos_scales))
        result = await api.projects.update(project.id, {
          name: name.trim(),
          description,
          instruction,
          label_list: effectiveLabels,
          participants,
          // Send the type only if it actually changes (and is not locked).
          ...(typeLocked || taskType === project.task_type ? {} : { task_type: taskType }),
          // Consensus — only on an actual change: the PATCH recalculates open tasks.
          ...(overlap === project.consensus_overlap ? {} : { consensus_overlap: overlap }),
          ...(sendScales ? { mos_scales: nextScales } : {}),
          // sbs system names — a label for the admin; can be changed freely.
          ...(taskType === 'sbs' ? { sbs_systems: builtSbsSystems() } : {}),
        })
      } else {
        result = await api.projects.create({
          name: name.trim(),
          task_type: taskType,
          consensus_overlap: overlap,
          description,
          instruction,
          label_list: effectiveLabels,
          // Scales are sent only for a mos project (the other types have none).
          ...(taskType === 'mos' ? { mos_scales: builtMosScales() } : {}),
          // System names — only for an sbs project (otherwise the backend ignores them).
          ...(taskType === 'sbs' ? { sbs_systems: builtSbsSystems() } : {}),
        })
        // Members in the create contract are ids; the full set is added via a PATCH.
        if (participants.length > 0) {
          result = await api.projects.update(result.id, { participants })
        }
      }
      toast({ kind: 'ok', message: project ? t('form.saved') : t('form.created') })
      onSaved(result, project === null)
      onClose()
    } catch (e) {
      // 409: while saving, fragments appeared in the project — the type cannot be changed.
      if (e instanceof ApiError && e.status === 409 && e.detail === 'project_has_fragments') {
        setTypeError(t('type.locked'))
        toast({ kind: 'error', message: t('type.conflict') })
      } else if (e instanceof ApiError && e.status === 409 && e.detail === 'project_has_results') {
        // The project already has submitted results — the MOS scales are frozen.
        setScalesError(t('mosScales.locked'))
        toast({ kind: 'error', message: t('mosScales.conflict') })
      } else {
        toast({ kind: 'error', message: t('form.saveError') })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? t('form.editTitle') : t('form.createTitle')}
      width={620}
      footer={
        <>
          {!valid && (
            <span className="lt-caption ltp-formwhy" role="status">
              {problems[0]}
            </span>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!valid}>
            {project ? tc('actions.save') : tc('actions.create')}
          </Button>
        </>
      }
    >
      <div className="ltp-form">
        <TextField
          id={nameId}
          label={t('form.name')}
          placeholder={t('form.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <TaskTypePicker
          value={taskType}
          onChange={(next) => {
            setTaskType(next)
            setTypeError(null)
          }}
          disabled={typeLocked}
          error={typeError}
          lockedNote={typeLocked ? t('type.locked') : null}
        />

        <ConsensusPicker
          value={overlap}
          onChange={setOverlap}
          editWarn={project !== null && overlap !== project.consensus_overlap}
        />

        <TextArea
          label={t('form.description')}
          placeholder={t('form.descriptionPlaceholder')}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextArea
          label={t('form.instruction')}
          placeholder={t('form.instructionPlaceholder')}
          rows={4}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />

        {/* Task-type section: label_list — for classification/segmentation,
            "Rating scales" — for mos, a short hint for the rest.
            key=taskType restarts the animation. */}
        {taskType !== null &&
          (minLabels > 0 ? (
            <section key={taskType} className="ltp-typesec">
              <h3 className="ltp-form__legend">
                {t(
                  taskType === 'classification'
                    ? 'labels.titleClassification'
                    : 'labels.titleSegmentation',
                )}
              </h3>
              <LabelListEditor
                value={labels}
                onChange={setLabels}
                hint={t(
                  taskType === 'classification'
                    ? 'labels.hintClassification'
                    : 'labels.hintSegmentation',
                )}
              />
            </section>
          ) : taskType === 'mos' ? (
            <section key={taskType} className="ltp-typesec">
              <h3 className="ltp-form__legend">{t('mosScales.title')}</h3>
              <MosScalesEditor
                value={mosScales}
                onChange={(next) => {
                  setMosScales(next)
                  setScalesError(null)
                }}
                error={scalesError}
              />
            </section>
          ) : taskType === 'sbs' ? (
            <section key={taskType} className="ltp-typesec">
              <h3 className="ltp-form__legend">{t('sbsSystems.title')}</h3>
              <p className="lt-caption ltp-hint">{t('sbsSystems.hint')}</p>
              <div className="ltp-sbs-systems">
                <TextField
                  label={t('sbsSystems.labelA')}
                  placeholder={t('sbsSystems.defaultA')}
                  value={sbsSystems.a}
                  onChange={(e) => setSbsSystems((s) => ({ ...s, a: e.target.value }))}
                />
                <TextField
                  label={t('sbsSystems.labelB')}
                  placeholder={t('sbsSystems.defaultB')}
                  value={sbsSystems.b}
                  onChange={(e) => setSbsSystems((s) => ({ ...s, b: e.target.value }))}
                />
              </div>
              <p className="lt-caption ltp-sbs-blind" role="note">
                {t('sbsSystems.blindNote')}
              </p>
            </section>
          ) : (
            <section key={taskType} className="ltp-typesec">
              <p className="ltp-typeinfo">{t(`typeInfo.${taskType}`)}</p>
            </section>
          ))}

        <h3 className="ltp-form__legend">{t('members.title')}</h3>
        <ParticipantsField
          value={participants}
          onChange={setParticipants}
          users={users}
          loadFailed={usersFailed}
        />
      </div>
    </Modal>
  )
}
