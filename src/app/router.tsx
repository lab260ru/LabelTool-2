import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { Spinner } from '../components'
import { AdminLayout } from './AdminLayout'
import { AppShell } from './AppShell'
import { LabelLayout } from './LabelLayout'
import { NotFound } from './NotFound'
import { RequireSession, SessionProvider } from './session'

/**
 * Initial-hydration fallback for lazy routes (otherwise react-router v7 warns
 * "No HydrateFallback element provided"). A centered spinner with a label for
 * the screen reader.
 */
function HydrateFallback() {
  const { t } = useTranslation('common')
  return (
    <div className="lt-hydrate-fallback">
      <Spinner size={36} label={t('loading')} />
    </div>
  )
}

/**
 * Route table — the route contract (fixed):
 *   /admin/dashboard                → features/dashboard
 *   /admin/projects[/:id]           → features/projects
 *   /admin/projects/:id/upload      → features/upload
 *   /admin/projects/:id/export      → features/export
 *   /admin/users                    → features/users
 *   /admin/admins                   → features/admins
 *   /admin/statistics               → features/statistics
 *   /label, /label/task             → features/workspace
 * Plus /login — sign-in (outside the layouts) and, in dev builds only, /showcase —
 * the component showcase.
 * Each feature lazily returns a default component from src/features/<f>/index.tsx.
 *
 * Session: SessionProvider at the root (visible to both /login and the shell);
 * RequireSession — a guard "layer": anonymous → /login (state.from),
 * role=user in /admin/* → /label. /login and /showcase have no guard.
 */
function lazyFeature(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const router = createBrowserRouter([
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    hydrateFallbackElement: <HydrateFallback />,
    children: [
      { path: 'login', lazy: lazyFeature(() => import('../features/auth')) },
      {
        path: 'register',
        lazy: lazyFeature(() => import('../features/auth/Register')),
      },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/admin/dashboard" replace /> },
          {
            path: 'admin',
            element: <RequireSession adminOnly />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { index: true, element: <Navigate to="/admin/dashboard" replace /> },
                  { path: 'dashboard', lazy: lazyFeature(() => import('../features/dashboard')) },
                  { path: 'projects', lazy: lazyFeature(() => import('../features/projects')) },
                  { path: 'projects/:id', lazy: lazyFeature(() => import('../features/projects')) },
                  { path: 'projects/:id/upload', lazy: lazyFeature(() => import('../features/upload')) },
                  { path: 'projects/:id/export', lazy: lazyFeature(() => import('../features/export')) },
                  { path: 'users', lazy: lazyFeature(() => import('../features/users')) },
                  { path: 'admins', lazy: lazyFeature(() => import('../features/admins')) },
                  { path: 'statistics', lazy: lazyFeature(() => import('../features/statistics')) },
                ],
              },
            ],
          },
          {
            path: 'label',
            element: <RequireSession />,
            children: [
              {
                element: <LabelLayout />,
                children: [
                  { index: true, lazy: lazyFeature(() => import('../features/workspace')) },
                  { path: 'task', lazy: lazyFeature(() => import('../features/workspace')) },
                ],
              },
            ],
          },
          // Component showcase: dev builds only
          ...(import.meta.env.DEV
            ? [
                {
                  path: 'showcase',
                  element: <LabelLayout />,
                  children: [
                    { index: true, lazy: lazyFeature(() => import('../components/showcase/Showcase')) },
                  ],
                },
              ]
            : []),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
