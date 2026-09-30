import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { MoveBranchDialog } from '../components/users/MoveBranchDialog'
import { UserDialog } from '../components/users/UserDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import { avatarHue, initials, ROLE_LABEL } from '../lib/users'
import type { AppUser, Role } from '../lib/types'
import styles from './Users.module.css'

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

function isoDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

export default function Users() {
  const { user: me } = useAuth()

  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role | 'ALL'>('ALL')
  const [branch, setBranch] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [moving, setMoving] = useState<AppUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ users: AppUser[] }>('/api/users', {
          signal: controller.signal,
        })

        setUsers(payload.users ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('users.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t])

  useEffect(() => {
    if (!openMenu) return

    function close() {
      setOpenMenu(null)
      setConfirmDelete(null)
    }

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const rows = useMemo(() => users ?? [], [users])

  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Map<string, string>(branchList)
    for (const person of rows) {
      if (person.branch) seen.set(person.branch.id, person.branch.name)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows, branchList])

  const summary = useMemo(
    () => ({
      total: rows.length,
      owners: rows.filter((person) => person.role === 'OWNER').length,
      supervisors: rows.filter((person) => person.role === 'SUPERVISOR').length,
      sales: rows.filter((person) => person.role === 'SALES').length,
      inactive: rows.filter((person) => !person.isActive).length,
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    return rows
      .filter((person) => {
        if (role !== 'ALL' && person.role !== role) return false
        if (branch !== 'ALL' && person.branch?.id !== branch) return false
        if (status === 'ACTIVE' && !person.isActive) return false
        if (status === 'INACTIVE' && person.isActive) return false

        if (term) {
          const hit =
            person.name.toLowerCase().includes(term) ||
            person.email.toLowerCase().includes(term) ||
            (person.phone ?? '').toLowerCase().includes(term) ||
            (person.branch?.name ?? '').toLowerCase().includes(term)

          if (!hit) return false
        }

        return true
      })
      // Owner first, then supervisors, then sales; alphabetical within each.
      .sort((a, b) => {
        const rank = { OWNER: 0, SUPERVISOR: 1, SALES: 2 } as const
        if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role]
        return a.name.localeCompare(b.name)
      })
  }, [rows, role, branch, status, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // Only the Owner manages users; a Supervisor may read their branch's list.
  const isOwner = me?.role === 'OWNER'

  const filtersOn =
    search !== '' || role !== 'ALL' || branch !== 'ALL' || status !== 'ALL'

  function reset() {
    setSearch('')
    setRole('ALL')
    setBranch('ALL')
    setStatus('ALL')
    setPage(1)
  }

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function setActive(person: AppUser, isActive: boolean) {
    setPending(person.id)
    setOpenMenu(null)

    try {
      await api(`/api/users/${person.id}/status`, {
        method: 'PATCH',
        body: { isActive },
      })

      push(
        'success',
        `${person.name} ${isActive ? 'reactivated' : 'deactivated'}.`,
      )
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('users.changeFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  async function remove(person: AppUser) {
    setPending(person.id)
    setOpenMenu(null)
    setConfirmDelete(null)

    try {
      await api(`/api/users/${person.id}`, { method: 'DELETE' })
      push('success', t('toast.deleted', { name: person.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('users.deleteFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  const exportName = `users-${isoDay(new Date())}.csv`
  const exportRows = selected.size > 0 ? selected.size : filtered.length

  function exportCsv() {
    const list =
      selected.size > 0
        ? filtered.filter((person) => selected.has(person.id))
        : filtered

    const header = [
      'Name',
      'Email',
      'Phone',
      'Role',
      'Branch',
      'Status',
      'Joined',
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...list.map((person) =>
        [
          person.name,
          person.email,
          person.phone ?? '',
          ROLE_LABEL[person.role],
          person.branch?.name ?? '',
          person.isActive ? 'Active' : 'Inactive',
          new Date(person.createdAt).toISOString().slice(0, 10),
        ]
          .map(escape)
          .join(','),
      ),
    ]

    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exportName
    link.click()
    URL.revokeObjectURL(url)

    push('success', t('toast.savedToDownloads', { name: exportName }))
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("users.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!users) {
    return (
      <div className={styles.page}>
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.skeletonCard} />
      </div>
    )
  }

  const tiles = [
    { key: 'total', tone: 'blue', icon: 'users' as const, label: 'Total Users', value: summary.total },
    ...(isOwner
      ? [
          {
            key: 'owners',
            tone: 'green',
            icon: 'check' as const,
            label: 'Owners',
            value: summary.owners,
          },
        ]
      : []),
    { key: 'supervisors', tone: 'blue', icon: 'users' as const, label: 'Supervisors', value: summary.supervisors },
    { key: 'sales', tone: 'amber', icon: 'cart' as const, label: 'Sales Staff', value: summary.sales },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('users.title')}</h1>
          <p className={styles.subtitle}>
{t('users.note')}
          </p>
        </div>

        <div className={styles.headActions}>
          {isOwner ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} />
              {t('users.add')}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} className={styles.tile} data-tone={tile.tone}>
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={19} />
            </span>
            <div className={styles.tileBody}>
              <span className={styles.tileLabel}>{tile.label}</span>
              <strong className={`${styles.tileValue} tabular`}>
                {count(tile.value)}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.filters}>
          <label className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => change(setSearch)(event.target.value)}
              placeholder={t("users.searchPlaceholder")}
              aria-label={t("users.searchLabel")}
            />
          </label>

          <select
            className={styles.select}
            value={role}
            onChange={(event) => change(setRole)(event.target.value as Role | 'ALL')}
            aria-label={t("users.roleFilter")}
          >
            <option value="ALL">{t("users.allRoles")}</option>
            <option value="OWNER">{t("role.OWNER")}</option>
            <option value="SUPERVISOR">{t("role.SUPERVISOR")}</option>
            <option value="SALES">{t("role.SALES")}</option>
          </select>

          {isOwner ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => change(setBranch)(event.target.value)}
              aria-label={t("inv.branchFilter")}
            >
              <option value="ALL">{t("inv.allBranches")}</option>
              {branches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className={styles.select}
            value={status}
            onChange={(event) => change(setStatus)(event.target.value)}
            aria-label={t("inv.statusFilter")}
          >
            <option value="ALL">{t("users.allStatus")}</option>
            <option value="ACTIVE">{t("users.active")}</option>
            <option value="INACTIVE">{t("users.inactive")}</option>
          </select>

          <button
            className={styles.reset}
            type="button"
            onClick={reset}
            disabled={!filtersOn}
          >
            {t('common.reset')}
          </button>

          <DownloadButton
            filename={exportName}
            note={`${exportRows} user${exportRows === 1 ? '' : 's'}`}
            onConfirm={exportCsv}
            className={styles.ghost}
          >
            <Icon name="download" size={15} />
            {t('common.export')}
          </DownloadButton>
        </div>

        {filtered.length === 0 ? (
          <Empty>{t('users.noMatch')}</Empty>
        ) : (
          <>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tick}>
                      <input
                        type="checkbox"
                        checked={
                          pageRows.length > 0 &&
                          pageRows.every((p) => selected.has(p.id))
                        }
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current)
                            const all = pageRows.every((p) => next.has(p.id))
                            for (const person of pageRows) {
                              if (all) next.delete(person.id)
                              else next.add(person.id)
                            }
                            return next
                          })
                        }
                        aria-label={t("common.selectAll")}
                      />
                    </th>
                    <th scope="col">{t('users.name')}</th>
                    <th scope="col">{t('users.email')}</th>
                    <th scope="col">{t('users.phone')}</th>
                    <th scope="col">{t('users.role')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('users.supervisor')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col">{t('users.joined')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((person) => (
                    <tr
                      key={person.id}
                      data-busy={pending === person.id}
                      data-meta={`${person.phone ?? person.email} · ${person.branch?.name ?? t('dlg.noBranch')}`}
                    >
                      <td className={styles.tick}>
                        <input
                          type="checkbox"
                          checked={selected.has(person.id)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (next.has(person.id)) next.delete(person.id)
                              else next.add(person.id)
                              return next
                            })
                          }
                          aria-label={t('a11y.selectRow', { name: person.name })}
                        />
                      </td>

                      <td data-label={t('users.name')}>
                        <span className={styles.person}>
                          <span
                            className={styles.avatar}
                            style={{
                              // A stable hue per person, so the disc is a
                              // recognisable marker rather than decoration.
                              background: `hsl(${avatarHue(person.id)} 62% 92%)`,
                              color: `hsl(${avatarHue(person.id)} 55% 28%)`,
                            }}
                            aria-hidden="true"
                          >
                            {initials(person.name)}
                          </span>
                          <span className={styles.personName}>
                            {person.name}
                            {person.id === me?.id ? (
                              <i className={styles.you}>{t('users.you')}</i>
                            ) : null}
                          </span>
                        </span>
                      </td>

                      <td data-label={t('users.email')} className={styles.email}>
                        {person.email}
                      </td>

                      <td data-label={t('users.phone')} className="tabular">
                        {person.phone ?? (
                          <span className={styles.none}>{t('users.notOnFile')}</span>
                        )}
                      </td>

                      <td data-label={t('users.role')}>
                        <span className={styles.rolePill} data-role={person.role}>
                          {t(`role.${person.role}` as const)}
                        </span>
                      </td>

                      <td data-label={t('common.branch')}>
                        {person.branch?.name ?? (
                          <span className={styles.none}>{t('users.orgWide')}</span>
                        )}
                      </td>

                      <td data-label={t('users.supervisor')}>
                        {person.supervisor?.name ?? (
                          <span className={styles.none}>–</span>
                        )}
                      </td>

                      <td data-label={t('common.status')}>
                        <span
                          className={styles.status}
                          data-state={person.isActive ? 'ACTIVE' : 'INACTIVE'}
                        >
                          {person.isActive ? t('users.active') : t('users.inactive')}
                        </span>
                      </td>

                      <td data-label={t('users.joined')}>{shortDate(person.createdAt)}</td>

                      <td className={styles.actionsCol}>
                        <div className={styles.menuWrap}>
                          <button
                            className={styles.iconButton}
                            type="button"
                            aria-label={t('a11y.actionsFor', { name: person.name })}
                            aria-haspopup="menu"
                            aria-expanded={openMenu === person.id}
                            disabled={!isOwner || pending === person.id}
                            onClick={() =>
                              setOpenMenu(
                                openMenu === person.id ? null : person.id,
                              )
                            }
                          >
                            <Icon name="more" size={16} />
                          </button>

                          {openMenu === person.id ? (
                            <div className={styles.menu} role="menu" ref={menuRef}>
                              {confirmDelete === person.id ? (
                                // Second step. Deleting a person is the one
                                // action here that cannot be undone, so it asks
                                // first rather than firing off the menu.
                                <div className={styles.confirm}>
                                  <p>
                                    {t('users.askDelete', {
                                      name: person.name,
                                    })}
                                  </p>

                                  <div className={styles.confirmRow}>
                                    <button
                                      type="button"
                                      className={styles.confirmDanger}
                                      disabled={pending === person.id}
                                      onClick={() => void remove(person)}
                                    >
                                      {t('common.delete')}
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.confirmBack}
                                      disabled={pending === person.id}
                                      onClick={() => setConfirmDelete(null)}
                                    >
                                      {t('common.discard')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setEditing(person)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('users.editDetails')}
                                  </button>

                                  {/* Nobody may delete themselves, and the
                                      Owner account is refused by the API. */}
                                  {person.id !== me?.id &&
                                  person.role !== 'OWNER' ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className={styles.menuDanger}
                                      onClick={() => setConfirmDelete(person.id)}
                                    >
                                      {t('users.deleteUser')}
                                    </button>
                                  ) : null}

                                  {/* The Owner is org-wide and has no branch,
                                      so there is nothing to move them to. */}
                                  {person.role !== 'OWNER' ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setMoving(person)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {person.role === 'SUPERVISOR'
                                        ? t('users.moveBranch')
                                        : t('users.changeBranch')}
                                    </button>
                                  ) : null}

                                  {person.id !== me?.id ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() =>
                                        void setActive(person, !person.isActive)
                                      }
                                    >
                                      {person.isActive
                                        ? t('users.deactivate')
                                        : t('users.reactivate')}
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.foot}>
              <span className={styles.showing}>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
                {count(filtered.length)} users
                {summary.inactive > 0 ? ` · ${summary.inactive} inactive` : ''}
              </span>

              {totalPages > 1 ? (
                <nav className={styles.pager} aria-label={t("common.pagination")}>
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setPage(safePage - 1)}
                    aria-label={t("common.prevPage")}
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={n === safePage ? styles.pageOn : ''}
                      aria-current={n === safePage ? 'page' : undefined}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(safePage + 1)}
                    aria-label={t("common.nextPage")}
                  >
                    ›
                  </button>
                </nav>
              ) : null}
            </div>
          </>
        )}
      </Card>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {creating ? (
        <UserDialog
          onClose={() => setCreating(false)}
          onDone={(message) => {
            setCreating(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {editing ? (
        <UserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {moving ? (
        <MoveBranchDialog
          user={moving}
          onClose={() => setMoving(null)}
          onDone={(message) => {
            setMoving(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}
