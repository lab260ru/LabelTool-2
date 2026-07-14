/**
 * Re-export of the session context for the shell
 * (the implementation lives in src/features/auth/session.tsx, the app consumes it from here).
 */
export { RequireSession, SessionProvider, roleLabelKey, userInitials, useSession } from '../features/auth/session'
export type { SessionStatus, SessionValue } from '../features/auth/session'
