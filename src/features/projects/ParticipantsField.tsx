import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectParticipant, User } from '../../api/types'
import { Button, Spinner } from '../../components'
import { IconPlus, IconX } from '../../components/icons'
import { ParticipantsPickerModal } from './ParticipantsPickerModal'

/**
 * Project members: selected ones as removable chips; adding is done
 * through a nested picker modal (search, checkboxes for users and whole study
 * groups) instead of native selects.
 */
export interface ParticipantsFieldProps {
  value: ProjectParticipant[]
  onChange: (next: ProjectParticipant[]) => void
  /** null — still loading. */
  users: User[] | null
  loadFailed: boolean
}

const toParticipant = (u: User): ProjectParticipant => ({
  user_id: u.id,
  fio: u.fio,
  group: u.group,
})

export function ParticipantsField({ value, onChange, users, loadFailed }: ParticipantsFieldProps) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')

  const [pickerOpen, setPickerOpen] = useState(false)
  const memberIds = useMemo(() => new Set(value.map((p) => p.user_id)), [value])

  return (
    <div className="ltp-members">
      <div className="ltp-members__chips">
        {value.length === 0 && <span className="ltp-muted lt-caption">{t('members.empty')}</span>}
        {value.map((p) => (
          <span key={p.user_id} className="ltp-member">
            {p.fio}
            {p.group !== null && <span className="ltp-member__group lt-data">{p.group}</span>}
            <button
              type="button"
              className="ltp-member__remove"
              aria-label={`${tc('actions.remove')}: ${p.fio}`}
              onClick={() => onChange(value.filter((x) => x.user_id !== p.user_id))}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
      </div>

      {loadFailed && <p className="ltp-error lt-caption">{t('members.usersLoadError')}</p>}

      <div className="ltp-members__actions">
        <Button
          variant="secondary"
          leftIcon={<IconPlus size={14} />}
          onClick={() => setPickerOpen(true)}
          disabled={users === null}
        >
          {t('members.addButton')}
        </Button>
        {users === null && !loadFailed && <Spinner size={16} inline label={tc('loading')} />}
      </div>

      {users !== null && (
        <ParticipantsPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          users={users}
          excludeIds={memberIds}
          onAdd={(added) => onChange([...value, ...added.map(toParticipant)])}
        />
      )}
    </div>
  )
}
