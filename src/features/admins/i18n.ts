/**
 * i18n for the "Admins" feature (namespace 'admins', ru + en together).
 * Shared strings (roles, buttons, table) — from the 'common' namespace.
 */
import { registerFeatureI18n } from '../../i18n'

const ru = {
  title: 'Админы',
  intro: 'Выдача и снятие прав администратора. Раздел доступен только супер-админу.',
  onlySuper: {
    title: 'Раздел доступен только супер-админу',
    description:
      'Управлять админками может администратор с флагом can_add_admins (супер-админ). Обратитесь к нему, если нужны изменения.',
  },
  grant: 'Выдать админку',
  columns: {
    fio: 'ФИО',
    login: 'Логин',
    status: 'Статус',
    canAdd: 'Может добавлять админов',
    lastActive: 'Последняя активность',
    actions: 'Действия',
  },
  status: {
    super: 'Супер-админ',
    admin: 'Администратор',
  },
  canAddLabel: 'Флаг can_add_admins: {{fio}}',
  revoke: 'Снять админку',
  lastSuper: 'Последний супер-админ',
  lastSuperHint:
    'В системе всегда должен оставаться хотя бы один супер-админ — снять админку или флаг у последнего нельзя.',
  never: 'ещё не входил',
  empty: 'Админов пока нет',
  emptyHint: 'Выдайте админку пользователю — кнопка над таблицей',
  modal: {
    title: 'Выдать админку',
    user: 'Пользователь',
    userPlaceholder: 'Выберите пользователя…',
    canAdd: 'Может добавлять админов (супер-админ)',
    canAddHint: 'Флаг can_add_admins — доступ к этому разделу',
    grant: 'Выдать',
    required: 'Выберите пользователя',
    noCandidates: 'Все пользователи уже админы',
  },
  confirm: {
    title: 'Снять админку',
    text: 'У {{fio}} ({{login}}) будут отозваны права администратора. Пользователь останется разметчиком.',
  },
  toasts: {
    granted: 'Админка выдана: {{fio}}',
    revoked: 'Админка снята: {{fio}}',
    flagOn: 'Флаг супер-админа включён: {{fio}}',
    flagOff: 'Флаг супер-админа снят: {{fio}}',
    lastSuperErr: 'Нельзя снять последнего супер-админа',
    loadErr: 'Не удалось загрузить список админов',
    saveErr: 'Не удалось сохранить изменения',
  },
}

const en: typeof ru = {
  title: 'Admins',
  intro: 'Grant and revoke administrator rights. This section is available to the super admin only.',
  onlySuper: {
    title: 'This section is available to the super admin only',
    description:
      'Admin rights are managed by an administrator with the can_add_admins flag (super admin). Contact them if changes are needed.',
  },
  grant: 'Grant admin rights',
  columns: {
    fio: 'Full name',
    login: 'Login',
    status: 'Status',
    canAdd: 'Can add admins',
    lastActive: 'Last active',
    actions: 'Actions',
  },
  status: {
    super: 'Super admin',
    admin: 'Administrator',
  },
  canAddLabel: 'can_add_admins flag: {{fio}}',
  revoke: 'Revoke admin rights',
  lastSuper: 'Last super admin',
  lastSuperHint:
    'There must always be at least one super admin — the last one cannot lose admin rights or the flag.',
  never: 'never signed in',
  empty: 'No admins yet',
  emptyHint: 'Grant admin rights to a user — the button is above the table',
  modal: {
    title: 'Grant admin rights',
    user: 'User',
    userPlaceholder: 'Choose a user…',
    canAdd: 'Can add admins (super admin)',
    canAddHint: 'The can_add_admins flag — access to this section',
    grant: 'Grant',
    required: 'Choose a user',
    noCandidates: 'All users are already admins',
  },
  confirm: {
    title: 'Revoke admin rights',
    text: 'Administrator rights will be revoked from {{fio}} ({{login}}). The user will remain an annotator.',
  },
  toasts: {
    granted: 'Admin rights granted: {{fio}}',
    revoked: 'Admin rights revoked: {{fio}}',
    flagOn: 'Super admin flag enabled: {{fio}}',
    flagOff: 'Super admin flag removed: {{fio}}',
    lastSuperErr: 'The last super admin cannot be revoked',
    loadErr: 'Failed to load the admin list',
    saveErr: 'Failed to save changes',
  },
}

registerFeatureI18n('admins', { ru, en })
