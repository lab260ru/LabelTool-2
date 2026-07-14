import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '../../api/types'
import { Button, Checkbox, Modal, Tabs, TextField } from '../../components'

/**
 * Nested members picker modal: search by full name/login, checkboxes for
 * users (full name · login · group) and a "Groups" tab — adding a whole study
 * group. Rendered on top of the project form modal: both are portals into
 * document.body, so the upper one (this) overlaps the lower one, Esc closes only
 * the upper one (keydown does not bubble into the lower panel), and focus returns
 * to the "Add members" button.
 */
export interface ParticipantsPickerModalProps {
  open: boolean
  onClose: () => void
  /** All users (api.users.list). */
  users: User[]
  /** Already in the project — not shown in the picker. */
  excludeIds: ReadonlySet<number>
  /** Add the selected ones (no duplicates — the picker returns a ready list). */
  onAdd: (added: User[]) => void
}

type PickerTab = 'users' | 'groups'

export function ParticipantsPickerModal({
  open,
  onClose,
  users,
  excludeIds,
  onAdd,
}: ParticipantsPickerModalProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')

  const [tab, setTab] = useState<PickerTab>('users')
  const [query, setQuery] = useState('')
  const [pickedUsers, setPickedUsers] = useState<ReadonlySet<number>>(new Set())
  const [pickedGroups, setPickedGroups] = useState<ReadonlySet<string>>(new Set())
  const searchBoxRef = useRef<HTMLDivElement>(null)

  // Reset the selection on every open; focus goes to search (after the Modal panel focus).
  useEffect(() => {
    if (!open) return
    setTab('users')
    setQuery('')
    setPickedUsers(new Set())
    setPickedGroups(new Set())
    searchBoxRef.current?.querySelector('input')?.focus()
  }, [open])

  const available = useMemo(() => users.filter((u) => !excludeIds.has(u.id)), [users, excludeIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return available
    return available.filter(
      (u) => u.fio.toLowerCase().includes(q) || u.login.toLowerCase().includes(q),
    )
  }, [available, query])

  // Study groups among the not-yet-added ones (count — how many people will be added).
  const groups = useMemo(() => {
    const byGroup = new Map<string, number>()
    for (const u of available) {
      if (u.group !== null) byGroup.set(u.group, (byGroup.get(u.group) ?? 0) + 1)
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))
  }, [available])

  // Final selection: individual users ∪ members of the selected groups.
  const selection = useMemo(
    () =>
      available.filter(
        (u) => pickedUsers.has(u.id) || (u.group !== null && pickedGroups.has(u.group)),
      ),
    [available, pickedUsers, pickedGroups],
  )

  function toggleUser(id: number, on: boolean) {
    setPickedUsers((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleGroup(name: string, on: boolean) {
    setPickedGroups((prev) => {
      const next = new Set(prev)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })
  }

  function submit() {
    if (selection.length === 0) return
    onAdd(selection)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('picker.title')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={selection.length === 0}>
            {t('picker.add', { count: selection.length })}
          </Button>
        </>
      }
    >
      <div className="ltp-picker">
        <Tabs
          items={[
            { id: 'users', label: t('picker.tabUsers') },
            { id: 'groups', label: t('picker.tabGroups') },
          ]}
          value={tab}
          onChange={(id) => setTab(id as PickerTab)}
          label={t('picker.tabsLabel')}
        />

        {tab === 'users' && (
          <div role="tabpanel" aria-label={t('picker.tabUsers')} className="ltp-picker__panel">
            <div ref={searchBoxRef}>
              <TextField
                type="search"
                label={tc('actions.search')}
                placeholder={t('picker.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="ltp-picker__list">
              {filtered.length === 0 && (
                <p className="ltp-muted lt-caption ltp-picker__empty">
                  {available.length === 0 ? t('picker.usersAllAdded') : t('picker.usersEmpty')}
                </p>
              )}
              {filtered.map((u) => {
                const viaGroup = u.group !== null && pickedGroups.has(u.group)
                return (
                  <Checkbox
                    key={u.id}
                    className="ltp-picker__row"
                    checked={pickedUsers.has(u.id) || viaGroup}
                    disabled={viaGroup}
                    onChange={(e) => toggleUser(u.id, e.target.checked)}
                    label={
                      <span className="ltp-picker__line">
                        <span className="ltp-picker__fio">{u.fio}</span>
                        <span className="ltp-picker__login lt-data lt-caption">{u.login}</span>
                        <span className="ltp-picker__group lt-caption">
                          {u.group ?? t('members.noGroup')}
                        </span>
                      </span>
                    }
                  />
                )
              })}
            </div>
          </div>
        )}

        {tab === 'groups' && (
          <div role="tabpanel" aria-label={t('picker.tabGroups')} className="ltp-picker__panel">
            <p className="ltp-hint lt-caption">{t('picker.groupsHint')}</p>
            <div className="ltp-picker__list">
              {groups.length === 0 && (
                <p className="ltp-muted lt-caption ltp-picker__empty">{t('picker.groupsEmpty')}</p>
              )}
              {groups.map((g) => (
                <Checkbox
                  key={g.name}
                  className="ltp-picker__row"
                  checked={pickedGroups.has(g.name)}
                  onChange={(e) => toggleGroup(g.name, e.target.checked)}
                  label={
                    <span className="ltp-picker__line">
                      <span className="ltp-picker__fio">{g.name}</span>
                      <span className="ltp-picker__group lt-caption">
                        {t('picker.groupStudents', { count: g.count })}
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
