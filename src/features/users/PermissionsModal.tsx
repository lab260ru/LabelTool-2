/**
 * Per-user permission matrix: all task types (TASK_TYPES, 6) × a value
 * from {user_allow, user_block, admin_allow, admin_block}.
 * admin_* takes priority over user_*; for a regular admin the admin-locked cells
 * are read-only with an explanation (title + caption). Toggling — only through client.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { PermissionValue, TaskType, User } from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import { Banner, Modal, Select, Spinner, StatusBadge, useToast } from '../../components'
import { PERMISSION_VALUES, isAdminSet, isAllowed, isCellLocked } from './lib'

export interface PermissionsModalProps {
  user: User
  actorIsSuperAdmin: boolean
  onClose: () => void
  /** The parent updates the user in the list (and in this modal). */
  onUpdated: (user: User) => void
}

export function PermissionsModal({
  user,
  actorIsSuperAdmin,
  onClose,
  onUpdated,
}: PermissionsModalProps) {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const [saving, setSaving] = useState<TaskType | null>(null)

  async function change(taskType: TaskType, value: PermissionValue) {
    setSaving(taskType)
    try {
      const updated = await api.users.setPermissions(user.id, { [taskType]: value })
      onUpdated(updated)
    } catch {
      toast({ kind: 'error', message: t('errors.save') })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('matrix.title', { fio: user.fio })} width={600}>
      <div className="usr-matrix">
        <Banner kind="info">{t('matrix.intro')}</Banner>

        <table className="usr-matrix__table">
          <caption className="usr-sr-only">{t('matrix.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('matrix.colType')}</th>
              <th scope="col">{t('matrix.colValue')}</th>
              <th scope="col">{t('matrix.colEffective')}</th>
            </tr>
          </thead>
          <tbody>
            {TASK_TYPES.map((taskType) => {
              const value = user.permissions[taskType]
              const locked = isCellLocked(value, actorIsSuperAdmin)
              const typeLabel = tc(`taskTypes.${taskType}`)
              return (
                <tr key={taskType}>
                  <th scope="row" className="usr-matrix__type">
                    {typeLabel}
                  </th>
                  <td>
                    <div
                      className="usr-matrix__value"
                      title={locked ? t('perm.locked') : undefined}
                    >
                      <Select
                        aria-label={t('matrix.valueLabel', { type: typeLabel })}
                        value={value}
                        disabled={locked || saving === taskType}
                        onChange={(e) => void change(taskType, e.target.value as PermissionValue)}
                      >
                        {PERMISSION_VALUES.map((pv) => (
                          <option key={pv} value={pv}>
                            {t(`perm.values.${pv}`)}
                          </option>
                        ))}
                      </Select>
                      {saving === taskType && <Spinner size={14} inline label={tc('loading')} />}
                    </div>
                    {locked && <p className="usr-matrix__locked lt-caption">{t('perm.locked')}</p>}
                  </td>
                  <td className="usr-matrix__effective">
                    <StatusBadge
                      kind={isAllowed(value) ? 'ok' : 'error'}
                      label={isAllowed(value) ? t('perm.allowed') : t('perm.blocked')}
                    />
                    {isAdminSet(value) && (
                      <span className="usr-matrix__admin-note lt-caption">{t('perm.adminSet')}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
