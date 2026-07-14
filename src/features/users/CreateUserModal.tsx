/**
 * Invite/create user: a modal with full name, login, role,
 * group and access via "password" or "invite link".
 * The API has no invite-token endpoint — the link is built on the client
 * deterministically from the id+login of the created user.
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api/client'
import type { Role, User } from '../../api/types'
import { Button, Modal, Select, TextField, useToast } from '../../components'

type AccessMode = 'password' | 'link'

export interface CreateUserModalProps {
  /** Known groups — datalist suggestions. */
  groups: string[]
  onClose: () => void
  onCreated: (user: User) => void
}

/** Deterministic pseudo invite code (FNV-1a of id+login), base36. */
function inviteCode(user: User): string {
  const s = `${user.id}:${user.login}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function CreateUserModal({ groups, onClose, onCreated }: CreateUserModalProps) {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const datalistId = useId()

  const [fio, setFio] = useState('')
  const [login, setLogin] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [group, setGroup] = useState('')
  const [mode, setMode] = useState<AccessMode>('password')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ fio?: string; login?: string; password?: string }>({})
  /** Invite link of the created user (link mode, after success). */
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  function validate(): boolean {
    const next: typeof errors = {}
    if (!fio.trim()) next.fio = t('invite.required')
    if (!login.trim()) next.login = t('invite.required')
    if (mode === 'password' && password.length < 8) {
      next.password = password ? t('invite.passwordShort') : t('invite.required')
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSubmitting(true)
    try {
      const user = await api.users.create({
        fio: fio.trim(),
        login: login.trim(),
        role,
        group: role === 'user' && group.trim() ? group.trim() : null,
        ...(mode === 'password' ? { password } : {}),
      })
      onCreated(user)
      toast({ kind: 'ok', message: t('invite.created', { login: user.login }) })
      if (mode === 'link') {
        setInviteLink(
          `${window.location.origin}/invite/${encodeURIComponent(user.login)}?code=${inviteCode(user)}`,
        )
      } else {
        onClose()
      }
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'login_taken') {
        setErrors({ login: t('invite.loginTaken') })
      } else {
        toast({ kind: 'error', message: t('errors.save') })
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function copyLink() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      toast({ kind: 'ok', message: t('invite.copied') })
    } catch {
      // Clipboard unavailable (permissions) — the link stays visible for manual copying.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('invite.title')}
      width={520}
      footer={
        inviteLink === null ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {tc('actions.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              {t('invite.create')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tc('actions.close')}</Button>
        )
      }
    >
      {inviteLink === null ? (
        <form
          className="usr-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <TextField
            label={t('invite.fio')}
            placeholder={t('invite.fioPlaceholder')}
            value={fio}
            error={errors.fio}
            onChange={(e) => setFio(e.target.value)}
            autoComplete="off"
          />
          <TextField
            label={t('invite.login')}
            placeholder={t('invite.loginPlaceholder')}
            value={login}
            error={errors.login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
          />
          <div className="usr-form__row">
            <Select
              label={t('invite.role')}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="user">{tc('roles.user')}</option>
              <option value="admin">{tc('roles.admin')}</option>
            </Select>
            <TextField
              label={t('invite.group')}
              placeholder={t('invite.groupPlaceholder')}
              hint={t('invite.groupHint')}
              value={group}
              disabled={role === 'admin'}
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
          <div className="usr-form__row">
            <Select
              label={t('invite.access')}
              value={mode}
              onChange={(e) => setMode(e.target.value as AccessMode)}
            >
              <option value="password">{t('invite.accessPassword')}</option>
              <option value="link">{t('invite.accessLink')}</option>
            </Select>
            {mode === 'password' ? (
              <TextField
                label={t('invite.password')}
                type="password"
                hint={t('invite.passwordHint')}
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            ) : (
              <p className="usr-form__link-hint lt-caption">{t('invite.linkHint')}</p>
            )}
          </div>
          {/* Enter in the fields submits the form */}
          <button type="submit" className="usr-sr-only" tabIndex={-1}>
            {t('invite.create')}
          </button>
        </form>
      ) : (
        <div className="usr-form">
          <h3 className="usr-form__subtitle">{t('invite.linkTitle')}</h3>
          <p className="lt-caption usr-form__link-hint">{t('invite.linkHint')}</p>
          <div className="usr-form__link-row">
            <TextField
              aria-label={t('invite.linkLabel', { login })}
              value={inviteLink}
              readOnly
              className="usr-form__link-field lt-data"
              onFocus={(e) => e.target.select()}
            />
            <Button variant="secondary" onClick={() => void copyLink()}>
              {t('invite.copy')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
