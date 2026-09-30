import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { BranchDialog } from '../components/branches/BranchDialog'
import { icons } from '../components/icons'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count } from '../lib/format'
import { useT, type Translate, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { BranchRow } from '../lib/types'
import styles from './Branches.module.css'

// The three actions that ask before they act. Adding a stock source and
// reopening are left out: both are harmless and instantly reversible.
type ConfirmAction = 'unsource' | 'close' | 'delete'

const CONFIRM_ASK: Record<
  ConfirmAction,
  (t: Translate, branch: BranchRow) => string
> = {
  unsource: (t, branch) => t('branches.askUnsource', { name: branch.name }),
  close: (t, branch) => t('branches.askClose', { name: branch.name }),
  delete: (t, branch) => t('branches.askDelete', { name: branch.name }),
}

const CONFIRM_VERB: Record<ConfirmAction, TranslationKey> = {
  unsource: 'branches.verbUnsource',
  close: 'branches.close',
  delete: 'common.delete',
}

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

export default function Branches() {
  const { user } = useAuth()
  const t = useT()

  const [branches, setBranches] = useState<BranchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<BranchRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    id: string
    action: ConfirmAction
  } | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()

  // Bumped after any write, which re-runs the fetch below.
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchBranches() {
      try {
        const payload = await api<{ branches: BranchRow[] }>('/api/branches', {
          signal: controller.signal,
        })

        setBranches(payload.branches ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('branches.loadFailed'),
        )
      }
    }

    void fetchBranches()

    return () => controller.abort()
  }, [reloadKey, t])

  useEffect(() => {
    if (!openMenu) return

    function close() {
      setOpenMenu(null)
      setConfirm(null)
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

  const rows = useMemo(() => branches ?? [], [branches])

  // At least one active main-stock branch must always exist, so the UI has to
  // know when it is looking at the last one.
  const activeMainStock = useMemo(
    () => rows.filter((row) => row.isMainStock && row.isActive),
    [rows],
  )

  const isOwner = user?.role === 'OWNER'

  async function toggleMainStock(branch: BranchRow) {
    setPending(branch.id)
    setOpenMenu(null)

    try {
      await api(`/api/branches/${branch.id}/main-stock`, {
        method: 'PATCH',
        body: { isMainStock: !branch.isMainStock },
      })

      push(
        'success',
        branch.isMainStock
          ? `${branch.name} is no longer a stock source.`
          : `${branch.name} is now a stock source.`,
      )

      load()
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('branches.actionFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  // Carries out whichever action the second step confirmed.
  async function runConfirmed(branch: BranchRow) {
    if (!confirm) return

    const action = confirm.action

    setPending(branch.id)

    try {
      if (action === 'delete') {
        await api(`/api/branches/${branch.id}`, { method: 'DELETE' })
        push('success', t('toast.deleted', { name: branch.name }))
      } else if (action === 'close') {
        await api(`/api/branches/${branch.id}/status`, {
          method: 'PATCH',
          body: { isActive: false },
        })
        push('success', t('toast.branchClosed', { name: branch.name }))
      } else {
        await api(`/api/branches/${branch.id}/main-stock`, {
          method: 'PATCH',
          body: { isMainStock: false },
        })
        push('success', t('toast.branchNotSource', { name: branch.name }))
      }

      setConfirm(null)
      setOpenMenu(null)
      load()
    } catch (caught) {
      // The menu stays open on failure so the message is read in context.
      push(
        'error',
        caught instanceof Error ? caught.message : t('branches.actionFailed'),
      )
      setConfirm(null)
    } finally {
      setPending(null)
    }
  }

  async function reopen(branch: BranchRow) {
    setPending(branch.id)
    setOpenMenu(null)

    try {
      await api(`/api/branches/${branch.id}/status`, {
        method: 'PATCH',
        body: { isActive: true },
      })

      push('success', t('toast.branchReopened', { name: branch.name }))
      load()
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('branches.actionFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("branches.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!branches) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonCard} />
      </div>
    )
  }

  const active = rows.filter((row) => row.isActive).length

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('branches.title')}</h1>
          <p className={styles.subtitle}>
{t('branches.note')}
          </p>
        </div>

        <div className={styles.headActions}>
          <span className={styles.summary}>
            {t('branches.summary', { active: count(active), closed: count(rows.length - active) })}
          </span>

          {isOwner ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} />
              {t('branches.add')}
            </button>
          ) : null}
        </div>
      </header>

      <Card>
        {rows.length === 0 ? (
          <Empty>{t('branches.empty')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('branches.supervisor')}</th>
                  <th scope="col">{t('branches.staff')}</th>
                  <th scope="col">{t('branches.unitsSold')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col" className={styles.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((branch) => {
                  // Removing the last active stock source would leave nowhere
                  // for branches to request stock from.
                  const lastMainStock =
                    branch.isMainStock &&
                    branch.isActive &&
                    activeMainStock.length === 1

                  const used =
                    branch.counts.users +
                    branch.counts.products +
                    branch.counts.unitsSold

                  return (
                    <tr key={branch.id} data-busy={pending === branch.id}>
                      <td data-label={t('common.branch')}>
                        <span className={styles.name}>
                          {branch.name}
                          {branch.isMainStock ? (
                            <i className={styles.badge}>{t('branches.mainStock')}</i>
                          ) : null}
                        </span>
                      </td>

                      <td data-label={t('branches.supervisor')}>
                        {branch.supervisor ? (
                          <span className={styles.person}>
                            <strong>{branch.supervisor.name}</strong>
                            <span>{branch.supervisor.email}</span>
                          </span>
                        ) : (
                          <span className={styles.none}>{t('branches.notAssigned')}</span>
                        )}
                      </td>

                      <td data-label={t('branches.staff')} className="tabular">
                        {count(branch.counts.users)}
                      </td>

                      <td data-label={t('branches.unitsSold')} className="tabular">
                        {count(branch.counts.unitsSold)}
                      </td>

                      <td data-label={t('common.status')}>
                        <span
                          className={styles.status}
                          data-state={branch.isActive ? 'open' : 'closed'}
                        >
                          {branch.isActive ? t('branches.active') : t('branches.closed')}
                        </span>
                      </td>

                      <td className={styles.actionsCol}>
                        {!isOwner ? (
                          <span className={styles.readOnly}>
                            {t('branches.viewOnly')}
                          </span>
                        ) : (
                        <div className={styles.menuWrap}>
                          <button
                            className={styles.iconButton}
                            type="button"
                            aria-label={t('a11y.actionsFor', { name: branch.name })}
                            aria-haspopup="menu"
                            aria-expanded={openMenu === branch.id}
                            disabled={pending === branch.id}
                            onClick={() =>
                              setOpenMenu(
                                openMenu === branch.id ? null : branch.id,
                              )
                            }
                          >
                            <Icon name="more" size={16} />
                          </button>

                          {openMenu === branch.id ? (
                            <div
                              className={styles.menu}
                              role="menu"
                              ref={menuRef}
                            >
                              {confirm?.id === branch.id ? (
                                // Second step: the same action, now with a way
                                // back. Discard returns to the plain menu.
                                <div className={styles.confirm}>
                                  <p>{CONFIRM_ASK[confirm.action](t, branch)}</p>

                                  <div className={styles.confirmRow}>
                                    <button
                                      type="button"
                                      className={
                                        confirm.action === 'delete'
                                          ? styles.confirmDanger
                                          : styles.confirmGo
                                      }
                                      disabled={pending === branch.id}
                                      onClick={() => void runConfirmed(branch)}
                                    >
                                      {t(CONFIRM_VERB[confirm.action])}
                                    </button>

                                    <button
                                      type="button"
                                      className={styles.confirmBack}
                                      disabled={pending === branch.id}
                                      onClick={() => setConfirm(null)}
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
                                      setEditing(branch)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('branches.rename')}
                                  </button>

                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={lastMainStock || !branch.isActive}
                                    title={
                                      lastMainStock
                                        ? t('branches.onlySource')
                                        : !branch.isActive
                                          ? t('branches.reopenFirst')
                                          : undefined
                                    }
                                    onClick={() => {
                                      // Adding a stock source is harmless, so
                                      // only the removal asks.
                                      if (branch.isMainStock) {
                                        setConfirm({
                                          id: branch.id,
                                          action: 'unsource',
                                        })
                                      } else {
                                        void toggleMainStock(branch)
                                      }
                                    }}
                                  >
                                    {branch.isMainStock
                                      ? t('branches.removeSource')
                                      : t('branches.makeSource')}
                                  </button>

                                  {branch.isActive ? (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={lastMainStock}
                                      title={
                                        lastMainStock
                                          ? t('branches.onlySource')
                                          : undefined
                                      }
                                      onClick={() =>
                                        setConfirm({
                                          id: branch.id,
                                          action: 'close',
                                        })
                                      }
                                    >
                                      {t('branches.close')}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => void reopen(branch)}
                                    >
                                      {t('branches.reopen')}
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    role="menuitem"
                                    className={styles.menuDanger}
                                    disabled={used > 0}
                                    title={
                                      used > 0
                                        ? t('branches.neverUsedOnly')
                                        : undefined
                                    }
                                    onClick={() =>
                                      setConfirm({
                                        id: branch.id,
                                        action: 'delete',
                                      })
                                    }
                                  >
                                    {t('common.delete')}
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {creating ? (
        <BranchDialog
          onClose={() => setCreating(false)}
          onDone={(message) => {
            setCreating(false)
            push('success', message)
            void load()
          }}
        />
      ) : null}

      {editing ? (
        <BranchDialog
          branch={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null)
            push('success', message)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
