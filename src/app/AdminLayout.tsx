import { Outlet } from 'react-router-dom'

/** Admin section (/admin/*) — passthrough; the rail and container come from AppShell. */
export function AdminLayout() {
  return <Outlet />
}
