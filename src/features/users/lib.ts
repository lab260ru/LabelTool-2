/** Helpers for the Users feature: permission-matrix semantics. */
import type { PermissionValue, User } from '../../api/types'

/** Effective permission: allowed if the value is *_allow (admin_* takes priority in the data model). */
export function isAllowed(value: PermissionValue): boolean {
  return value === 'user_allow' || value === 'admin_allow'
}

/** Value pinned by an admin (admin_allow / admin_block). */
export function isAdminSet(value: PermissionValue): boolean {
  return value === 'admin_allow' || value === 'admin_block'
}

/** Super admin — an admin with the can_add_admins flag. */
export function isSuperAdmin(user: User | null): boolean {
  return user !== null && user.role === 'admin' && user.can_add_admins
}

/** Cell read-only for the current admin: an admin value can only be changed by a super admin. */
export function isCellLocked(value: PermissionValue, actorIsSuperAdmin: boolean): boolean {
  return !actorIsSuperAdmin && isAdminSet(value)
}

/** All 4 matrix values — order for the selects. */
export const PERMISSION_VALUES: readonly PermissionValue[] = [
  'user_allow',
  'user_block',
  'admin_allow',
  'admin_block',
]

/** Format a date for the current language ("last activity" metrics). */
export function formatDate(isoDate: string | null, lang: string, fallback: string): string {
  if (!isoDate) return fallback
  const locale = lang.startsWith('ru') ? 'ru-RU' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(isoDate))
}
