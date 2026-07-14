import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogoMark } from '../components/Logo/Logo'
import {
  IconChart,
  IconDashboard,
  IconFolder,
  IconKey,
  IconShield,
  IconSignOut,
  IconUser,
  IconUsers,
  IconWaveform,
} from '../components/icons'
import { ProfileModal } from '../features/profile'
import type { ProfileSection } from '../features/profile'
import { QuickSettings } from './QuickSettings'
import { roleLabelKey, userInitials, useSession } from './session'

/**
 * A single left menu (all roles except the login screen) — a compact icon rail.
 * Top: logo + navigation — "Labeling" and (for admin) the admin sections.
 * Bottom: language (globe), theme and profile with sign-out (on avatar click).
 * The item/icon name is shown as a tooltip on hover/focus; for screen readers it
 * is duplicated in aria-label.
 */
export function Sidebar() {
  const { t } = useTranslation('common')
  const { user, logout } = useSession()
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const [profileSection, setProfileSection] = useState<ProfileSection | null>(null)

  // An outside click and Escape close the menu
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  if (!user) return null

  const isAdmin = user.role === 'admin'
  const home = isAdmin ? '/admin/dashboard' : '/label'

  // "Labeling" is always on top; the admin sections are for admin only
  const items = [
    { to: '/label', label: t('nav.labeling'), icon: IconWaveform },
    ...(isAdmin
      ? [
          { to: '/admin/dashboard', label: t('nav.dashboard'), icon: IconDashboard },
          { to: '/admin/projects', label: t('nav.projects'), icon: IconFolder },
          { to: '/admin/users', label: t('nav.users'), icon: IconUsers },
          { to: '/admin/statistics', label: t('nav.statistics'), icon: IconChart },
          { to: '/admin/admins', label: t('nav.admins'), icon: IconShield },
        ]
      : []),
  ]

  function openProfile(section: ProfileSection) {
    setMenuOpen(false)
    setProfileSection(section)
  }
  function closeProfile() {
    setProfileSection(null)
    avatarRef.current?.focus()
  }
  function onSignOut() {
    setMenuOpen(false)
    void logout().then(() => navigate('/login'))
  }

  return (
    <aside className="lt-sidebar">
      <Link to={home} className="lt-sidebar__logo" aria-label={t('app.name')}>
        <LogoMark size={20} />
      </Link>

      <nav className="lt-sidebar__nav" aria-label={t('nav.adminSidebar')}>
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `lt-sidebar__item${isActive ? ' lt-sidebar__item--active' : ''}`
            }
            aria-label={label}
          >
            <Icon size={19} className="lt-sidebar__icon" />
            <span className="lt-sidebar__tip" aria-hidden="true">
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Footer: language, theme and profile with sign-out */}
      <div className="lt-sidebar__footer">
        <QuickSettings />

        <div className="lt-sidebar__user" ref={menuRef}>
          <button
            type="button"
            ref={avatarRef}
            className="lt-sidebar__item lt-sidebar__avatar"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('user.menu')}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="lt-user__avatar" aria-hidden="true">
              {userInitials(user.fio)}
            </span>
            <span className="lt-sidebar__tip" aria-hidden="true">
              {user.fio}
            </span>
          </button>

          {menuOpen && (
            <div className="lt-sidebar__menu" role="menu" aria-label={t('user.menu')}>
              <div className="lt-sidebar__menuhead">
                <span className="lt-user__name">{user.fio}</span>
                <span className="lt-user__role">{t(roleLabelKey(user))}</span>
              </div>
              <div className="lt-user__menusep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="lt-user__menuitem"
                onClick={() => openProfile('info')}
              >
                <IconUser size={16} />
                {t('user.profile')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="lt-user__menuitem"
                onClick={() => openProfile('password')}
              >
                <IconKey size={16} />
                {t('user.changePassword')}
              </button>
              <div className="lt-user__menusep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="lt-user__menuitem lt-user__menuitem--danger"
                onClick={onSignOut}
              >
                <IconSignOut size={16} />
                {t('user.signOut')}
              </button>
            </div>
          )}
        </div>
      </div>

      {profileSection !== null && (
        <ProfileModal initialSection={profileSection} onClose={closeProfile} />
      )}
    </aside>
  )
}
