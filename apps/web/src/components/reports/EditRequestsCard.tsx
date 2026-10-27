import { useEffect, useState } from 'react'

import { api } from '../../lib/api'
import { currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { Card } from '../Card'
import base from '../../pages/Products.module.css'

type ReceiptRequest = {
  id: string
  amount: string
  receiptDate: string
  bankName: string | null
  uploadedBy: { id: string; name: string; role: string }
  location: { name: string } | null
}

type PaymentFix = {
  id: string
  saleDate: string
  totalAmount: string
  paymentMethod: 'CASH' | 'TRANSFER' | 'MIXED'
  cashReceived: string
  transferReceived: string
  bankName: string | null
  payFixMethod: 'CASH' | 'TRANSFER' | 'MIXED'
  payFixCash: string | null
  payFixTransfer: string | null
  payFixBank: string | null
  payFixNote: string | null
  salesperson: { id: string; name: string }
  location: { name: string }
}

type PaymentEditRequest = {
  day: string
  requestedAt: string
  user: { id: string; name: string; branch: { name: string } | null }
}

type EditRequest = {
  salespersonId: string
  name: string
  branch: string | null
  day: string
  sales: number
  askedAt: string
}

/**
 * Days salespeople asked the Owner to open for correcting. Allowing one lets
 * that person edit the whole day (sales, Telebirr, National ID) until tonight.
 */
export function EditRequestsCard({ onMessage }: { onMessage: (tone: 'success' | 'error', text: string) => void }) {
  const t = useT()
  const [rows, setRows] = useState<EditRequest[]>([])
  const [receipts, setReceipts] = useState<ReceiptRequest[]>([])
  const [fixes, setFixes] = useState<PaymentFix[]>([])
  const [payEdits, setPayEdits] = useState<PaymentEditRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<{ requests: EditRequest[] }>('/api/sales/edit-requests', { signal: controller.signal })
      .then((payload) => setRows(payload.requests ?? []))
      .catch(() => undefined)
    api<{ requests: ReceiptRequest[] }>('/api/receipts/edit-requests', { signal: controller.signal })
      .then((payload) => setReceipts(payload.requests ?? []))
      .catch(() => undefined)
    api<{ requests: PaymentEditRequest[] }>('/api/sales/payment-edit-requests', { signal: controller.signal })
      .then((payload) => setPayEdits(payload.requests ?? []))
      .catch(() => undefined)
    api<{ fixes: PaymentFix[] }>('/api/sales/payment-fixes', { signal: controller.signal })
      .then((payload) => setFixes(payload.fixes ?? []))
      .catch(() => undefined)
    return () => controller.abort()
  }, [reloadKey])

  if (rows.length === 0 && receipts.length === 0 && fixes.length === 0 && payEdits.length === 0) return null

  async function actPayEdit(row: PaymentEditRequest, allow: boolean) {
    const key = `pay|${row.user.id}|${row.day}`
    setBusy(key)
    try {
      await api('/api/sales/payment-edit/decide', {
        method: 'POST',
        body: { salespersonId: row.user.id, day: row.day, allow },
      })
      onMessage('success', t(allow ? 'pe.allowed' : 'er.declined', { name: row.user.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      onMessage('error', caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(null)
    }
  }

  // "Transfer 5,000 · CBE" or "Cash 300 + Transfer 200 · CBE".
  const paid = (method: string, cash: number, transfer: number, bank: string | null) =>
    method === 'CASH'
      ? `${t('pay.cash')} ${currency(cash)}`
      : method === 'TRANSFER'
        ? `${t('pay.transfer')} ${currency(transfer)} · ${bank ?? '—'}`
        : `${t('pay.cash')} ${currency(cash)} + ${t('pay.transfer')} ${currency(transfer)} · ${bank ?? '—'}`

  async function actFix(row: PaymentFix, allow: boolean) {
    setBusy(row.id)
    try {
      await api(`/api/sales/${row.id}/payment-fix/decide`, { method: 'POST', body: { allow } })
      onMessage('success', t(allow ? 'pf.approved' : 'er.declined', { name: row.salesperson.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      onMessage('error', caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(null)
    }
  }

  async function actReceipt(row: ReceiptRequest, allow: boolean) {
    setBusy(row.id)
    try {
      await api(`/api/receipts/${row.id}/decide-edit`, { method: 'POST', body: { allow } })
      onMessage('success', t(allow ? 'er.receiptAllowed' : 'er.declined', { name: row.uploadedBy.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      onMessage('error', caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(null)
    }
  }

  async function act(row: EditRequest, allow: boolean) {
    const key = `${row.salespersonId}|${row.day}`
    setBusy(key)
    try {
      await api(allow ? '/api/sales/allow-edits' : '/api/sales/decline-edit', {
        method: 'POST',
        body: { salespersonId: row.salespersonId, day: row.day },
      })
      onMessage('success', t(allow ? 'er.allowed' : 'er.declined', { name: row.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      onMessage('error', caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('er.title')} subtitle={t('er.note')}>
      {rows.length > 0 ? (
      <div className={base.scroll}>
        <table className={base.table}>
          <thead>
            <tr>
              <th scope="col">{t('sales.employee')}</th>
              <th scope="col">{t('common.branch')}</th>
              <th scope="col">{t('er.day')}</th>
              <th scope="col">{t('er.sales')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.salespersonId}|${row.day}`
              return (
                <tr key={key}>
                  <td data-label={t('sales.employee')} className={base.strong}>{row.name}</td>
                  <td data-label={t('common.branch')}>{row.branch ?? '—'}</td>
                  <td data-label={t('er.day')}>{shortDate(`${row.day}T12:00:00`)}</td>
                  <td data-label={t('er.sales')} className="tabular">{row.sales}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      type="button"
                      className={base.primary}
                      disabled={busy === key}
                      onClick={() => void act(row, true)}
                    >
                      {t('er.allow')}
                    </button>{' '}
                    <button
                      type="button"
                      className={base.secondary}
                      disabled={busy === key}
                      onClick={() => void act(row, false)}
                    >
                      {t('er.decline')}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      ) : null}

      {/* A day's payments (a mistyped transfer): opened for 24 hours. */}
      {payEdits.length > 0 ? (
        <div className={base.scroll} style={{ marginTop: rows.length > 0 ? 16 : 0 }}>
          <table className={base.table}>
            <thead>
              <tr>
                <th scope="col">{t('pe.title')}</th>
                <th scope="col">{t('common.branch')}</th>
                <th scope="col">{t('er.day')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {payEdits.map((row) => {
                const key = `pay|${row.user.id}|${row.day}`
                return (
                  <tr key={key}>
                    <td data-label={t('pe.title')} className={base.strong}>{row.user.name}</td>
                    <td data-label={t('common.branch')}>{row.user.branch?.name ?? '—'}</td>
                    <td data-label={t('er.day')}>{shortDate(`${row.day}T12:00:00`)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className={base.primary} disabled={busy === key} onClick={() => void actPayEdit(row, true)}>
                        {t('er.allow24')}
                      </button>{' '}
                      <button type="button" className={base.secondary} disabled={busy === key} onClick={() => void actPayEdit(row, false)}>
                        {t('er.decline')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* A sale's payment as the salesperson corrected it: applied on Approve. */}
      {fixes.length > 0 ? (
        <div className={base.scroll} style={{ marginTop: rows.length > 0 ? 16 : 0 }}>
          <table className={base.table}>
            <thead>
              <tr>
                <th scope="col">{t('pf.title')}</th>
                <th scope="col">{t('er.day')}</th>
                <th scope="col">{t('pf.was')}</th>
                <th scope="col">{t('pf.now')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {fixes.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('pf.title')} className={base.strong}>
                    {row.salesperson.name}
                    <em className={base.sub}>
                      {row.location.name} · {t('dlg.total')} {currency(Number(row.totalAmount))}
                    </em>
                  </td>
                  <td data-label={t('er.day')}>{shortDate(row.saleDate)}</td>
                  <td data-label={t('pf.was')}>
                    {paid(row.paymentMethod, Number(row.cashReceived), Number(row.transferReceived), row.bankName)}
                  </td>
                  <td data-label={t('pf.now')} className={base.strong}>
                    {paid(row.payFixMethod, Number(row.payFixCash ?? 0), Number(row.payFixTransfer ?? 0), row.payFixBank)}
                    {row.payFixNote ? <em className={base.sub}>{row.payFixNote}</em> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className={base.primary} disabled={busy === row.id} onClick={() => void actFix(row, true)}>
                      {t('pf.approve')}
                    </button>{' '}
                    <button type="button" className={base.secondary} disabled={busy === row.id} onClick={() => void actFix(row, false)}>
                      {t('er.decline')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Receipts: reopened for 24 hours when allowed. */}
      {receipts.length > 0 ? (
        <div className={base.scroll} style={{ marginTop: rows.length > 0 ? 16 : 0 }}>
          <table className={base.table}>
            <thead>
              <tr>
                <th scope="col">{t('er.receipt')}</th>
                <th scope="col">{t('common.branch')}</th>
                <th scope="col">{t('er.day')}</th>
                <th scope="col">{t('dlg.amount')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {receipts.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('er.receipt')} className={base.strong}>
                    {row.uploadedBy.name}
                    <em className={base.sub}>{row.bankName ?? '—'}</em>
                  </td>
                  <td data-label={t('common.branch')}>{row.location?.name ?? '—'}</td>
                  <td data-label={t('er.day')}>{shortDate(row.receiptDate)}</td>
                  <td data-label={t('dlg.amount')} className="tabular">{currency(Number(row.amount))}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className={base.primary} disabled={busy === row.id} onClick={() => void actReceipt(row, true)}>
                      {t('er.allow24')}
                    </button>{' '}
                    <button type="button" className={base.secondary} disabled={busy === row.id} onClick={() => void actReceipt(row, false)}>
                      {t('er.decline')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  )
}
