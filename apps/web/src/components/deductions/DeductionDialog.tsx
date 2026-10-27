import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { businessDay } from '../../lib/tz'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { CatalogueProduct } from '../../lib/types'
import styles from '../inventory/Panel.module.css'
import own from './DeductionDialog.module.css'

type Employee = {
  id: string
  name: string
  role: string
  isActive: boolean
  branch: { id: string; name: string } | null
}

type Line = {
  key: number
  productId: string
  quantity: string
  /** Blank means "price × quantity"; typed, it replaces that. */
  amount: string
}

function today() {
  const now = new Date()
  return businessDay(now)
}

const NO_BRANCH = '__none__'

/**
 * Records one day's deduction: the date and the amount, with the reason in
 * the note. Items short or lost (product and how many) are optional, and a
 * line left without a product is simply ignored; each fills in at its selling
 * price times the quantity and can be changed. Supervisors and salespeople record their own; the Owner first
 * picks the branch and person.
 */
export function DeductionDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (total: number) => void
}) {
  const t = useT()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'

  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branchId, setBranchId] = useState('')
  const [userId, setUserId] = useState('')
  const [day, setDay] = useState(today())
  // Money with no item behind it; items below are optional.
  const [money, setMoney] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: '', quantity: '1', amount: '' }])
  const [note, setNote] = useState('')
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
    const controller = new AbortController()
    api<{ products: CatalogueProduct[] }>('/api/products', { signal: controller.signal })
      .then((payload) => setProducts((payload.products ?? []).filter((row) => row.status === 'ACTIVE')))
      .catch(() => undefined)
    if (isOwner) {
      api<{ employees: Employee[] }>('/api/payroll/employees', { signal: controller.signal })
        .then((payload) => setEmployees((payload.employees ?? []).filter((row) => row.isActive)))
        .catch(() => undefined)
    }
    return () => controller.abort()
  }, [isOwner])

  // The Owner picks the branch, then one of its people (supervisor first).
  const branchOptions = [
    ...new Map(employees.map((row) => [row.branch?.id ?? NO_BRANCH, row.branch?.name ?? t('dlg.noBranch')] as const)),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const validBranchId = branchOptions.some(([id]) => id === branchId) ? branchId : (branchOptions[0]?.[0] ?? '')
  const people = employees
    .filter((row) => (row.branch?.id ?? NO_BRANCH) === validBranchId)
    .sort((a, b) => Number(b.role === 'SUPERVISOR') - Number(a.role === 'SUPERVISOR') || a.name.localeCompare(b.name))
  const validUserId = people.some((row) => row.id === userId) ? userId : (people[0]?.id ?? '')

  // Every product by name, numbers in order (Voucher-10 before Voucher-100).
  const options = useMemo(
    () =>
      products
        .map((product) => ({ id: product.id, name: product.name, price: Number(product.price ?? 0) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [products],
  )

  // A line with no product chosen is left out rather than blocking the save.
  const priced = lines.filter((line) => line.productId !== '').map((line) => {
    const product = options.find((entry) => entry.id === line.productId)
    const qty = Number(line.quantity)
    const qtyValid = Number.isInteger(qty) && qty > 0
    const auto = product && qtyValid ? product.price * qty : 0
    const value = auto
    return {
      ...line,
      product,
      auto,
      value,
      valid: product != null && qtyValid && Number.isFinite(value) && value >= 0,
    }
  })

  const moneyValue = money.trim() === '' ? 0 : Number(money)
  const moneyValid = Number.isFinite(moneyValue) && moneyValue >= 0
  const total = (moneyValid ? moneyValue : 0) + priced.reduce((sum, line) => sum + (line.valid ? line.value : 0), 0)
  const valid =
    day !== '' &&
    moneyValid &&
    (moneyValue > 0 || priced.length > 0) &&
    priced.every((line) => line.valid) &&
    (!isOwner || validUserId !== '')

  function setLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api('/api/deductions', {
        method: 'POST',
        body: {
          day,
          ...(isOwner ? { userId: validUserId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(moneyValue > 0 ? { amount: moneyValue } : {}),
          lines: priced.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
          })),
        },
      })
      onDone(total)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
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
        aria-label={t('ded.addTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('ded.addTitle')}</h2>
            <p>{t('ded.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {isOwner ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('common.branch')}<em>{t('common.required')}</em>
                </span>
                <select value={validBranchId} onChange={(event) => setBranchId(event.target.value)}>
                  {branchOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>
                  {t('pay.employee')}<em>{t('common.required')}</em>
                </span>
                <select value={validUserId} onChange={(event) => setUserId(event.target.value)}>
                  {people.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {/* Deductions are recorded on the day; a salesperson does not pick it. */}
          {user?.role !== 'SALES' ? (
            <label className={styles.field}>
              <span>
                {t('req.date')}<em>{t('common.required')}</em>
              </span>
              <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
            </label>
          ) : null}

          {/* Product first: choosing one fills in its amount. */}
          {lines.map((line, index) => {
            const product = options.find((entry) => entry.id === line.productId)
            const qty = Number(line.quantity)
            const auto = product && Number.isInteger(qty) && qty > 0 ? product.price * qty : 0

            return (
              <div key={line.key} className={styles.saleLine}>
                <label className={styles.field}>
                  <span>
                    {t('dlg.product')}<em>{t('prod.optional')}</em>
                  </span>
                  <select
                    value={line.productId}
                    onChange={(event) => setLine(line.key, { productId: event.target.value })}
                  >
                    <option value="">{t('ded.noProduct')}</option>
                    {options.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>

                {product ? (
                  <label className={styles.qtyField}>
                    <span>{t('dlg.qty')}</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                    />
                  </label>
                ) : null}

                {product ? (
                  <p className={styles.tally} style={{ gridColumn: '1 / -1' }}>
                    {t('ded.productAmount')}: <strong className="tabular">{currency(auto)}</strong>
                  </p>
                ) : null}

                {lines.length > 1 ? (
                  <button
                    type="button"
                    className={styles.removeLine}
                    onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                    aria-label={t('a11y.removeItem', { n: index + 1 })}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            )
          })}

          {lines.every((line) => line.productId !== '') ? (
            <button
              type="button"
              className={styles.addLine}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { key: Math.max(0, ...current.map((line) => line.key)) + 1, productId: '', quantity: '1', amount: '' },
                ])
              }
            >
              {t('ded.anotherProduct')}
            </button>
          ) : null}

          {/* Any other money taken off, with no product behind it. */}
          <label className={styles.field}>
            <span>
              {t('ded.money')}<em>{t('ded.moneyNote')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={money}
              onChange={(event) => setMoney(event.target.value)}
            />
          </label>

          {moneyValue > 0 ? (
            <label className={styles.field}>
              <span>
                {t('ded.reason')}<em>{t('prod.optional')}</em>
              </span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t('ded.phReason')} />
            </label>
          ) : null}

          {/* Each deduction listed on its own row, then the total. */}
          <dl className={`${styles.facts} ${own.list}`}>
            {priced
              .filter((line) => line.valid)
              .map((line) => (
                <div key={line.key}>
                  <dt>
                    {line.product?.name} × {line.quantity}
                  </dt>
                  <dd className="tabular">{currency(line.value)}</dd>
                </div>
              ))}
            {moneyValid && moneyValue > 0 ? (
              <div>
                <dt>{t('ded.otherLine')}</dt>
                <dd className="tabular">{currency(moneyValue)}</dd>
              </div>
            ) : null}
            <div className={own.totalRow}>
              <dt>{t('ded.total')}</dt>
              <dd className="tabular">
                <strong>{currency(total)}</strong>
              </dd>
            </div>
          </dl>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t('ded.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
