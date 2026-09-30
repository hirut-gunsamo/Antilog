import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { PasswordInput } from '../components/PasswordInput'
import { PermissionMatrix } from '../components/settings/PermissionMatrix'
import { SystemSettings } from '../components/settings/SystemSettings'
import { icons } from '../components/icons'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import {
  LANG_LABEL,
  LANGS,
  useLang,
  useT,
  type TranslationKey,
} from '../lib/i18n'
import { PAGE_SIZES, readPrefs, writePrefs } from '../lib/prefs'
import { applyTheme, readTheme, type Theme } from '../lib/theme'
import { useToasts } from '../lib/toasts'
import { ROLE_KEY } from '../lib/users'
import type { CurrentUser } from '../lib/types'
import styles from './Settings.module.css'

const THEMES: {
  value: Theme
  label: TranslationKey
  icon: keyof typeof icons
}[] = [
  { value: 'light', label: 'set.themeLight', icon: 'sun' },
  { value: 'dark', label: 'set.themeDark', icon: 'moon' },
  { value: 'system', label: 'set.themeSystem', icon: 'monitor' },
]

function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/**
 * The form only mounts once the signed-in user is known, and is keyed on their
 * id. That way the fields can be seeded straight from props — no effect
 * copying the user into state after the fact, and switching account resets it.
 */
export default function Settings() {
  const { user, logout } = useAuth()

  if (!user) return null

  return <SettingsForm key={user.id} user={user} onSignOut={logout} />
}

function SettingsForm({
  user,
  onSignOut,
}: {
  user: CurrentUser
  onSignOut: () => void
}) {
  const { lang, setLang } = useLang()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [pageSize, setPageSize] = useState(() => readPrefs().pageSize)

  const me = user
  const isOwner = user.role === 'OWNER'

  // Same rule the API applies, so the button disables rather than the request
  // failing.
  const phoneOk =
    /^[+()\d][\d\s()+-]*$/.test(phone.trim()) && phone.trim().length >= 7

  const profileChanged =
    name.trim() !== user.name ||
    email.trim() !== user.email ||
    phone.trim() !== (user.phone ?? '')

  const profileValid = phone.trim() === '' || phoneOk

  const passwordValid =
    currentPassword !== '' &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!profileChanged || !profileValid || savingProfile) return

    setSavingProfile(true)

    try {
      await api('/api/users/me', {
        method: 'PATCH',
        body: {
          ...(name.trim() !== me.name ? { name: name.trim() } : {}),
          ...(email.trim() !== me.email ? { email: email.trim() } : {}),
          ...(phone.trim() !== (me.phone ?? '') ? { phone: phone.trim() } : {}),
        },
      })

      push(
        'success',
        t('set.profileSaved'),
      )
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : 'Could not save your profile.',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault()
    if (!passwordValid || savingPassword) return

    setSavingPassword(true)

    try {
      await api('/api/users/me/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      })

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      push('success', t('toast.passwordChanged'))
    } catch (caught) {
      push(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not change your password.',
      )
    } finally {
      setSavingPassword(false)
    }
  }

  const manageable = [
    {
      to: '/branches',
      label: t('nav.branches'),
      note: t('set.branchesNote'),
      icon: 'branch' as const,
      owner: true,
    },
    {
      to: '/users',
      label: t('nav.users'),
      note: t('set.usersNote'),
      icon: 'users' as const,
      owner: true,
    },
    {
      to: '/inventory',
      label: t('nav.inventory'),
      note: t('set.inventoryNote'),
      icon: 'box' as const,
      owner: false,
    },
  ].filter((entry) => !entry.owner || user.role === 'OWNER')

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('nav.settings')}</h1>
          <p className={styles.subtitle}>{t('set.subtitle')}</p>
        </div>
      </header>

      <div className={styles.columns}>
        <div className={styles.column}>
          <GeneralSettings
            canEdit={isOwner}
            onSaved={(message) => push('success', message)}
            onError={(message) => push('error', message)}
          />

          <Card title={t('set.profile')} subtitle={t('set.profileNote')}>
            <form className={styles.form} onSubmit={saveProfile}>
              <div className={styles.who}>
                <span className={styles.avatar} aria-hidden="true">
                  {user.name
                    .split(' ')
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')
                    .toUpperCase()}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <span>
                    {t(ROLE_KEY[user.role])}
                    {` · ${user.branch?.name ?? t('set.orgWide')}`}
                  </span>
                </div>
              </div>

              <label className={styles.field}>
                <span>{t('dlg.fullName')}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('users.email')}<em>{t('set.emailIsUsername')}</em>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  spellCheck={false}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('users.phone')}<em>{t('set.yourPhone')}</em>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="0911 111 111"
                  maxLength={24}
                  spellCheck={false}
                />
              </label>

              {phone.trim() !== '' && !phoneOk ? (
                <p className={styles.warn}>{t('dlg.phoneInvalid')}</p>
              ) : null}

              {/* Role and branch move through their own endpoints and are the
                  Owner's to change, so they are shown but not editable here. */}
              <p className={styles.hint}>{t('set.roleSetByOwner')}</p>

              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={!profileChanged || !profileValid || savingProfile}
                >
                  {savingProfile ? t('common.saving') : t('set.saveProfile')}
                </button>
              </div>
            </form>
          </Card>

          <Card
            title={t('set.password')}
            subtitle={t('set.passwordNote')}
          >
            <form className={styles.form} onSubmit={savePassword}>
              <label className={styles.field}>
                <span>{t('set.currentPassword')}</span>
                <PasswordInput
                                    value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('set.newPassword')}<em>{t('dlg.atLeast8')}</em>
                </span>
                <PasswordInput
                                    value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>{t('set.confirmPassword')}</span>
                <PasswordInput
                                    value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              {newPassword !== '' && confirmPassword !== '' &&
              newPassword !== confirmPassword ? (
                <p className={styles.warn}>{t('set.noMatch')}</p>
              ) : newPassword !== '' && newPassword === currentPassword ? (
                <p className={styles.warn}>{t('set.mustDiffer')}</p>
              ) : null}

              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={!passwordValid || savingPassword}
                >
                  {savingPassword ? t('set.changing') : t('set.changePassword')}
                </button>
              </div>
            </form>
          </Card>

          {isOwner ? (
            <SystemSettings
              onSaved={(message) => push('success', message)}
              onError={(message) => push('error', message)}
            />
          ) : null}

          <Card title={t('set.about')}>
            <dl className={styles.facts}>
              <div>
                <dt>{t('set.signedInAs')}</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>{t('users.role')}</dt>
                <dd>{t(ROLE_KEY[user.role])}</dd>
              </div>
              <div>
                <dt>{t('det.branch')}</dt>
                <dd>{user.branch?.name ?? t('set.orgWide')}</dd>
              </div>
              <div>
                <dt>{t('set.browser')}</dt>
                <dd className={styles.small}>
                  {navigator.userAgent.split(') ').pop() ?? navigator.userAgent}
                </dd>
              </div>
            </dl>

            <Empty>{t('set.offlineMissing')}</Empty>

            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.signOut}
                onClick={onSignOut}
              >
                <Icon name="logout" size={16} />
                {t('set.signOut')}
              </button>
            </div>
          </Card>
        </div>

        <div className={styles.column}>
          <Card
            title={t('set.appearance')}
            subtitle={t('set.appearanceNote')}
          >
            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('set.theme')}</span>
              <div className={styles.themeRow}>
                {THEMES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      theme === option.value
                        ? `${styles.themeCard} ${styles.themeOn}`
                        : styles.themeCard
                    }
                    aria-pressed={theme === option.value}
                    onClick={() => {
                      setTheme(option.value)
                      applyTheme(option.value)
                    }}
                  >
                    <Icon name={option.icon} size={19} />
                    {t(option.label)}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('set.language')}</span>
              <div className={styles.themeRow}>
                {LANGS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={
                      lang === option
                        ? `${styles.themeCard} ${styles.themeOn}`
                        : styles.themeCard
                    }
                    aria-pressed={lang === option}
                    onClick={() => setLang(option)}
                  >
                    {LANG_LABEL[option]}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>{t('set.languageNote')}</p>
            </div>

            <div className={styles.group}>
              <span className={styles.groupLabel}>{t('set.rowsPerPage')}</span>
              <div className={styles.themeRow}>
                {PAGE_SIZES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={
                      pageSize === option
                        ? `${styles.themeCard} ${styles.themeOn}`
                        : styles.themeCard
                    }
                    aria-pressed={pageSize === option}
                    onClick={() => {
                      setPageSize(option)
                      writePrefs({ pageSize: option })
                      push('success', t('toast.rowsPerPage', { n: option }))
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>{t('set.rowsNote')}</p>
            </div>
          </Card>

          <Card title={t('set.manage')} subtitle={t('set.manageNote')}>
            <ul className={styles.links}>
              {manageable.map((entry) => (
                <li key={entry.to}>
                  <Link to={entry.to}>
                    <span className={styles.linkIcon}>
                      <Icon name={entry.icon} size={17} />
                    </span>
                    <span className={styles.linkText}>
                      <strong>{entry.label}</strong>
                      <em>{entry.note}</em>
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <PermissionMatrix />
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
