/**
 * "Grant admin rights" modal: choose a user (role=user)
 * + the can_add_admins flag; granted via client.admins.grant.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { User } from '../../api/types'
import { Button, Checkbox, Modal, Select, useToast } from '../../components'

export interface GrantAdminModalProps {
  onClose: () => void
  onGranted: (user: User) => void
}

export function GrantAdminModal({ onClose, onGranted }: GrantAdminModalProps) {
  const { t } = useTranslation('admins')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [candidates, setCandidates] = useState<User[] | null>(null)
  const [userId, setUserId] = useState('')
  const [canAddAdmins, setCanAddAdmins] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    api.users
      .list({ role: 'user', limit: 500 })
      .then((page) => {
        if (alive) setCandidates(page.items)
      })
      .catch(() => {
        if (alive) {
          setCandidates([])
          toast({ kind: 'error', message: t('toasts.loadErr') })
        }
      })
    return () => {
      alive = false
    }
  }, [t, toast])

  async function submit() {
    if (!userId) {
      setError(t('modal.required'))
      return
    }
    setSubmitting(true)
    try {
      const granted = await api.admins.grant(Number(userId), canAddAdmins)
      toast({ kind: 'ok', message: t('toasts.granted', { fio: granted.fio }) })
      onGranted(granted)
      onClose()
    } catch {
      toast({ kind: 'error', message: t('toasts.saveErr') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('modal.title')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={submitting} disabled={candidates === null}>
            {t('modal.grant')}
          </Button>
        </>
      }
    >
      <div className="adm-form">
        <Select
          label={t('modal.user')}
          value={userId}
          error={error}
          hint={candidates !== null && candidates.length === 0 ? t('modal.noCandidates') : undefined}
          disabled={candidates === null || candidates.length === 0}
          onChange={(e) => {
            setUserId(e.target.value)
            setError(undefined)
          }}
        >
          <option value="">
            {candidates === null ? tc('loading') : t('modal.userPlaceholder')}
          </option>
          {(candidates ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.fio} · {u.login}
              {u.group ? ` · ${u.group}` : ''}
            </option>
          ))}
        </Select>
        <Checkbox
          label={t('modal.canAdd')}
          hint={t('modal.canAddHint')}
          checked={canAddAdmins}
          onChange={(e) => setCanAddAdmins(e.target.checked)}
        />
      </div>
    </Modal>
  )
}
