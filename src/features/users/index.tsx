/**
 * The Users screen (/admin/users):
 * a table (full name, login, role, group, metrics, task-type permissions),
 * filters (role, group, search), bulk actions via checkboxes,
 * invite/create user, per-user permission matrix (modal).
 * Data — only through src/api/client.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api/client'
import type { Role, User } from '../../api/types'
import { TASK_TYPES } from '../../api/types'
import {
  Button,
  Checkbox,
  DataTable,
  SectionDivider,
  Select,
  TextField,
  useToast,
} from '../../components'
import type { DataTableColumn } from '../../components'
import { IconPlus } from '../../components/icons'
import type { BulkResult } from './BulkActionModals'
import { BulkBlockModal, BulkGroupModal, BulkPermissionsModal } from './BulkActionModals'
import { CreateUserModal } from './CreateUserModal'
import { PermissionsModal } from './PermissionsModal'
import { isAdminSet, isAllowed, isSuperAdmin } from './lib'
import './i18n'
import './users.css'

type BulkKind = 'perms' | 'group' | 'block' | null

export default function UsersPage() {
  const { t } = useTranslation('users')
  const { t: tc } = useTranslation('common')
  const { toast } = useToast()

  // ── Data ────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<User | null>(null)
  /** All encountered groups — for the filter and datalist suggestions. */
  const [groups, setGroups] = useState<string[]>([])

  // ── Filters (role, group, search — server-side query params) ────────────
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  const [groupFilter, setGroupFilter] = useState('')

  // ── Row selection and modals ─────────────────────────────────────────────
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [permsUser, setPermsUser] = useState<User | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [bulk, setBulk] = useState<BulkKind>(null)

  const requestSeq = useRef(0)

  useEffect(() => {
    let alive = true
    api.auth
      .me()
      .then((u) => {
        if (alive) setMe(u)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const loadUsers = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const page = await api.users.list({
        search: debouncedSearch || undefined,
        role: roleFilter || undefined,
        group: groupFilter || undefined,
        limit: 500,
      })
      if (requestSeq.current !== seq) return
      setUsers(page.items)
      setGroups((prev) => {
        const set = new Set(prev)
        for (const u of page.items) if (u.group) set.add(u.group)
        return [...set].sort((a, b) => a.localeCompare(b))
      })
    } catch {
      if (requestSeq.current === seq) {
        setUsers([])
        toast({ kind: 'error', message: t('errors.load') })
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false)
    }
  }, [debouncedSearch, roleFilter, groupFilter, t, toast])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  // Changing filters resets the selection — a bulk action must not touch hidden rows.
  useEffect(() => {
    setSelected(new Set())
  }, [debouncedSearch, roleFilter, groupFilter])

  const actorIsSuperAdmin = isSuperAdmin(me)

  /** Update the user in the list and in the open permission matrix. */
  const updateUser = useCallback((updated: User) => {
    setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)))
    setPermsUser((p) => (p !== null && p.id === updated.id ? updated : p))
  }, [])

  // ── Checkbox selection ───────────────────────────────────────────────────
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id))
  const selectedUsers = useMemo(() => users.filter((u) => selected.has(u.id)), [users, selected])

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)))
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onBulkDone(result: BulkResult) {
    setBulk(null)
    setSelected(new Set())
    toast({ kind: 'ok', message: t('bulk.doneMsg', { count: result.updated }) })
    if (result.skipped > 0) {
      toast({ kind: 'warn', message: t('bulk.skippedMsg', { count: result.skipped }) })
    }
    void loadUsers()
  }

  // ── Table columns ────────────────────────────────────────────────────────
  const columns: DataTableColumn<User>[] = [
    {
      key: 'select',
      header: '',
      align: 'center',
      width: '44px',
      render: (row) => (
        <Checkbox
          label={<span className="usr-sr-only">{t('table.selectRow', { fio: row.fio })}</span>}
          checked={selected.has(row.id)}
          onChange={() => toggleOne(row.id)}
          className="usr-row-check"
        />
      ),
    },
    { key: 'fio', header: t('columns.fio'), sortable: true },
    { key: 'login', header: t('columns.login'), sortable: true, numeric: true },
    {
      key: 'role',
      header: t('columns.role'),
      align: 'center',
      sortable: true,
      sortValue: (row) => (row.can_add_admins ? 2 : row.role === 'admin' ? 1 : 0),
      render: (row) => (
        <span
          className={`usr-role${
            row.role === 'admin' ? (row.can_add_admins ? ' usr-role--super' : ' usr-role--admin') : ''
          }`}
        >
          {row.role === 'admin'
            ? row.can_add_admins
              ? tc('roles.superAdmin')
              : tc('roles.admin')
            : tc('roles.user')}
        </span>
      ),
    },
    {
      key: 'group',
      header: t('columns.group'),
      align: 'center',
      sortable: true,
      sortValue: (row) => row.group ?? '',
      render: (row) => row.group ?? t('table.noGroup'),
    },
    {
      key: 'tasksDone',
      header: t('columns.tasksDone'),
      sortable: true,
      align: 'center',
      numeric: true,
      width: '110px',
      sortValue: (row) => row.metrics.tasks_done,
      render: (row) => row.metrics.tasks_done,
    },
    {
      key: 'agreement',
      header: t('columns.agreement'),
      sortable: true,
      align: 'center',
      numeric: true,
      width: '110px',
      sortValue: (row) => row.metrics.agreement_pct,
      render: (row) => (row.metrics.agreement_pct > 0 ? row.metrics.agreement_pct.toFixed(1) : '—'),
    },
    {
      key: 'permissions',
      header: t('columns.permissions'),
      align: 'center',
      render: (row) => {
        const summary = TASK_TYPES.map(
          (tt) => `${tc(`taskTypes.${tt}`)}: ${t(`perm.values.${row.permissions[tt]}`)}`,
        ).join('; ')
        return (
          <span className="usr-perms" role="img" aria-label={summary}>
            {TASK_TYPES.map((tt) => {
              const value = row.permissions[tt]
              const cls = [
                'usr-perm-chip',
                isAllowed(value) ? 'usr-perm-chip--allow' : 'usr-perm-chip--block',
                isAdminSet(value) ? 'usr-perm-chip--admin' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <span
                  key={tt}
                  className={cls}
                  title={`${tc(`taskTypes.${tt}`)}: ${t(`perm.values.${value}`)}`}
                  aria-hidden="true"
                >
                  {t(`taskShort.${tt}`)}
                </span>
              )
            })}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      align: 'center',
      width: '96px',
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setPermsUser(row)}>
          {t('table.permsButton')}
        </Button>
      ),
    },
  ]

  return (
    <section className="lt-page usr-page">
      <h1>{t('title')}</h1>
      <SectionDivider />

      {/* ── Filters + invite ─────────────────────────────────────────────── */}
      <div className="usr-toolbar">
        <TextField
          className="usr-toolbar__search"
          type="search"
          aria-label={t('toolbar.search')}
          placeholder={t('toolbar.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="usr-toolbar__filter"
          aria-label={t('toolbar.role')}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | '')}
        >
          <option value="">{t('toolbar.roleAll')}</option>
          <option value="user">{tc('roles.user')}</option>
          <option value="admin">{tc('roles.admin')}</option>
        </Select>
        <Select
          className="usr-toolbar__filter"
          aria-label={t('toolbar.group')}
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        >
          <option value="">{t('toolbar.groupAll')}</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <span className="usr-toolbar__spacer" />
        <Button leftIcon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          {t('toolbar.invite')}
        </Button>
      </div>

      {/* ── Bulk actions ─────────────────────────────────────────────────── */}
      <div className={`usr-bulk${selected.size > 0 ? ' usr-bulk--active' : ''}`}>
        <Checkbox
          label={t('toolbar.selectAll', { count: users.length })}
          checked={allSelected}
          disabled={users.length === 0}
          onChange={toggleAll}
        />
        {selected.size > 0 && (
          <>
            <span className="usr-bulk__count lt-data">
              {t('bulk.selected', { count: selected.size })}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setBulk('perms')}>
              {t('bulk.assignPerms')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk('group')}>
              {t('bulk.assignGroup')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setBulk('block')}>
              {t('bulk.block')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
              {t('bulk.clear')}
            </Button>
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(row) => row.id}
        loading={loading}
        pageSize={10}
        emptyTitle={t('table.empty')}
        emptyDescription={t('table.emptyHint')}
      />
      <p className="usr-legend lt-caption">{t('table.legend')}</p>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {permsUser !== null && (
        <PermissionsModal
          user={permsUser}
          actorIsSuperAdmin={actorIsSuperAdmin}
          onClose={() => setPermsUser(null)}
          onUpdated={updateUser}
        />
      )}
      {createOpen && (
        <CreateUserModal
          groups={groups}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void loadUsers()}
        />
      )}
      {bulk === 'perms' && (
        <BulkPermissionsModal
          users={selectedUsers}
          actorIsSuperAdmin={actorIsSuperAdmin}
          onClose={() => setBulk(null)}
          onDone={onBulkDone}
        />
      )}
      {bulk === 'group' && (
        <BulkGroupModal
          users={selectedUsers}
          groups={groups}
          onClose={() => setBulk(null)}
          onDone={onBulkDone}
        />
      )}
      {bulk === 'block' && (
        <BulkBlockModal users={selectedUsers} onClose={() => setBulk(null)} onDone={onBulkDone} />
      )}
    </section>
  )
}
