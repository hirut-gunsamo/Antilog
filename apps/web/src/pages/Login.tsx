import { useState, type FormEvent } from 'react'

import { useAuth } from '../auth/context'
import { Logo } from '../components/Logo'
import { PasswordInput } from '../components/PasswordInput'
import { useT } from '../lib/i18n'
import styles from './Login.module.css'

export default function Login() {
  const { login } = useAuth()
  const t = useT()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      await login(email.trim(), password)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('login.failed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.brand}>
          <Logo size={46} />
          <div>
            <h1 className={styles.title}>{t('login.title')}</h1>
            <p className={styles.subtitle}>{t('login.subtitle')}</p>
          </div>
        </div>

        <label className={styles.field}>
          <span>{t('login.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className={styles.field}>
          <span>{t('login.password')}</span>
          <PasswordInput
                        value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </label>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </div>
  )
}
