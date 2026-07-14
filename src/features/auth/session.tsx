/**
 * Session context: on start GET /auth/me → user;
 * 401 → anonymous, guards redirect to /login (except /login and /showcase).
 * Runs against the real backend (docker demo): /auth/me returns the user or 401.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api } from '../../api/client'
import type { LoginRequest, RegisterRequest, User } from '../../api/types'
import { Spinner } from '../../components'

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export interface SessionValue {
  /** Current user; null — still loading or anonymous. */
  user: User | null
  status: SessionStatus
  /** POST /auth/login; throws ApiError (401 detail='invalid_credentials'). */
  login: (body: LoginRequest) => Promise<User>
  /** POST /auth/register; labeler self-registration + auto-login (ApiError by detail). */
  register: (body: RegisterRequest) => Promise<User>
  /** POST /auth/logout; the local session is reset even on a network error. */
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')

  // A single session check at app start: /auth/me → user | 401.
  useEffect(() => {
    let cancelled = false
    api.auth.me().then(
      (me) => {
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      },
      () => {
        if (cancelled) return
        setUser(null)
        setStatus('anonymous')
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (body: LoginRequest) => {
    const me = await api.auth.login(body)
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  const register = useCallback(async (body: RegisterRequest) => {
    const me = await api.auth.register(body) // the server auto-logs-in (sets the cookie)
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } catch {
      // A network error does not prevent finishing the session locally
    }
    setUser(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo<SessionValue>(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a <SessionProvider>')
  return ctx
}

/** Centered spinner while /auth/me is in flight (reuses the hydration style). */
function SessionPending() {
  const { t } = useTranslation('common')
  return (
    <div className="lt-hydrate-fallback">
      <Spinner size={36} label={t('loading')} />
    </div>
  )
}

/**
 * Guard route (layout route with Outlet):
 *  - session loading → spinner;
 *  - anonymous → /login remembering the original path (state.from);
 *  - adminOnly and role=user → /label (a labeler cannot reach /admin/*).
 */
export function RequireSession({ adminOnly = false }: { adminOnly?: boolean }) {
  const { user, status } = useSession()
  const location = useLocation()

  if (status === 'loading') return <SessionPending />
  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
    )
  }
  if (adminOnly && user.role !== 'admin') return <Navigate to="/label" replace />
  return <Outlet />
}

/** Avatar initials: "Dmitry Sokolov" → "DS". */
export function userInitials(fio: string): string {
  return fio
    .trim()
    .split(/\s+/, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Role key in the common namespace: Super-admin / Administrator / Labeler. */
export function roleLabelKey(user: Pick<User, 'role' | 'can_add_admins'>): string {
  if (user.role !== 'admin') return 'roles.user'
  return user.can_add_admins ? 'roles.superAdmin' : 'roles.admin'
}
