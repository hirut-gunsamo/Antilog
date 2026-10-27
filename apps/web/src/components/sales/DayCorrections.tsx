import { useEffect, useState } from 'react'
import rowStyles from '../RowMenu.module.css'
import { businessDay } from '../../lib/tz'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { canEditSale, saleRef } from '../../lib/sales'
import { useT } from '../../lib/i18n'
import type { SalesDay } from '../../lib/salesDays'
import type { InventorySummary, NidOrder, NidOverview, Sale, TelebirrSummary } from '../../lib/types'
import { RegisterDialog } from '../../pages/NationalIdOrders'
import { RecordTelebirrDialog } from '../telebirr/TelebirrDialogs'
import { NewSaleDialog } from './NewSaleDialog'
import styles from '../inventory/Panel.module.css'
import own from './SaleDetails.module.css'

type Entry = TelebirrSummary['entries'][number]

/** The day's SIM transfers are corrected as one more total. */
const SIM_TRANSFER = 'SIM_TRANSFER'

/**
 * A salesperson's own day, open for correcting (today, or a day the Owner
 * opened): each Telebirr entry and National ID customer, with Edit.
 */
export function DayCorrections({ day, onChanged }: { day: SalesDay; onChanged: () => void }) {
  const t = useT()
  const { user } = useAuth()
  const [telebirr, setTelebirr] = useState<Entry[]>([])
  const [balance, setBalance] = useState(0)
  const [orders, setOrders] = useState<NidOrder[]>([])
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null)
  const [editingOrder, setEditingOrder] = useState<NidOrder | null>(null)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  // Day totals being typed, by item; untouched ones keep the day's figure.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [totalsError, setTotalsError] = useState<string | null>(null)

  const totalsChanged = (rows: { id: string; quantity: number }[]) =>
    rows.some((row) => drafts[row.id] != null && drafts[row.id].trim() !== '' && Number(drafts[row.id]) !== row.quantity)

  async function saveTotals(rows: { id: string; quantity: number }[]) {
    const changedRows = rows
      .filter((row) => drafts[row.id] != null && drafts[row.id].trim() !== '' && Number(drafts[row.id]) !== row.quantity)
      .map((row) => ({ productId: row.id, quantity: Number(drafts[row.id]) }))
    if (changedRows.some((row) => !Number.isInteger(row.quantity) || row.quantity < 0)) {
      setTotalsError(t('dc.badTotal'))
      return
    }
    setSaving(true)
    setTotalsError(null)
    try {
      await api('/api/sales/day-totals', { method: 'PUT', body: { day: day.date, totals: changedRows } })
      setDrafts({})
      changed()
    } catch (caught) {
      setTotalsError(caught instanceof Error ? caught.message : t('dc.badTotal'))
    } finally {
      setSaving(false)
    }
  }
  const [reloadKey, setReloadKey] = useState(0)
  // What the salesperson holds now, shown beside each item like the sale form.
  const [held, setHeld] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    const mine = (id: string) => id === user?.id
    api<TelebirrSummary>(`/api/telebirr?from=${day.date}&to=${day.date}`, { signal: controller.signal })
      .then((payload) => {
        setBalance(Number(payload.balance ?? 0))
        setTelebirr(payload.entries.filter((row) => row.kind !== 'LOAD' && mine(row.by.id)))
      })
      .catch(() => undefined)
    const onDay = (at: string) => {
      const d = new Date(at)
      return businessDay(d) === day.date
    }
    Promise.all(
      (['ORIGINAL', 'COPY'] as const).map((kind) =>
        api<NidOverview>(`/api/nid?kind=${kind}`, { signal: controller.signal }).then((payload) => payload.orders),
      ),
    )
      .then((lists) =>
        setOrders(lists.flat().filter((row) => mine(row.recordedBy.id) && onDay(row.createdAt))),
      )
      .catch(() => undefined)
    api<{ summary: InventorySummary }>('/api/inventory/summary?mine=1', { signal: controller.signal })
      .then((payload) => {
        const map = new Map<string, number>()
        for (const row of payload.summary.items ?? []) map.set(row.productId, (map.get(row.productId) ?? 0) + row.quantity)
        setHeld(map)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [day.date, user?.id, reloadKey])

  const sales = day.sales
  // SIM cards and airtime sell at one price per item, so they are corrected
  // as one total per item for the day; phones are each a specific unit and
  // are corrected sale by sale.
  const totals = new Map<string, { id: string; name: string; quantity: number; price: number; group: string }>()
  const phones: { key: string; sale: Sale; name: string; quantity: number }[] = []
  let transfers = 0
  for (const sale of sales) {
    transfers += (sale.simTransfers ?? []).reduce((sum, row) => sum + (row.quantity ?? 1), 0)
    for (const item of sale.items) {
      if (item.product.category === 'PHONE') {
        phones.push({ key: `${sale.id}-${item.product.id}`, sale, name: item.product.name, quantity: item.quantity })
        continue
      }
      const row = totals.get(item.product.id) ?? {
        id: item.product.id,
        name: item.product.name,
        quantity: 0,
        price: Number(item.unitPrice),
        group: item.product.category === 'SIM_CARD' ? t('ds.sims') : item.product.category === 'AIRTIME_VOUCHER' ? t('ds.airtime') : t('ds.other'),
      }
      row.quantity += item.quantity
      totals.set(item.product.id, row)
    }
  }
  const totalRows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const transferPrice = Number(sales.find((sale) => (sale.simTransfers ?? []).length > 0)?.simTransfers?.[0]?.price ?? 0)
  if (transfers > 0) {
    totalRows.push({ id: SIM_TRANSFER, name: t('st.title'), quantity: transfers, price: transferPrice, group: t('st.title') })
  }
  // Grouped like the sale form: SIM cards, airtime, then the rest.
  const totalGroups = [...new Set(totalRows.map((row) => row.group))].map((group) => ({
    group,
    rows: totalRows.filter((row) => row.group === group),
  }))
  const qtyOf = (row: { id: string; quantity: number }) =>
    drafts[row.id] != null && drafts[row.id].trim() !== '' ? Number(drafts[row.id]) || 0 : row.quantity
  // The day's total once the boxes are applied.
  const dayTotal =
    sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0) +
    totalRows.reduce((sum, row) => sum + (qtyOf(row) - row.quantity) * row.price, 0)
  const salesOpen = sales.some((sale) => canEditSale(sale))

  if (telebirr.length === 0 && orders.length === 0 && sales.length === 0) return null
  // Anything still open to change: today, or a day the Owner opened.
  const open =
    sales.some((sale) => canEditSale(sale)) ||
    telebirr.some((row) => row.editable) ||
    orders.some((row) => row.editable)

  const changed = () => {
    setReloadKey((n) => n + 1)
    onChanged()
  }

  return (
    <section className={own.payment}>
      <h3>{t('dc.title')}</h3>
      {!open ? <p className={own.salePaid}>{t('dc.locked')}</p> : null}

      {/* One box per item for the whole day: change the total sold. */}
      {totalRows.length > 0 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void saveTotals(totalRows)
          }}
        >
          <p className={own.salePaid}>{t('dc.totalsNote')}</p>
          {totalGroups.map(({ group, rows }) => (
            <details key={group} className={styles.gridGroup} open>
              <summary className={styles.gridHead}>{group}</summary>
              {rows.map((row) => (
                <div key={row.id} style={{ background: 'var(--surface)' }}>
                  <label className={styles.gridRow}>
                    <span className={styles.gridName}>
                      {row.name}
                      <em className={styles.sub}>
                        {row.id === SIM_TRANSFER
                          ? t('dc.perTransfer', { price: currency(row.price) })
                          : t('dc.holdPrice', { n: count(held.get(row.id) ?? 0), price: currency(row.price) })}
                      </em>
                    </span>
                    <input
                      id={`dc-total-${row.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      disabled={!salesOpen || saving}
                      value={drafts[row.id] ?? String(row.quantity)}
                      onChange={(event) => setDrafts((all) => ({ ...all, [row.id]: event.target.value }))}
                      aria-label={row.name}
                    />
                  </label>
                </div>
              ))}
            </details>
          ))}
          <div className={styles.saleTotal}>
            <span>{t('dlg.total')}</span>
            <strong className="tabular">{currency(dayTotal)}</strong>
          </div>
          {salesOpen ? (
            <button
              type="submit"
              className={styles.submit}
              style={{ width: '100%', marginTop: 12 }}
              disabled={saving || !totalsChanged(totalRows)}
            >
              {saving ? t('prod.saving') : t('dc.saveTotals')}
            </button>
          ) : null}
          {totalsError ? <p className={styles.error}>{totalsError}</p> : null}
        </form>
      ) : null}

      <dl>
        {/* Phones: each sold unit on its own line, corrected in its sale. */}
        {phones.map((row) => (
          <div key={row.key}>
            <dt>
              {row.name} × {row.quantity}
              <em>{saleRef(row.sale)}</em>
            </dt>
            <dd className="tabular">
              {currency(Number(row.sale.totalAmount))}{' '}
              {canEditSale(row.sale) ? (
                <button type="button" className={rowStyles.action} onClick={() => setEditingSale(row.sale)}>
                  {t('prod.edit')}
                </button>
              ) : null}
            </dd>
          </div>
        ))}
        {telebirr.map((row) => (
          <div key={row.id}>
            <dt>
              {t('tb.title')} · {t(row.kind === 'AIRTIME' ? 'tb.airtime' : 'tb.cashIn')}
              {row.customerPhone ? <em>{row.customerPhone}</em> : null}
            </dt>
            <dd className="tabular">
              {currency(Number(row.amount))}{' '}
              {row.editable ? (
                <button type="button" className={rowStyles.action} onClick={() => setEditingEntry(row)}>
                  {t('prod.edit')}
                </button>
              ) : null}
            </dd>
          </div>
        ))}
        {orders.map((row) => (
          <div key={row.id}>
            <dt>
              {t(row.kind === 'ORIGINAL' ? 'nido.titleOriginal' : 'nido.titleCopy')}
              <em>{row.fullName}</em>
            </dt>
            <dd className="tabular">
              {currency(Number(row.price))}{' '}
              {row.editable ? (
                <button type="button" className={rowStyles.action} onClick={() => setEditingOrder(row)}>
                  {t('prod.edit')}
                </button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {editingEntry ? (
        <RecordTelebirrDialog
          balance={balance}
          balances={[]}
          editing={editingEntry}
          onClose={() => setEditingEntry(null)}
          onDone={() => {
            setEditingEntry(null)
            changed()
          }}
        />
      ) : null}
      {editingSale ? (
        <NewSaleDialog
          editing={editingSale}
          onClose={() => setEditingSale(null)}
          onDone={() => {
            setEditingSale(null)
            changed()
          }}
        />
      ) : null}
      {editingOrder ? (
        <RegisterDialog
          kind={editingOrder.kind}
          price={Number(editingOrder.price)}
          editing={editingOrder}
          onClose={() => setEditingOrder(null)}
          onDone={() => {
            setEditingOrder(null)
            changed()
          }}
        />
      ) : null}
    </section>
  )
}
