import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/context'
import { AddAssetDialog } from '../components/assets/AddAssetDialog'
import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type {
  AssetCategory,
  AssetStatus,
  BranchRow,
  OfficeAsset,
} from '../lib/types'
import styles from './Equipment.module.css'

const CATEGORY_KEY: Record<AssetCategory, TranslationKey> = {
  ELECTRONICS: 'asset.electronics',
  FURNITURE: 'asset.furniture',
  STATIONERY: 'asset.stationery',
  OTHER: 'asset.other',
}

const STATUS_KEY: Record<AssetStatus, TranslationKey> = {
  IN_USE: 'asset.inUse',
  DAMAGED: 'asset.damaged',
  RETIRED: 'asset.retired',
}

/**
 * The office equipment register: what each branch works with, as opposed to
 * what it sells.
 *
 * The Owner buys and ships equipment, so the Owner records it. A supervisor
 * sees their own branch's and can say when something breaks or is scrapped —
 * they are the one who finds out.
 */
export default function Equipment() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const isOwner = user?.role === 'OWNER'

  const [assets, setAssets] = useState<OfficeAsset[] | null>(null)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [category, setCategory] = useState<AssetCategory | 'ALL'>('ALL')
  const [status, setStatus] = useState<AssetStatus | 'ALL'>('ALL')
  const [branch, setBranch] = useState('ALL')

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([
      api<{ assets: OfficeAsset[] }>('/api/assets', {
        signal: controller.signal,
      }),
      isOwner
        ? api<{ branches: BranchRow[] }>('/api/branches', {
            signal: controller.signal,
          }).catch(() => ({ branches: [] as BranchRow[] }))
        : Promise.resolve({ branches: [] as BranchRow[] }),
    ])
      .then(([assetRes, branchRes]) => {
        setAssets(assetRes.assets ?? [])
        setBranches((branchRes.branches ?? []).filter((row) => row.isActive))
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setAssets([])
      })

    return () => controller.abort()
  }, [isOwner, reloadKey])

  const rows = useMemo(
    () =>
      (assets ?? []).filter(
        (asset) =>
          (category === 'ALL' || asset.category === category) &&
          (status === 'ALL' || asset.status === status) &&
          (branch === 'ALL' || asset.location.id === branch),
      ),
    [assets, category, status, branch],
  )

  // Retired equipment is history: counting it would overstate what the
  // business actually has.
  const held = rows.filter((asset) => asset.status !== 'RETIRED')

  const totals = {
    items: held.reduce((sum, asset) => sum + asset.quantity, 0),
    value: held.reduce(
      (sum, asset) => sum + Number(asset.cost ?? 0) * asset.quantity,
      0,
    ),
  }

  async function setAssetStatus(asset: OfficeAsset, next: AssetStatus) {
    setBusyId(asset.id)

    try {
      await api(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        body: { status: next },
      })

      push('success', t('asset.updated'))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(asset: OfficeAsset) {
    setBusyId(asset.id)

    try {
      await api(`/api/assets/${asset.id}`, { method: 'DELETE' })
      push('success', t('asset.removed'))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('asset.title')}</h1>
          <p className={styles.subtitle}>{t('asset.note')}</p>
        </div>

        {isOwner ? (
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAdding(true)}
            >
              + {t('asset.add')}
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.totals}>
        <div>
          <strong className="tabular">{count(totals.items)}</strong>
          <span>{t('asset.totalItems')}</span>
        </div>
        <div>
          <strong className="tabular">{currency(totals.value)}</strong>
          <span>{t('asset.totalValue')}</span>
        </div>
      </div>

      <Card>
        <div className={styles.filters}>
          <select
            className={styles.select}
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as AssetCategory | 'ALL')
            }
            aria-label={t('asset.category')}
          >
            <option value="ALL">{t('asset.allCategories')}</option>
            {(Object.keys(CATEGORY_KEY) as AssetCategory[]).map((key) => (
              <option key={key} value={key}>
                {t(CATEGORY_KEY[key])}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AssetStatus | 'ALL')
            }
            aria-label={t('asset.status')}
          >
            <option value="ALL">{t('asset.allStatus')}</option>
            {(Object.keys(STATUS_KEY) as AssetStatus[]).map((key) => (
              <option key={key} value={key}>
                {t(STATUS_KEY[key])}
              </option>
            ))}
          </select>

          {/* Only the Owner has more than one branch to choose between. */}
          {isOwner && branches.length > 1 ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              aria-label={t('asset.branch')}
            >
              <option value="ALL">{t('inv.allBranches')}</option>
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {error ? <Empty>{error}</Empty> : null}

        {assets === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('asset.none')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('asset.name')}</th>
                  <th scope="col">{t('asset.category')}</th>
                  <th scope="col">{t('asset.branch')}</th>
                  <th scope="col">{t('asset.quantity')}</th>
                  <th scope="col">{t('asset.serial')}</th>
                  <th scope="col">{t('asset.cost')}</th>
                  <th scope="col">{t('asset.received')}</th>
                  <th scope="col">{t('asset.status')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((asset) => (
                  <tr key={asset.id} data-retired={asset.status === 'RETIRED' || undefined}>
                    <td data-label={t('asset.name')} className={styles.strong}>
                      {asset.name}
                      {asset.note ? <em className={styles.sub}>{asset.note}</em> : null}
                    </td>
                    <td data-label={t('asset.category')}>
                      {t(CATEGORY_KEY[asset.category])}
                    </td>
                    <td data-label={t('asset.branch')}>{asset.location.name}</td>
                    <td data-label={t('asset.quantity')} className="tabular">
                      {count(asset.quantity)}
                    </td>
                    <td data-label={t('asset.serial')} className="tabular">
                      {asset.serialNumber ?? '—'}
                    </td>
                    <td data-label={t('asset.cost')} className="tabular">
                      {asset.cost === null ? '—' : currency(Number(asset.cost))}
                    </td>
                    <td data-label={t('asset.received')}>
                      {shortDate(asset.receivedAt)}
                    </td>
                    <td data-label={t('asset.status')}>
                      <span className={styles.status} data-state={asset.status}>
                        {t(STATUS_KEY[asset.status])}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {asset.status === 'IN_USE' ? (
                          <button
                            type="button"
                            className={styles.link}
                            disabled={busyId === asset.id}
                            onClick={() => void setAssetStatus(asset, 'DAMAGED')}
                          >
                            {t('asset.markDamaged')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.link}
                            disabled={busyId === asset.id}
                            onClick={() => void setAssetStatus(asset, 'IN_USE')}
                          >
                            {t('asset.markInUse')}
                          </button>
                        )}

                        {isOwner && asset.status !== 'RETIRED' ? (
                          <button
                            type="button"
                            className={styles.link}
                            disabled={busyId === asset.id}
                            onClick={() => void setAssetStatus(asset, 'RETIRED')}
                          >
                            {t('asset.markRetired')}
                          </button>
                        ) : null}

                        {isOwner ? (
                          <button
                            type="button"
                            className={`${styles.link} ${styles.danger}`}
                            disabled={busyId === asset.id}
                            onClick={() => void remove(asset)}
                          >
                            {t('asset.remove')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding ? (
        <AddAssetDialog
          branches={branches}
          onClose={() => setAdding(false)}
          onDone={(asset) => {
            setAdding(false)
            push(
              'success',
              t('asset.saved', {
                name: asset.name,
                branch: asset.location.name,
              }),
            )
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
