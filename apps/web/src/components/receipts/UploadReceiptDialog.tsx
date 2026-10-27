import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { businessDay } from '../../lib/tz'

import { useAuth } from '../../auth/context'
import { api, upload } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { currency } from '../../lib/format'
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from '../../lib/receipts'
import type { BankReceipt, BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type DaySummary = {
  salesYadere: string
  credited: string
  yadere: string
}

const MAX_LABEL = `${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))}MB`

function isoDay(date: Date) {
  return businessDay(date)
}

/**
 * Records money the bankers credited to the Owner's account.
 *
 * The bankers collect at the office after 5:30 and credit the account through
 * their app, so a slip may not exist: the file, bank and reference are all
 * optional. The branch's sales for the day, less everything credited, is
 * shown before saving and kept as yadere.
 *
 * The API takes multipart/form-data, not JSON, so this goes through `upload`
 * rather than `api`.
 */
export function UploadReceiptDialog({
  onClose,
  onDone,
  editing,
}: {
  onClose: () => void
  onDone: (message: string) => void
  /** A slip being corrected before it is verified: amount, bank, reference, day. */
  editing?: BankReceipt
}) {
  const [file, setFile] = useState<File | null>(null)
  const t = useT()
  const [bankName, setBankName] = useState(editing?.bankName ?? '')
  const [referenceNumber, setReferenceNumber] = useState(editing?.referenceNumber ?? '')
  const [amount, setAmount] = useState(editing ? String(Number(editing.amount)) : '')
  const { user } = useAuth()
  // The sales day the money belongs to, not the day it reached the bank. A
  // supervisor banks yadere, which is yesterday's cash, so theirs starts there.
  const [receiptDate, setReceiptDate] = useState(() => {
    if (editing) return isoDay(new Date(editing.receiptDate))
    const day = new Date()
    if (user?.role === 'SUPERVISOR') day.setDate(day.getDate() - 1)
    return isoDay(day)
  })
  // Cash is often split over two banks: each further bank is its own slip.
  const [more, setMore] = useState<{ key: number; bankName: string; amount: string; reference: string; file: File | null }[]>([])
  const [bankNames, setBankNames] = useState<string[]>([])

  useEffect(() => {
    const controller = new AbortController()
    api<{ banks: { name: string }[] }>('/api/banks', { signal: controller.signal })
      .then((payload) => setBankNames((payload.banks ?? []).map((row) => row.name)))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  function setLine(key: number, patch: Partial<(typeof more)[number]>) {
    setMore((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  // A supervisor records for their own branch; the Owner chooses one.
  const isOwner = user?.role === 'OWNER'
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [summary, setSummary] = useState<DaySummary | null>(null)

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
    if (!isOwner) return
    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches?isActive=true', {
      signal: controller.signal,
    })
      .then((payload) => setBranches(payload.branches ?? []))
      .catch(() => undefined)

    return () => controller.abort()
  }, [isOwner])

  const validBranchId = branches.some((row) => row.id === branchId)
    ? branchId
    : (branches[0]?.id ?? '')

  // The day's figures, refetched whenever the day or branch changes.
  useEffect(() => {
    // The branch's day figures are for those who keep the branch's cash.
    if (user?.role === 'SALES') return
    if (receiptDate === '' || (isOwner && validBranchId === '')) return
    const controller = new AbortController()

    const query = new URLSearchParams({ date: receiptDate })
    if (isOwner) query.set('branchId', validBranchId)

    api<{ summary: DaySummary }>(`/api/receipts/day-summary?${query}`, {
      signal: controller.signal,
    })
      .then((payload) => setSummary(payload.summary))
      .catch(() => {
        if (!controller.signal.aborted) setSummary(null)
      })

    return () => controller.abort()
  }, [receiptDate, isOwner, validBranchId, user?.role])

  // Derived rather than held in state: the URL follows the file, and a second
  // effect releases it so the blob does not stay in memory.
  const preview = useMemo(
    () =>
      file && file.type !== 'application/pdf'
        ? URL.createObjectURL(file)
        : null,
    [file],
  )

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  function pick(chosen: File | null) {
    setError(null)

    if (!chosen) {
      setFile(null)
      return
    }

    if (!RECEIPT_ACCEPT.split(',').includes(chosen.type)) {
      setError('That file type is not accepted — use a JPG, PNG, WebP or PDF.')
      setFile(null)
      return
    }

    if (chosen.size === 0) {
      setError('That file is empty.')
      setFile(null)
      return
    }

    if (chosen.size > RECEIPT_MAX_BYTES) {
      setError(t('dlg.fileTooLarge', { max: MAX_LABEL }))
      setFile(null)
      return
    }

    setFile(chosen)
  }

  // A salesperson's cash still to bank for the chosen sales day.
  const [toBank, setToBank] = useState<number | null>(null)
  useEffect(() => {
    if (user?.role !== 'SALES' || editing || receiptDate === '') return
    const controller = new AbortController()
    api<{ toBank: number }>(`/api/receipts/my-day?date=${receiptDate}`, { signal: controller.signal })
      .then((payload) => setToBank(payload.toBank))
      .catch(() => {
        if (!controller.signal.aborted) setToBank(0)
      })
    return () => controller.abort()
  }, [receiptDate, editing, user?.role])

  // A salesperson does not type the amount: it is the cash they still hold
  // for that sales day (every cash record so far, less deductions, expenses
  // and what they already banked). Other banks added take their part of it.
  const salesAuto = user?.role === 'SALES' && !editing
  const moreTotal = more.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const amountText =
    salesAuto && toBank != null ? String(Math.max(0, Math.round((toBank - moreTotal) * 100) / 100)) : amount
  const amountValue = Number(amountText)
  const amountValid = amountText.trim() !== '' && amountValue > 0
  const moreValid = more.every((line) => line.amount.trim() !== '' && Number(line.amount) > 0)
  const depositTotal = (amountValid ? amountValue : 0) + more.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)

  const canSubmit =
    !busy &&
    amountValid &&
    moreValid &&
    receiptDate !== '' &&
    (!isOwner || validBranchId !== '')

  useEffect(() => {
    if (editing || !summary) return
    // What is still to bank of that day's yadere: 0 once it is all banked.
    setAmount(String(Math.max(0, Number(summary.yadere))))
  }, [summary, editing])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      // A correction is sent as plain fields; the slip image stays as it is.
      if (editing) {
        await api(`/api/receipts/${editing.id}`, {
          method: 'PATCH',
          body: {
            amount: amountValue,
            receiptDate,
            bankName: bankName.trim() || null,
            referenceNumber: referenceNumber.trim() || null,
          },
        })
        onDone(t('rcpt.edited', { amount: currency(amountValue) }))
        return
      }

      const form = new FormData()
      // Fields first: the server reads the parts in order.
      form.append('amount', String(amountValue))
      form.append('receiptDate', receiptDate)
      if (isOwner) form.append('branchId', validBranchId)
      if (bankName.trim()) form.append('bankName', bankName.trim())
      if (referenceNumber.trim()) {
        form.append('referenceNumber', referenceNumber.trim())
      }
      if (file) form.append('file', file)

      await upload('/api/receipts', form)

      // Each further bank goes up as its own slip, for the same day.
      for (const line of more) {
        const extra = new FormData()
        extra.append('amount', String(Number(line.amount)))
        extra.append('receiptDate', receiptDate)
        if (isOwner) extra.append('branchId', validBranchId)
        if (line.bankName.trim()) extra.append('bankName', line.bankName.trim())
        if (line.reference.trim()) extra.append('referenceNumber', line.reference.trim())
        if (line.file) extra.append('file', line.file)
        await upload('/api/receipts', extra)
      }

      onDone(
        t('done.receiptUploaded', {
          amount: currency(depositTotal),
          bank: [bankName.trim(), ...more.map((line) => line.bankName.trim())].filter(Boolean).join(', ') || '—',
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not upload the receipt.',
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
        aria-label={t(user?.role === 'SALES' ? 'dlg.uploadBankReceipt' : 'dlg.uploadReceipt')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>
              {t(editing ? 'rcpt.editTitle' : user?.role === 'SALES' ? 'dlg.uploadBankReceipt' : 'dlg.uploadReceipt')}
            </h2>
            <p>{t(user?.role === 'SALES' ? 'dlg.uploadBankReceiptNote' : 'dlg.uploadReceiptNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {isOwner ? (
            <label className={styles.field}>
              <span>
                {t('common.branch')}<em>{t('common.required')}</em>
              </span>
              <select
                value={validBranchId}
                onChange={(event) => setBranchId(event.target.value)}
                required
              >
                {branches.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('dlg.salesDay')}<em>{t('common.required')}</em>
            </span>
            <input
              type="date"
              value={receiptDate}
              onChange={(event) => setReceiptDate(event.target.value)}
              required
            />
            <small style={{ color: 'var(--muted)', fontSize: 12 }}>{t('dlg.salesDayHint')}</small>
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.amount')}<em>{t('common.required')}</em>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountText}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
              // Filled in by the system: a salesperson's cash for the day, a
              // supervisor's the day's yadere. Only a correction is typed.
              disabled={!editing}
              readOnly={!editing}
            />
            {!salesAuto && !editing && summary && Number(summary.yadere) <= 0 ? (
              <small style={{ color: 'var(--danger)', fontSize: 12 }}>{t('dlg.nothingToBank')}</small>
            ) : null}
            {salesAuto ? (
              <small style={{ color: toBank === 0 ? 'var(--danger)' : 'var(--muted)', fontSize: 12 }}>
                {toBank == null ? t('common.loading') : toBank === 0 ? t('dlg.nothingToBank') : t('dlg.cashToBank')}
              </small>
            ) : null}
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.bank')}<em>{t('prod.optional')}</em>
            </span>
            <input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              maxLength={120}
              placeholder={t('dlg.phBank')}
              list="receipt-banks"
            />
            <datalist id="receipt-banks">
              {bankNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>
              {t('det.reference')}<em>{t('prod.optional')}</em>
            </span>
            <input
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              maxLength={120}
              placeholder="FT552483"
              spellCheck={false}
            />
          </label>

          {!editing ? (
          <label className={styles.field}>
            <span>
              {t('dlg.slip')}
              <em>{t('dlg.slipOptional', { types: t('dlg.slipTypes', { max: MAX_LABEL }) })}</em>
            </span>
            <input
              type="file"
              accept={RECEIPT_ACCEPT}
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
            />
          </label>
          ) : null}

          {preview ? (
            <img className={styles.slipPreview} src={preview} alt="" />
          ) : file ? (
            <p className={styles.tally}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          ) : null}

          {/* A second (or third) bank the same cash went to. */}
          {more.map((line, index) => (
            <div key={line.key} className={styles.saleLine}>
              <label className={styles.field}>
                <span>
                  {t('dlg.bank')} {index + 2}
                </span>
                <input
                  value={line.bankName}
                  onChange={(event) => setLine(line.key, { bankName: event.target.value })}
                  maxLength={120}
                  placeholder={t('dlg.phBank')}
                  list="receipt-banks"
                />
              </label>
              <label className={styles.qtyField}>
                <span>
                  {t('dlg.amount')}<em>{t('common.required')}</em>
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.amount}
                  onChange={(event) => setLine(line.key, { amount: event.target.value })}
                  required
                />
              </label>
              <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <span>
                  {t('det.reference')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={line.reference}
                  onChange={(event) => setLine(line.key, { reference: event.target.value })}
                  maxLength={120}
                  spellCheck={false}
                />
              </label>
              <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <span>
                  {t('dlg.slip')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  onChange={(event) => setLine(line.key, { file: event.target.files?.[0] ?? null })}
                />
              </label>
              <button
                type="button"
                className={styles.removeLine}
                onClick={() => setMore((current) => current.filter((entry) => entry.key !== line.key))}
                aria-label={t('a11y.removeItem', { n: index + 2 })}
              >
                ✕
              </button>
            </div>
          ))}

          {!editing ? (
          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setMore((current) => [
                ...current,
                { key: Math.max(0, ...current.map((line) => line.key)) + 1, bankName: '', amount: '', reference: '', file: null },
              ])
            }
          >
            {t('rcpt.addBank')}
          </button>
          ) : null}

          {more.length > 0 ? (
            <p className={styles.tally}>{t('rcpt.depositTotal', { amount: currency(depositTotal) })}</p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!canSubmit}
            >
              {busy ? t('prod.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
