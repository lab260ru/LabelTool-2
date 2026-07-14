/**
 * Self-registration screen /register (outside layouts): a card with
 * full name / login / group / password / repeat fields. Creates a labeler (role=user) and
 * auto-logs-in (session.register), then leads to the Labeling section. Errors —
 * by machine-readable detail from ApiError (login_taken / bad_login / …).
 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { Button, Card, Logo, TextField } from '../../components'
import { useSession } from './session'
import './i18n'
import './auth.css'

const MIN_PASSWORD = 8

/** Error key (namespace 'auth', register.errors.*) by ApiError.detail/status. */
function errorKeyOf(err: unknown): string {
  if (err instanceof ApiError) {
    const known = ['fio_required', 'bad_login', 'login_taken', 'password_too_short']
    if (known.includes(err.detail)) return `register.errors.${err.detail}`
    if (err.detail === 'network_error') return 'register.errors.network'
  }
  return 'register.errors.generic'
}

export default function RegisterPage() {
  const { t } = useTranslation('auth')
  const { register } = useSession()
  const navigate = useNavigate()

  const [fio, setFio] = useState('')
  const [login, setLogin] = useState('')
  const [group, setGroup] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const mismatch = password2.length > 0 && password !== password2
  const canSubmit =
    fio.trim().length > 0 &&
    login.trim().length > 0 &&
    password.length >= MIN_PASSWORD &&
    password === password2 &&
    !submitting

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setErrorKey(null)
    setSubmitting(true)
    try {
      await register({
        fio: fio.trim(),
        login: login.trim(),
        password,
        group: group.trim() || null,
      })
      navigate('/label', { replace: true })
    } catch (err) {
      setErrorKey(errorKeyOf(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="lt-login">
      <Card className="lt-login__card lt-login__card--register" padding="lg">
        <div className="lt-login__logo">
          <Logo size={26} />
        </div>
        <h1 className="lt-login__title">{t('register.title')}</h1>
        <form className="lt-login__form" onSubmit={onSubmit}>
          <TextField
            label={t('register.fioLabel')}
            name="fio"
            autoComplete="name"
            autoFocus
            required
            value={fio}
            onChange={(e) => setFio(e.target.value)}
          />
          <TextField
            label={t('register.loginLabel')}
            name="login"
            autoComplete="username"
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <TextField
            label={t('register.groupLabel')}
            name="group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <TextField
            label={t('register.passwordLabel')}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint={t('register.passwordHint')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label={t('register.password2Label')}
            name="password2"
            type="password"
            autoComplete="new-password"
            required
            error={mismatch ? t('register.mismatch') : undefined}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
          {errorKey && (
            <p className="lt-login__error" role="alert">
              {t(errorKey)}
            </p>
          )}
          <Button type="submit" variant="primary" fullWidth loading={submitting} disabled={!canSubmit}>
            {t('register.submit')}
          </Button>
        </form>
        <p className="lt-login__alt">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="lt-login__link">
            {t('register.loginLink')}
          </Link>
        </p>
      </Card>
    </main>
  )
}
