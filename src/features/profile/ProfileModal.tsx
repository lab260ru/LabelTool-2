/**
 * User profile (topbar menu): the Data tab — avatar initials,
 * full name, login, role, group, metrics and task-type permissions; the Password tab —
 * changing one's own password (POST /user/password: old_password/new_password,
 * errors by detail code: wrong_old_password / password_too_short).
 * Data — from the session (useSession), refreshed on open via GET /auth/me.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api/client'
import type { PermissionValue, User } from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import { roleLabelKey, userInitials, useSession } from '../../app/session'
import { Button, Modal, Tabs, TextField, useToast } from '../../components'
import './i18n'
import './profile.css'

export type ProfileSection = 'info' | 'password'

export interface ProfileModalProps {
  /** Initial tab: the Profile menu item — info, Change password — password. */
  initialSection?: ProfileSection
  onClose: () => void
}

/** Permission result: allowed if the value is *_allow. */
const isAllowed = (v: PermissionValue) => v === 'user_allow' || v === 'admin_allow'
/** The value is admin-locked (admin_allow / admin_block) — a border on the label. */
const isAdminSet = (v: PermissionValue) => v === 'admin_allow' || v === 'admin_block'

export function ProfileModal({ initialSection = 'info', onClose }: ProfileModalProps) {
  const { t, i18n } = useTranslation('profile')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()
  const { user: sessionUser } = useSession()

  const [section, setSection] = useState<ProfileSection>(initialSection)

  // Refresh data on open: /auth/me (metrics and permissions may have changed).
  // On error the session data remains — the modal is not blocked.
  const [freshUser, setFreshUser] = useState<User | null>(null)
  useEffect(() => {
    let cancelled = false
    api.auth.me().then(
      (me) => {
        if (!cancelled) setFreshUser(me)
      },
      () => {
        /* failed to refresh — show the session data */
      },
    )
    return () => {
      cancelled = true
    }
  }, [])
  const user = freshUser ?? sessionUser

  // Password change form
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ current?: string; next?: string; repeat?: string }>({})

  if (!user) return null

  const numberFmt = new Intl.NumberFormat(i18n.language.startsWith('ru') ? 'ru-RU' : 'en-US')

  function validate(): boolean {
    const nextErrors: typeof errors = {}
    if (!current) nextErrors.current = t('password.required')
    if (next.length < 8) nextErrors.next = next ? t('password.tooShort') : t('password.required')
    if (repeat !== next || !repeat) {
      nextErrors.repeat = repeat ? t('password.mismatch') : t('password.required')
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSubmitting(true)
    try {
      await api.user.changePassword({ old_password: current, new_password: next })
      toast({ kind: 'ok', message: t('password.success') })
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.detail === 'wrong_old_password') {
        setErrors({ current: t('errors.wrong_old_password') })
      } else if (e instanceof ApiError && e.detail === 'password_too_short') {
        setErrors({ next: t('errors.password_too_short') })
      } else {
        toast({ kind: 'error', message: t('errors.generic') })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title')}
      width={520}
      footer={
        section === 'password' ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {tc('actions.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              {t('password.submit')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {tc('actions.close')}
          </Button>
        )
      }
    >
      <div className="prf-body">
        <Tabs
          label={t('tabsLabel')}
          items={[
            { id: 'info', label: t('tabs.info') },
            { id: 'password', label: t('tabs.password') },
          ]}
          value={section}
          onChange={(id) => setSection(id as ProfileSection)}
        />

        {section === 'info' ? (
          <div className="prf-info" role="tabpanel" aria-label={t('tabs.info')}>
            {/* Header: avatar circle with initials (as in the topbar), full name and role */}
            <div className="prf-head">
              <span className="prf-avatar" aria-hidden="true">
                {userInitials(user.fio)}
              </span>
              <div className="prf-head__meta">
                <p className="prf-head__fio">{user.fio}</p>
                <p className="prf-head__role">{tc(roleLabelKey(user))}</p>
              </div>
            </div>

            <dl className="prf-fields">
              <div className="prf-field">
                <dt>{t('info.login')}</dt>
                <dd className="lt-data">{user.login}</dd>
              </div>
              <div className="prf-field">
                <dt>{t('info.group')}</dt>
                <dd>{user.group ?? t('info.noGroup')}</dd>
              </div>
            </dl>

            <h3 className="prf-subtitle">{t('info.metrics')}</h3>
            <div className="prf-metrics">
              <div className="prf-metric">
                <span className="prf-metric__value">
                  {numberFmt.format(user.metrics.tasks_done)}
                </span>
                <span className="prf-metric__label">{t('info.tasksDone')}</span>
              </div>
              <div className="prf-metric">
                <span className="prf-metric__value">{user.metrics.agreement_pct}%</span>
                <span className="prf-metric__label">{t('info.agreement')}</span>
              </div>
            </div>

            <h3 className="prf-subtitle">{t('info.permissions')}</h3>
            <ul className="prf-perms">
              {TASK_TYPES.map((tt) => {
                const value = user.permissions[tt]
                const allowed = isAllowed(value)
                const cls = [
                  'prf-perm',
                  allowed ? 'prf-perm--allow' : 'prf-perm--block',
                  isAdminSet(value) ? 'prf-perm--admin' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                const typeName = tc(`taskTypes.${tt}`)
                const summary = t(allowed ? 'info.permAllowed' : 'info.permBlocked', {
                  type: typeName,
                })
                const label = isAdminSet(value) ? `${summary} (${t('info.permAdminSet')})` : summary
                return (
                  <li key={tt} className={cls} aria-label={label} title={label}>
                    {typeName}
                  </li>
                )
              })}
            </ul>
            <p className="prf-legend lt-caption">{t('info.permLegend')}</p>
          </div>
        ) : (
          <form
            className="prf-form"
            role="tabpanel"
            aria-label={t('tabs.password')}
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <TextField
              label={t('password.current')}
              type="password"
              value={current}
              error={errors.current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
            <TextField
              label={t('password.new')}
              type="password"
              hint={t('password.hint')}
              value={next}
              error={errors.next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <TextField
              label={t('password.repeat')}
              type="password"
              value={repeat}
              error={errors.repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
            />
            {/* Enter in the fields submits the form */}
            <button type="submit" className="prf-sr-only" tabIndex={-1}>
              {t('password.submit')}
            </button>
          </form>
        )}
      </div>
    </Modal>
  )
}
