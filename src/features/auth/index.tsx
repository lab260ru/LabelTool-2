/**
 * Login screen /login (outside admin/label layouts): a centered
 * card with a logo, login/password fields and a primary Sign in button.
 * Error — by machine-readable detail from ApiError (401 → "Invalid login or password").
 * The labeler self-registration link leads to /register.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import type { User } from '../../api/types'
import { Button, Card, Logo, TextField } from '../../components'
import { useSession } from './session'
import './i18n'
import './auth.css'

/** Error key (namespace 'auth') by ApiError.detail/status. */
function errorKeyOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'errors.invalidCredentials'
    if (err.detail === 'network_error') return 'errors.network'
  }
  return 'errors.generic'
}

/** Where to go after login: state.from (if a guard led here) or the role's home section. */
function afterLoginPath(user: User, from: string | undefined): string {
  const home = user.role === 'admin' ? '/admin/dashboard' : '/label'
  if (!from || from === '/login') return home
  return from
}

export default function LoginPage() {
  const { t } = useTranslation('auth')
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setErrorKey(null)
    setSubmitting(true)
    try {
      const user = await login({ login: loginValue.trim(), password })
      const from = (location.state as { from?: string } | null)?.from
      navigate(afterLoginPath(user, from), { replace: true })
    } catch (err) {
      setErrorKey(errorKeyOf(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="lt-login">
      <Card className="lt-login__card" padding="lg">
        <div className="lt-login__logo">
          <Logo size={26} />
        </div>
        <h1 className="lt-login__title">{t('title')}</h1>
        <form className="lt-login__form" onSubmit={onSubmit}>
          <TextField
            label={t('loginLabel')}
            name="login"
            autoComplete="username"
            autoFocus
            required
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
          />
          <TextField
            label={t('passwordLabel')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {errorKey && (
            <p className="lt-login__error" role="alert">
              {t(errorKey)}
            </p>
          )}
          <Button type="submit" variant="primary" fullWidth loading={submitting}>
            {t('submit')}
          </Button>
        </form>
        <p className="lt-login__alt">
          {t('noAccount')}{' '}
          <Link to="/register" className="lt-login__link">
            {t('registerLink')}
          </Link>
        </p>
      </Card>
    </main>
  )
}
