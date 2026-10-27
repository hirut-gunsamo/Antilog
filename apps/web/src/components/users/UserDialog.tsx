import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { ROLE_KEY } from '../../lib/users'
import type { AppUser, BranchRow } from '../../lib/types'
import { PasswordInput } from '../PasswordInput'
import styles from '../inventory/Panel.module.css'

/**
 * Create a user, or edit an existing one.
 *
 * The two differ in what the API accepts. Creating takes name, email,
 * password, role and branch together. Editing takes only name, email and
 * password — role and branch move through their own endpoints, because both
 * have rules a plain field update cannot express.
 */
export function UserDialog({
  user,
  onClose,
  onDone,
}: {
  user?: AppUser
  onClose: () => void
  onDone: (message: string) => void
}) {
  const editing = user != null
  const t = useT()

  const [branches, setBranches] = useState<BranchRow[]>([])
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'SUPERVISOR' | 'SALES'>('SALES')
  const [branchId, setBranchId] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (editing) return

    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', {
      signal: controller.signal,
    })
      .then((payload) => setBranches(payload.branches ?? []))
      .catch(() => {
        /* The select stays empty and the form cannot be submitted. */
      })

    return () => controller.abort()
  }, [editing])

  const active = useMemo(
    () => branches.filter((entry) => entry.isActive),
    [branches],
  )

  // A branch may have several supervisors, so none is ever "taken".
  const takenSupervisor = false

  // Matches the API's rule: at least 7 characters, digits and + ( ) - only.
  const phoneOk = /^[+()\d][\d\s()+-]*$/.test(phone.trim()) &&
    phone.trim().length >= 7

  const valid = editing
    ? name.trim().length >= 2 &&
      email.trim() !== '' &&
      (password === '' || password.length >= 8) &&
      (phone.trim() === '' || phoneOk)
    : name.trim().length >= 2 &&
      email.trim() !== '' &&
      password.length >= 8 &&
      phoneOk &&
      branchId !== '' &&
      !takenSupervisor

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await api(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: {
            ...(name.trim() !== user.name ? { name: name.trim() } : {}),
            ...(email.trim() !== user.email ? { email: email.trim() } : {}),
            ...(phone.trim() !== (user.phone ?? '')
              ? { phone: phone.trim() }
              : {}),
            ...(password !== '' ? { password } : {}),
          },
        })

        onDone(t('done.userUpdated', { name: name.trim() }))
      } else {
        await api('/api/users', {
          method: 'POST',
          body: {
            name: name.trim(),
            email: email.trim(),
            password,
            phone: phone.trim(),
            role,
            branchId,
          },
        })

        const where = active.find((entry) => entry.id === branchId)?.name

        onDone(
          t('done.userAdded', {
            name: name.trim(),
            role: t(ROLE_KEY[role]),
            branch: where ?? t('done.theirBranch'),
          }),
        )
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the user.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${user.name}` : 'Add user'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{editing ? t('dlg.editUser') : t('dlg.addUser')}</h2>
            <p>
              {editing
                ? t('dlg.editUserNote')
                : t('dlg.addUserNote')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('dlg.fullName')}<em>{t('common.required')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('users.email')}<em>{t('dlg.emailIsLogin')}</em>
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('users.phone')}
              <em>
                {editing ? t('dlg.phoneNote') : t('common.required')}
              </em>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0911 111 111"
              maxLength={24}
              spellCheck={false}
              required={!editing}
            />
          </label>

          {phone.trim() !== '' && !phoneOk ? (
            <p className={styles.tally} data-bad="">
{t('dlg.phoneInvalid')}
            </p>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('dlg.password')}
              <em>
                {editing ? t('dlg.leaveBlank') : t('dlg.atLeast8')}
              </em>
            </span>
            <PasswordInput
                            value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={editing ? undefined : 8}
              required={!editing}
            />
          </label>

          {!editing ? (
            <>
              <label className={styles.field}>
                <span>{t('users.role')}</span>
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as 'SUPERVISOR' | 'SALES')
                  }
                >
                  <option value="SALES">{t("role.SALES")}</option>
                  <option value="SUPERVISOR">{t("role.SUPERVISOR")}</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>
                  {t('common.branch')}<em>{t('common.required')}</em>
                </span>
                <select
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  required
                >
                  <option value="">{t("dlg.selectBranch")}</option>
                  {active.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              {takenSupervisor ? (
                <p className={styles.blocked}>
{t('dlg.branchTaken')}
                </p>
              ) : null}
            </>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('common.saving') : editing ? t('dlg.saveChanges') : t('users.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
