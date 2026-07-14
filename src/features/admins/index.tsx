/**
 * "Admins" screen (/admin/admins, visible to the super admin):
 * list of admins, grant/revoke admin rights, the can_add_admins flag,
 * protection of the last super admin (revoke button disabled + explanation).
 * Data — only through src/api/client.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../api/client'
import type { User } from '../../api/types'
import {
  Banner,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Modal,
  SectionDivider,
  Spinner,
  useToast,
} from '../../components'
import type { DataTableColumn } from '../../components'
import { IconPlus } from '../../components/icons'
import { GrantAdminModal } from './GrantAdminModal'
import './i18n'
import './admins.css'

/** Super admin — an admin with the can_add_admins flag. */
const isSuper = (u: User): boolean => u.role === 'admin' && u.can_add_admins

function formatDateTime(isoDate: string | null, lang: string, fallback: string): string {
  if (!isoDate) return fallback
  const locale = lang.startsWith('ru') ? 'ru-RU' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDate))
}

export default function AdminsPage() {
  const { t, i18n } = useTranslation('admins')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  const [me, setMe] = useState<User | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [admins, setAdmins] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<User | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    let alive = true
    api.auth
      .me()
      .then((u) => {
        if (alive) setMe(u)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setMeLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const loadAdmins = useCallback(async () => {
    setLoading(true)
    try {
      setAdmins(await api.admins.list())
    } catch {
      toast({ kind: 'error', message: t('toasts.loadErr') })
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    void loadAdmins()
  }, [loadAdmins])

  const superAdminCount = admins.filter(isSuper).length
  /** The last super admin: protected from losing admin rights and the flag. */
  const isLastSuper = (u: User): boolean => isSuper(u) && superAdminCount <= 1

  function saveError(e: unknown) {
    if (e instanceof ApiError && e.detail === 'last_super_admin') {
      toast({ kind: 'error', message: t('toasts.lastSuperErr') })
    } else {
      toast({ kind: 'error', message: t('toasts.saveErr') })
    }
  }

  async function toggleCanAdd(user: User, next: boolean) {
    setSavingId(user.id)
    try {
      const updated = await api.admins.setCanAddAdmins(user.id, next)
      setAdmins((list) => list.map((a) => (a.id === updated.id ? updated : a)))
      toast({
        kind: 'ok',
        message: t(next ? 'toasts.flagOn' : 'toasts.flagOff', { fio: updated.fio }),
      })
    } catch (e) {
      saveError(e)
    } finally {
      setSavingId(null)
    }
  }

  async function revoke(user: User) {
    setRevoking(true)
    try {
      await api.admins.revoke(user.id)
      setAdmins((list) => list.filter((a) => a.id !== user.id))
      toast({ kind: 'ok', message: t('toasts.revoked', { fio: user.fio }) })
      setRevokeTarget(null)
    } catch (e) {
      saveError(e)
    } finally {
      setRevoking(false)
    }
  }

  // ── Access: the section is visible to the super admin only ────────────────────
  if (meLoading) {
    return (
      <section className="lt-page adm-page">
        <h1>{t('title')}</h1>
        <SectionDivider />
        <div className="adm-loading">
          <Spinner size={32} label={tc('loading')} />
        </div>
      </section>
    )
  }

  if (me === null || !isSuper(me)) {
    return (
      <section className="lt-page adm-page">
        <h1>{t('title')}</h1>
        <SectionDivider />
        <Banner kind="warning" className="adm-guard">
          {t('onlySuper.title')}
        </Banner>
        <EmptyState title={t('onlySuper.title')} description={t('onlySuper.description')} />
      </section>
    )
  }

  const columns: DataTableColumn<User>[] = [
    { key: 'fio', header: t('columns.fio'), sortable: true },
    { key: 'login', header: t('columns.login'), sortable: true, numeric: true },
    {
      key: 'status',
      header: t('columns.status'),
      align: 'center',
      sortable: true,
      sortValue: (row) => (isSuper(row) ? 1 : 0),
      render: (row) => (
        <span className={`adm-role${isSuper(row) ? ' adm-role--super' : ''}`}>
          {isSuper(row) ? t('status.super') : t('status.admin')}
        </span>
      ),
    },
    {
      key: 'canAdd',
      header: t('columns.canAdd'),
      align: 'center',
      render: (row) => {
        const last = isLastSuper(row)
        return (
          <span title={last ? t('lastSuperHint') : undefined}>
            <Checkbox
              label={<span className="adm-sr-only">{t('canAddLabel', { fio: row.fio })}</span>}
              checked={row.can_add_admins}
              disabled={last || savingId === row.id}
              onChange={(e) => void toggleCanAdd(row, e.target.checked)}
            />
          </span>
        )
      },
    },
    {
      key: 'lastActive',
      header: t('columns.lastActive'),
      align: 'center',
      sortable: true,
      numeric: true,
      sortValue: (row) => row.metrics.last_active_at ?? '',
      render: (row) => formatDateTime(row.metrics.last_active_at, i18n.language, t('never')),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      align: 'center',
      width: '220px',
      render: (row) => {
        const last = isLastSuper(row)
        return (
          <span className="adm-actions" title={last ? t('lastSuperHint') : undefined}>
            <Button
              size="sm"
              variant="danger"
              disabled={last}
              onClick={() => setRevokeTarget(row)}
            >
              {t('revoke')}
            </Button>
            {last && <span className="adm-actions__note lt-caption">{t('lastSuper')}</span>}
          </span>
        )
      },
    },
  ]

  return (
    <section className="lt-page adm-page">
      <h1>{t('title')}</h1>
      <SectionDivider />

      <div className="adm-toolbar">
        <p className="adm-intro">{t('intro')}</p>
        <span className="adm-toolbar__spacer" />
        <Button leftIcon={<IconPlus size={16} />} onClick={() => setGrantOpen(true)}>
          {t('grant')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={admins}
        rowKey={(row) => row.id}
        loading={loading}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyHint')}
      />
      <p className="adm-legend lt-caption">{t('lastSuperHint')}</p>

      {grantOpen && (
        <GrantAdminModal onClose={() => setGrantOpen(false)} onGranted={() => void loadAdmins()} />
      )}

      {revokeTarget !== null && (
        <Modal
          open
          onClose={() => setRevokeTarget(null)}
          title={t('confirm.title')}
          width={460}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setRevokeTarget(null)}
                disabled={revoking}
              >
                {tc('actions.cancel')}
              </Button>
              <Button variant="danger" loading={revoking} onClick={() => void revoke(revokeTarget)}>
                {t('revoke')}
              </Button>
            </>
          }
        >
          <p>{t('confirm.text', { fio: revokeTarget.fio, login: revokeTarget.login })}</p>
        </Modal>
      )}
    </section>
  )
}
