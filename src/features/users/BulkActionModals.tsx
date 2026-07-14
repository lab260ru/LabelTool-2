/**
 * Bulk actions: for users selected via checkboxes —
 * assign permissions, assign a group, block.
 * Blocking = admin_block on all task types (the API has no separate blocked field).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { PermissionValue, TaskPermissions, TaskType, User } from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import { Banner, Button, Modal, Select, TextField, useToast } from '../../components'
import { PERMISSION_VALUES, isCellLocked } from './lib'

/** Result of the bulk operation: how many were updated and how many skipped (admin-locked). */
export interface BulkResult {
  updated: number
  skipped: number
}

interface BulkBaseProps {
  users: User[]
  onClose: () => void
  /** The parent shows a toast and reloads the list. */
  onDone: (result: BulkResult) => void
}

/* ── Assign permissions ──────────────────────────────────────────────────── */

export function BulkPermissionsModal({
  users,
  actorIsSuperAdmin,
  onClose,
  onDone,
}: BulkBaseProps & { actorIsSuperAdmin: boolean }) {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const [taskType, setTaskType] = useState<TaskType>('transcription')
  const [value, setValue] = useState<PermissionValue>('user_allow')
  const [applying, setApplying] = useState(false)

  // A regular admin sets only user values (admin_* is the super admin's prerogative).
  const valueOptions = actorIsSuperAdmin
    ? PERMISSION_VALUES
    : PERMISSION_VALUES.filter((v) => v === 'user_allow' || v === 'user_block')

  async function apply() {
    setApplying(true)
    let updated = 0
    let skipped = 0
    for (const user of users) {
      if (isCellLocked(user.permissions[taskType], actorIsSuperAdmin)) {
        skipped++
        continue
      }
      try {
        await api.users.setPermissions(user.id, { [taskType]: value })
        updated++
      } catch {
        toast({ kind: 'error', message: t('errors.save') })
      }
    }
    setApplying(false)
    onDone({ updated, skipped })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('bulk.permsTitle')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void apply()} loading={applying}>
            {t('bulk.apply')}
          </Button>
        </>
      }
    >
      <div className="usr-form">
        <p className="usr-form__note">{t('bulk.selected', { count: users.length })}</p>
        {!actorIsSuperAdmin && <Banner kind="info">{t('bulk.permsHint')}</Banner>}
        <div className="usr-form__row">
          <Select
            label={t('bulk.taskType')}
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as TaskType)}
          >
            {TASK_TYPES.map((tt) => (
              <option key={tt} value={tt}>
                {tc(`taskTypes.${tt}`)}
              </option>
            ))}
          </Select>
          <Select
            label={t('bulk.value')}
            value={value}
            onChange={(e) => setValue(e.target.value as PermissionValue)}
          >
            {valueOptions.map((pv) => (
              <option key={pv} value={pv}>
                {t(`perm.values.${pv}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Modal>
  )
}

/* ── Assign group ────────────────────────────────────────────────────────── */

export function BulkGroupModal({
  users,
  groups,
  onClose,
  onDone,
}: BulkBaseProps & { groups: string[] }) {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const [group, setGroup] = useState('')
  const [applying, setApplying] = useState(false)
  const datalistId = 'usr-bulk-group-list'

  async function apply() {
    setApplying(true)
    let updated = 0
    for (const user of users) {
      try {
        await api.users.update(user.id, { group: group.trim() || null })
        updated++
      } catch {
        toast({ kind: 'error', message: t('errors.save') })
      }
    }
    setApplying(false)
    onDone({ updated, skipped: 0 })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('bulk.groupTitle')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void apply()} loading={applying}>
            {t('bulk.apply')}
          </Button>
        </>
      }
    >
      <div className="usr-form">
        <p className="usr-form__note">{t('bulk.selected', { count: users.length })}</p>
        <TextField
          label={t('bulk.groupLabel')}
          hint={t('bulk.groupHint')}
          placeholder={t('invite.groupPlaceholder')}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          list={datalistId}
          autoComplete="off"
        />
        <datalist id={datalistId}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>
    </Modal>
  )
}

/* ── Block ───────────────────────────────────────────────────────────────── */

// All types are blocked at once — the set comes from TASK_TYPES (the single
// source), so a new task type is picked up automatically (7 types).
const ALL_BLOCKED: TaskPermissions = Object.fromEntries(
  TASK_TYPES.map((tt) => [tt, 'admin_block']),
) as TaskPermissions

export function BulkBlockModal({ users, onClose, onDone }: BulkBaseProps) {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const [applying, setApplying] = useState(false)

  async function apply() {
    setApplying(true)
    let updated = 0
    for (const user of users) {
      try {
        await api.users.setPermissions(user.id, ALL_BLOCKED)
        updated++
      } catch {
        toast({ kind: 'error', message: t('errors.save') })
      }
    }
    setApplying(false)
    onDone({ updated, skipped: 0 })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('bulk.blockTitle')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            {tc('actions.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void apply()} loading={applying}>
            {t('bulk.block')}
          </Button>
        </>
      }
    >
      <p>{t('bulk.blockText', { count: users.length })}</p>
    </Modal>
  )
}
