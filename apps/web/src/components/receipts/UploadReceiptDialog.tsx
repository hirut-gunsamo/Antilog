import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api, upload } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { currency } from '../../lib/format'
import { RECEIPT_ACCEPT, RECEIPT_MAX_BYTES } from '../../lib/receipts'
import type { BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type DaySummary = {
  carriedOver: string
  daySales: string
  credited: string
  yadere: string
}

const MAX_LABEL = `${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))}MB`

function isoDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
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
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const t = useT()
  const [bankName, setBankName] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [receiptDate, setReceiptDate] = useState(isoDay(new Date()))

  // A supervisor records for their own branch; the Owner chooses one.
  const { user } = useAuth()
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
  }, [receiptDate, isOwner, validBranchId])

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

  const amountValue = Number(amount)
  const amountValid = amount.trim() !== '' && amountValue > 0

  const canSubmit =
    !busy &&
    amountValid &&
    receiptDate !== '' &&
    (!isOwner || validBranchId !== '')

  const yadereAfter = summary
    ? Number(summary.yadere) - (amountValid ? amountValue : 0)
    : null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
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

      onDone(
        t('done.receiptUploaded', {
          amount: currency(amountValue),
          bank: bankName.trim() || '—',
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
        aria-label={t('dlg.uploadReceipt')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.uploadReceipt')}</h2>
            <p>{t('dlg.uploadReceiptNote')}</p>
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
              {t('dlg.paidInOn')}<em>{t('common.required')}</em>
            </span>
            <input
              type="date"
              value={receiptDate}
              onChange={(event) => setReceiptDate(event.target.value)}
              max={isoDay(new Date())}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.amount')}<em>{t('common.required')}</em>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
              autoFocus
            />
          </label>

          {summary ? (
            <dl className={styles.facts}>
              <div>
                <dt>{t('dlg.carriedOver')}</dt>
                <dd className="tabular">{currency(Number(summary.carriedOver))}</dd>
              </div>
              <div>
                <dt>{t('dlg.daySales')}</dt>
                <dd className="tabular">{currency(Number(summary.daySales))}</dd>
              </div>
              <div>
                <dt>{t('dlg.creditedSoFar')}</dt>
                <dd className="tabular">{currency(Number(summary.credited))}</dd>
              </div>
              <div>
                <dt>{t('dlg.yadereAfter')}</dt>
                <dd className="tabular">
                  <strong>{currency(yadereAfter ?? 0)}</strong>
                </dd>
              </div>
            </dl>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('dlg.bank')}<em>{t('prod.optional')}</em>
            </span>
            <input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              maxLength={120}
              placeholder={t('dlg.phBank')}
            />
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

          {preview ? (
            <img className={styles.slipPreview} src={preview} alt="" />
          ) : file ? (
            <p className={styles.tally}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
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
