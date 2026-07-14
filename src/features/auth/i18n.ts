/**
 * i18n for the «Login» and «Registration» features (namespace 'auth', ru + en).
 * Shared strings (roles, buttons) — from the 'common' namespace.
 */
import { registerFeatureI18n } from '../../i18n'

const ru = {
  title: 'Вход в систему',
  loginLabel: 'Логин',
  passwordLabel: 'Пароль',
  submit: 'Войти',
  errors: {
    invalidCredentials: 'Неверный логин или пароль',
    network: 'Нет соединения с сервером. Попробуйте ещё раз.',
    generic: 'Не удалось войти. Попробуйте ещё раз.',
  },
  // Link to registration from the login screen
  noAccount: 'Нет аккаунта?',
  registerLink: 'Зарегистрироваться',
  // Registration screen
  register: {
    title: 'Регистрация',
    fioLabel: 'ФИО',
    loginLabel: 'Логин',
    groupLabel: 'Группа (необязательно)',
    passwordLabel: 'Пароль',
    password2Label: 'Повторите пароль',
    passwordHint: 'Не короче 8 символов',
    submit: 'Зарегистрироваться',
    haveAccount: 'Уже есть аккаунт?',
    loginLink: 'Войти',
    mismatch: 'Пароли не совпадают',
    errors: {
      fio_required: 'Укажите ФИО',
      bad_login: 'Логин: латиница, цифры, . _ -, не короче 3 символов',
      login_taken: 'Логин уже занят',
      password_too_short: 'Пароль не короче 8 символов',
      network: 'Нет соединения с сервером. Попробуйте ещё раз.',
      generic: 'Не удалось зарегистрироваться. Попробуйте ещё раз.',
    },
  },
}

const en: typeof ru = {
  title: 'Sign in',
  loginLabel: 'Login',
  passwordLabel: 'Password',
  submit: 'Sign in',
  errors: {
    invalidCredentials: 'Invalid login or password',
    network: 'Cannot reach the server. Please try again.',
    generic: 'Sign-in failed. Please try again.',
  },
  noAccount: 'No account?',
  registerLink: 'Sign up',
  register: {
    title: 'Sign up',
    fioLabel: 'Full name',
    loginLabel: 'Login',
    groupLabel: 'Group (optional)',
    passwordLabel: 'Password',
    password2Label: 'Repeat password',
    passwordHint: 'At least 8 characters',
    submit: 'Sign up',
    haveAccount: 'Already have an account?',
    loginLink: 'Sign in',
    mismatch: 'Passwords do not match',
    errors: {
      fio_required: 'Enter your full name',
      bad_login: 'Login: letters, digits, . _ -, at least 3 characters',
      login_taken: 'Login is already taken',
      password_too_short: 'Password must be at least 8 characters',
      network: 'Cannot reach the server. Please try again.',
      generic: 'Sign-up failed. Please try again.',
    },
  },
}

registerFeatureI18n('auth', { ru, en })
