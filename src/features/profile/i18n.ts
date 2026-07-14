/**
 * User profile · i18n (namespace 'profile', ru + en at once).
 * Shared strings (roles, task types, buttons) — from the 'common' namespace.
 */
import { registerFeatureI18n } from '../../i18n'

const ru = {
  title: 'Профиль',
  tabsLabel: 'Разделы профиля',
  tabs: {
    info: 'Данные',
    password: 'Пароль',
  },
  info: {
    login: 'Логин',
    group: 'Группа',
    noGroup: '—',
    metrics: 'Метрики',
    tasksDone: 'Сдано задач',
    agreement: 'Согласие',
    permissions: 'Права на типы задач',
    permAllowed: '{{type}} — доступен',
    permBlocked: '{{type}} — закрыт',
    permAdminSet: 'закреплено админом',
    permLegend:
      'Зелёная метка — тип задачи доступен, коралловая — закрыт; рамка вокруг метки — значение закреплено админом.',
  },
  password: {
    current: 'Текущий пароль',
    new: 'Новый пароль',
    repeat: 'Повторите новый пароль',
    hint: 'Минимум 8 символов',
    submit: 'Сменить пароль',
    required: 'Обязательное поле',
    tooShort: 'Минимум 8 символов',
    mismatch: 'Пароли не совпадают',
    success: 'Пароль изменён',
  },
  errors: {
    wrong_old_password: 'Неверный текущий пароль',
    password_too_short: 'Новый пароль слишком короткий — минимум 8 символов',
    generic: 'Не удалось сменить пароль. Попробуйте ещё раз',
  },
}

const en: typeof ru = {
  title: 'Profile',
  tabsLabel: 'Profile sections',
  tabs: {
    info: 'Details',
    password: 'Password',
  },
  info: {
    login: 'Login',
    group: 'Group',
    noGroup: '—',
    metrics: 'Metrics',
    tasksDone: 'Tasks submitted',
    agreement: 'Agreement',
    permissions: 'Task-type permissions',
    permAllowed: '{{type}} — allowed',
    permBlocked: '{{type}} — blocked',
    permAdminSet: 'admin-locked',
    permLegend:
      'A green chip means the task type is allowed, a coral one means it is blocked; a border around a chip marks a value locked by an admin.',
  },
  password: {
    current: 'Current password',
    new: 'New password',
    repeat: 'Repeat the new password',
    hint: 'At least 8 characters',
    submit: 'Change password',
    required: 'Required field',
    tooShort: 'At least 8 characters',
    mismatch: 'Passwords do not match',
    success: 'Password changed',
  },
  errors: {
    wrong_old_password: 'The current password is incorrect',
    password_too_short: 'The new password is too short — at least 8 characters',
    generic: 'Failed to change the password. Please try again',
  },
}

registerFeatureI18n('profile', { ru, en })
