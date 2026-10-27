import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { requestRef } from '../../lib/requests'
import type { BranchRow, NidOverview, NidRequest, OfficeAsset, StockRequest } from '../../lib/types'
import { cartaSuffix } from '../../lib/stock'
import styles from '../inventory/Panel.module.css'
import own from './DispatchDialog.module.css'

type Driver = { name: string; phone: string; plate: string }

const phoneOk = (value: string) => /^[+()\d][\d\s()+-]*$/.test(value.trim()) && value.trim().length >= 7

/**
 * One car for a branch, from one page. The Owner opens a supervisor's restock,
 * lowers any amount, and approves; can add the branch's other waiting
 * requests and its printed National IDs to the same car; then names the
 * driver and sends it all together.
 */
export function DispatchDialog({
  request,
  waiting,
  onClose,
  onDone,
}: {
  /** The request the Owner opened. */
  request: StockRequest
  /** Every restock waiting on the Owner, to offer the same branch's others. */
  waiting: StockRequest[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const branchId = request.requestedBy.branch?.id ?? ''
  const branchName = request.requestedBy.branch?.name ?? request.requestedBy.name

  const [included, setIncluded] = useState<StockRequest[]>([request])
  // What is typed for each item, by item id; starts at what was approved, or
  // what was asked when not yet approved.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => amountsOf([request]))
  const [approved, setApproved] = useState(() => isApproved([request]))
  const [nid, setNid] = useState<NidRequest[]>([])
  const [nidChosen, setNidChosen] = useState<Set<string>>(() => new Set())
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [driver, setDriver] = useState<Driver>({ name: '', phone: '', plate: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Send asks first: a summary of the car, then Yes, send or Discard.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Where it ships from, and the branch's printed National IDs ready to go back.
  useEffect(() => {
    const controller = new AbortController()
    api<{ branches: BranchRow[] }>('/api/branches', { signal: controller.signal })
      .then((payload) => setBranches(payload.branches ?? []))
      .catch(() => undefined)
    Promise.all(
      (['ORIGINAL', 'COPY'] as const).map((kind) =>
        api<NidOverview>(`/api/nid?kind=${kind}`, { signal: controller.signal })
          .then((payload) => payload.requests ?? [])
          .catch(() => [] as NidRequest[]),
      ),
    ).then((lists) => {
      const ready = lists
        .flat()
        .filter(
          (row) =>
            row.location.id === branchId &&
            row.status === 'APPROVED' &&
            (row.orders ?? []).some((order) => order.status === 'APPROVED'),
        )
      setNid(ready)
      setNidChosen(new Set(ready.map((row) => row.id)))
    })
    return () => controller.abort()
  }, [branchId])

  const sources = branches.filter((row) => row.isActive && row.isMainStock && row.id !== branchId)
  // Always the main store: there is nothing to choose, so no field for it.
  const source = sources[0]?.id ?? ''
  const sourceName = sources.find((row) => row.id === source)?.name ?? ''

  // What the store holds for this branch: a request is filled only from the
  // branch's own share, so a short line shows before Send.
  const [stock, setStock] = useState<{ source: string; free: Map<string, number> } | null>(null)
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    api<{ stock: { quantity: number; product: { id: string } }[] }>(
      `/api/inventory/branch-stock?branchId=${encodeURIComponent(branchId)}`,
      { signal: controller.signal },
    )
      .then((payload) =>
        setStock({
          source,
          free: new Map((payload.stock ?? []).map((row) => [row.product.id, row.quantity])),
        }),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [source, branchId])
  const freeAt = (productId: string) => (stock && stock.source === source ? (stock.free.get(productId) ?? 0) : null)

  // Office equipment at the store it ships from, to send in the same car:
  // how many of each entry go, empty for none.
  const [equipment, setEquipment] = useState<{ source: string; rows: OfficeAsset[] } | null>(null)
  const [equipmentQty, setEquipmentQty] = useState<Record<string, string>>({})
  // Shown only when the Owner chooses to add equipment to this car.
  const [addingEquipment, setAddingEquipment] = useState(false)
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    api<{ assets: OfficeAsset[] }>(`/api/assets?locationId=${encodeURIComponent(source)}&status=IN_USE`, {
      signal: controller.signal,
    })
      .then((payload) => setEquipment({ source, rows: payload.assets ?? [] }))
      .catch(() => undefined)
    return () => controller.abort()
  }, [source])
  const equipmentRows = equipment && equipment.source === source ? equipment.rows : []
  const equipmentSending = equipmentRows
    .map((row) => ({ row, qty: Number(equipmentQty[row.id] || 0) }))
    .filter((entry) => entry.qty > 0)
  const equipmentValid = equipmentRows.every((row) => {
    const raw = equipmentQty[row.id] ?? ''
    const value = Number(raw)
    return raw.trim() === '' || (Number.isInteger(value) && value >= 0 && value <= row.quantity)
  })

  // The same branch's other waiting restocks, to put in this car too.
  const others = waiting.filter(
    (row) =>
      row.id !== request.id &&
      !included.some((entry) => entry.id === row.id) &&
      (row.requestedBy.branch?.id ?? '') === branchId &&
      row.requestedBy.role !== 'SALES' &&
      row.status === 'PENDING',
  )

  // Once it is known what is held for the branch, a request not yet approved
  // starts at what can actually be sent, line by line, instead of opening in
  // red. The Owner can still lower it; more than is held turns it red.
  const [cappedFor, setCappedFor] = useState<typeof stock>(null)
  if (stock && stock.source === source && cappedFor !== stock && !approved) {
    setCappedFor(stock)
    const left = new Map(stock.free)
    const next = { ...amounts }
    for (const entry of included) {
      for (const item of entry.items) {
        const want = Number(next[item.id] ?? item.quantity) || 0
        const free = left.get(item.product.id) ?? 0
        const give = Math.min(want, free)
        next[item.id] = String(give)
        left.set(item.product.id, free - give)
      }
    }
    setAmounts(next)
  }

  const lines = included.flatMap((entry) => entry.items.map((item) => ({ entry, item })))
  const valid = lines.every(({ item }) => {
    const raw = amounts[item.id] ?? ''
    const value = Number(raw)
    return raw.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= item.quantity
  })
  const units = lines.reduce((sum, { item }) => sum + (Number(amounts[item.id]) || 0), 0)
  // Lines asking for more than the store has, counting the same product
  // across every request in the car.
  const wanted = new Map<string, number>()
  for (const { item } of lines) {
    wanted.set(item.product.id, (wanted.get(item.product.id) ?? 0) + (Number(amounts[item.id]) || 0))
  }
  const short = (productId: string) => {
    const free = freeAt(productId)
    return free !== null && (wanted.get(productId) ?? 0) > free
  }
  const anyShort = [...wanted.keys()].some(short)
  const driverOk = driver.name.trim().length >= 2 && phoneOk(driver.phone) && driver.plate.trim().length >= 2
  const nidNames = nid
    .filter((row) => nidChosen.has(row.id))
    .reduce((sum, row) => sum + (row.orders ?? []).filter((order) => order.status === 'APPROVED').length, 0)

  function setAmount(itemId: string, value: string) {
    setAmounts((current) => ({ ...current, [itemId]: value }))
    setApproved(false)
  }

  function addRequest(id: string) {
    const next = waiting.find((row) => row.id === id)
    if (!next) return
    setIncluded((current) => [...current, next])
    setAmounts((current) => ({ ...amountsOf([next]), ...current }))
    setApproved(false)
  }

  function removeRequest(id: string) {
    setIncluded((current) => current.filter((entry) => entry.id !== id))
  }

  // Approve: saves how many of each item go, for every request in the car.
  async function approve() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      for (const entry of included) {
        await api(`/api/requests/${entry.id}/approve-quantities`, {
          method: 'PATCH',
          body: {
            items: entry.items.map((item) => ({ itemId: item.id, approvedQuantity: Number(amounts[item.id]) })),
          },
        })
      }
      setApproved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('appr.approveFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Send: one car with every approved request, then the printed IDs go back
  // with it.
  function askToSend(event: FormEvent) {
    event.preventDefault()
    if (!approved || !driverOk || source === '' || anyShort || !equipmentValid || busy) return
    setConfirming(true)
  }

  async function send() {
    if (!approved || !driverOk || source === '' || anyShort || !equipmentValid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/requests/ship', {
        method: 'POST',
        body: {
          requestIds: included.map((entry) => entry.id),
          sourceBranchId: source,
          driverName: driver.name.trim(),
          driverPhone: driver.phone.trim(),
          vehiclePlate: driver.plate.trim(),
        },
      })
      for (const row of nid.filter((entry) => nidChosen.has(entry.id))) {
        await api(`/api/nid/requests/${row.id}/return`, {
          method: 'PATCH',
          body: {
            printedIds: (row.orders ?? []).filter((order) => order.status === 'APPROVED').map((order) => order.id),
            note: t('dispatch.nidNote', { plate: driver.plate.trim() }),
          },
        })
      }
      for (const { row, qty } of equipmentSending) {
        await api(`/api/assets/${row.id}/send`, {
          method: 'POST',
          body: { toBranchId: branchId, quantity: qty, note: t('dispatch.equipmentNote', { branch: branchName, plate: driver.plate.trim() }) },
        })
      }
      onDone(
        t('dispatch.sent', { branch: branchName, n: count(units), ids: count(nidNames) }) +
          (equipmentSending.length > 0
            ? ` ${t('dispatch.sentEquipment', { n: count(equipmentSending.reduce((sum, entry) => sum + entry.qty, 0)) })}`
            : ''),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('appr.approveFailed'))
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
        aria-label={t('dispatch.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>
              {t('dispatch.title')} · {branchName}
            </h2>
            <p>{t('dispatch.note')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={askToSend}>
          {/* 1. What goes: every requested item, its amount editable. */}
          {included.map((entry) => (
            <section key={entry.id} className={own.card}>
              <header className={own.cardHead}>
                <strong>
                  {requestRef(entry)} <em>{shortDate(entry.createdAt)} · {entry.requestedBy.name}</em>
                </strong>
                {entry.id !== request.id ? (
                  <button type="button" className={own.removeLink} onClick={() => removeRequest(entry.id)} disabled={busy}>
                    {t('dispatch.remove')}
                  </button>
                ) : null}
              </header>
              <div className={own.rows}>
                <div className={own.rowHead}>
                  <span>{t('dlg.product')}</span>
                  <span>{t('dispatch.asked')}</span>
                  <span>{t('dispatch.sending')}</span>
                </div>
                {entry.items.map((item) => (
                  <div key={item.id} className={own.row} data-short={short(item.product.id) ? '' : undefined}>
                    <span className={own.name}>
                      {item.product.name}
                      {freeAt(item.product.id) !== null ? (
                        <em className={own.free}>
                          {short(item.product.id)
                            ? t('dispatch.onlyAt', {
                                n: `${count(freeAt(item.product.id) ?? 0)}${cartaSuffix(item.product.category)}`,
                                store: sourceName,
                              })
                            : t('dispatch.inStoreAt', {
                                n: `${count(freeAt(item.product.id) ?? 0)}${cartaSuffix(item.product.category)}`,
                                store: sourceName,
                              })}
                        </em>
                      ) : null}
                    </span>
                    <span className="tabular">
                      {count(item.quantity)}
                      {cartaSuffix(item.product.category)}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={item.quantity}
                      step="1"
                      value={amounts[item.id] ?? ''}
                      onChange={(event) => setAmount(item.id, event.target.value)}
                      aria-label={t('dispatch.sendingOf', { name: item.product.name })}
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}

          {others.length > 0 ? (
            <label className={styles.field}>
              <span>{t('dispatch.addRequest')}</span>
              <select value="" onChange={(event) => addRequest(event.target.value)} disabled={busy}>
                <option value="">{t('dispatch.addRequestPick', { n: count(others.length) })}</option>
                {others.map((row) => (
                  <option key={row.id} value={row.id}>
                    {`${requestRef(row)} · ${shortDate(row.createdAt)} · ${t('dispatch.nItems', { n: count(row.items.length) })}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* 2. Printed National IDs for this branch, going back in the same car. */}
          {nid.length > 0 ? (
            <section className={own.card}>
              <header className={own.cardHead}>
                <strong>{t('dispatch.nidTitle')}</strong>
              </header>
              <div className={own.rows}>
                {nid.map((row) => {
                  const printed = (row.orders ?? []).filter((order) => order.status === 'APPROVED').length
                  return (
                    <label key={row.id} className={own.tickRow}>
                      <input
                        type="checkbox"
                        checked={nidChosen.has(row.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setNidChosen((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(row.id)
                            else next.delete(row.id)
                            return next
                          })
                        }
                      />
                      <span className={own.name}>
                        {t(row.kind === 'COPY' ? 'nido.titleCopy' : 'nido.titleOriginal')} · {row.requestedBy.name}
                      </span>
                      <span className="tabular">{t('nido.nNames', { n: count(printed) })}</span>
                    </label>
                  )
                })}
              </div>
            </section>
          ) : null}

          <dl className={styles.facts}>
            <div>
              <dt>{t('dispatch.totalItems')}</dt>
              <dd className="tabular">
                <strong>{count(units)}</strong>
              </dd>
            </div>
            <div>
              <dt>{t('dispatch.ids')}</dt>
              <dd className="tabular">{count(nidNames)}</dd>
            </div>
          </dl>

          {/* 3. Approve, then the car. */}
          {approved ? (
            <p className={own.approved}>✓ {t('dispatch.approved')}</p>
          ) : (
            <button
              type="button"
              className={`${styles.submit} ${own.approveButton}`}
              disabled={!valid || busy || units === 0}
              onClick={() => void approve()}
            >
              {busy ? t('prod.saving') : t('dispatch.approve')}
            </button>
          )}

          <section className={own.card} data-off={approved ? undefined : ''}>
            <header className={own.cardHead}>
              <strong>{t('dlg.driver')}</strong>
            </header>
            <div className={own.driver}>
              <label className={styles.field}>
                <span>
                  {t('dlg.driverName')}<em>{t('common.required')}</em>
                </span>
                <input
                  value={driver.name}
                  onChange={(event) => setDriver({ ...driver, name: event.target.value })}
                  placeholder={t('dlg.phDriverName')}
                  maxLength={120}
                  disabled={!approved}
                />
              </label>
              <label className={styles.field}>
                <span>
                  {t('dlg.driverPhone')}<em>{t('common.required')}</em>
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={driver.phone}
                  onChange={(event) => setDriver({ ...driver, phone: event.target.value })}
                  placeholder="0911 111 111"
                  maxLength={24}
                  disabled={!approved}
                />
              </label>
              <label className={styles.field}>
                <span>
                  {t('dlg.vehiclePlate')}<em>{t('common.required')}</em>
                </span>
                <input
                  value={driver.plate}
                  onChange={(event) => setDriver({ ...driver, plate: event.target.value })}
                  placeholder={t('dlg.phPlate')}
                  maxLength={40}
                  disabled={!approved}
                />
              </label>
              {driver.phone.trim() !== '' && !phoneOk(driver.phone) ? (
                <p className={styles.lineWarn}>{t('dlg.phoneInvalid')}</p>
              ) : null}
            </div>
          </section>

          {/* Office equipment from the same store, in the same car. */}
          {approved && source && !addingEquipment ? (
            <button type="button" className={own.addEquipment} onClick={() => setAddingEquipment(true)} disabled={busy}>
              + {t('dispatch.addEquipment')}
            </button>
          ) : null}

          {approved && source && addingEquipment && equipmentRows.length === 0 ? (
            <p className={styles.hint}>{t('dispatch.noEquipment', { store: sourceName })}</p>
          ) : null}

          {approved && source && addingEquipment && equipmentRows.length > 0 ? (
            <section className={own.card}>
              <header className={own.cardHead}>
                <strong>
                  {t('dispatch.equipmentTitle')} <em>{sourceName}</em>
                </strong>
              </header>
              <div className={own.rows}>
                <div className={own.rowHead}>
                  <span>{t('asset.name')}</span>
                  <span>{t('dispatch.atStore')}</span>
                  <span>{t('dispatch.sending')}</span>
                </div>
                {equipmentRows.map((row) => {
                  const raw = equipmentQty[row.id] ?? ''
                  const bad = raw.trim() !== '' && (!Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > row.quantity)
                  return (
                    <div key={row.id} className={own.row} data-short={bad ? '' : undefined}>
                      <span className={own.name}>{row.name}</span>
                      <span className="tabular">{count(row.quantity)}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={row.quantity}
                        step="1"
                        placeholder="0"
                        value={raw}
                        onChange={(event) => setEquipmentQty((current) => ({ ...current, [row.id]: event.target.value }))}
                        aria-label={t('dispatch.sendingOf', { name: row.name })}
                        disabled={busy}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          {confirming ? (
            <section className={own.confirm} role="alertdialog" aria-label={t('dispatch.confirmTitle')}>
              <strong>{t('dispatch.confirmTitle')}</strong>
              <p>
                {t('dispatch.confirmLine', {
                  branch: branchName,
                  n: count(units),
                  ids: count(nidNames),
                  equipment: count(equipmentSending.reduce((sum, entry) => sum + entry.qty, 0)),
                })}
              </p>
              <p>
                {t('dispatch.confirmDriver', {
                  name: driver.name.trim(),
                  phone: driver.phone.trim(),
                  plate: driver.plate.trim(),
                  store: sourceName,
                })}
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.cancel} onClick={() => setConfirming(false)} disabled={busy}>
                  {t('dispatch.discard')}
                </button>
                <button type="button" className={styles.submit} onClick={() => void send()} disabled={busy}>
                  {busy ? t('prod.saving') : t('dispatch.confirmSend')}
                </button>
              </div>
            </section>
          ) : null}

          <div className={styles.actions} hidden={confirming}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.close')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!approved || !driverOk || source === '' || anyShort || !equipmentValid || busy}
            >
              {busy ? t('prod.saving') : t('dispatch.send')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

/** Each item's amount to start from: what was approved, else what was asked. */
function amountsOf(requests: StockRequest[]) {
  return Object.fromEntries(
    requests.flatMap((request) =>
      request.items.map((item) => [item.id, String(item.approvedQuantity ?? item.quantity)]),
    ),
  )
}

/** Approved already: every item has an amount saved. */
function isApproved(requests: StockRequest[]) {
  return requests.every((request) => request.items.every((item) => item.approvedQuantity !== null))
}

