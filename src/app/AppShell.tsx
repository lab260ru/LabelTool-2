import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useSession } from './session'
import './shell.css'

/**
 * Shared frame: a single left menu (rail) + content. The rail is shown for an
 * authenticated user across all sections; on the login screen the shell is not
 * rendered (the /login route sits outside AppShell).
 */
export function AppShell() {
  const { user } = useSession()
  return (
    <div className="lt-shell">
      {user && <Sidebar />}
      <main className="lt-main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
