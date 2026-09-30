import { AuthImg, AuthLink } from '../AuthFile'
import { useEffect } from 'react'

import { currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { isPdf, receiptRef, RECEIPT_STATUS_KEY } from '../../lib/receipts'
import type { BankReceipt } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

export function ReceiptDetails({
  receipt,
  onClose,
}: {
  receipt: BankReceipt
  onClose: () => void
}) {
  const t = useT()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('a11y.receipt', { ref: receiptRef(receipt) })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className="tabular">{receiptRef(receipt)}</h2>
            <p>
              {receipt.bankName} · {shortDate(receipt.receiptDate)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <dl className={styles.facts}>
            <div>
              <dt>{t('det.status')}</dt>
              <dd>
                <span className={styles.status} data-state={receipt.status}>
                  {t(RECEIPT_STATUS_KEY[receipt.status])}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t('det.amount')}</dt>
              <dd className="tabular">{currency(Number(receipt.amount))}</dd>
            </div>
            <div>
              <dt>{t('det.reference')}</dt>
              <dd className="tabular">{receipt.referenceNumber}</dd>
            </div>
            <div>
              <dt>{t('det.branch')}</dt>
              <dd>{receipt.uploadedBy.branch?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('det.uploadedBy')}</dt>
              <dd>{receipt.uploadedBy.name}</dd>
            </div>
            <div>
              <dt>{t('det.verifiedBy')}</dt>
              <dd>{receipt.verifiedBy?.name ?? t('det.notYet')}</dd>
            </div>
          </dl>

          {/* The slip is the evidence, so it is shown rather than linked. */}
          <section className={styles.section}>
            <h3>{t('dlg.slip')}</h3>

            {!receipt.fileUrl ? (
              <p className={styles.none}>{t('rcpt.noSlip')}</p>
            ) : isPdf(receipt) ? (
              <AuthLink
                className={styles.slipLink}
                href={receipt.fileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('det.openPdf')}
              </AuthLink>
            ) : (
              <AuthLink
                className={styles.slipFrame}
                href={receipt.fileUrl}
                target="_blank"
                rel="noreferrer"
              >
                <AuthImg
                  src={receipt.fileUrl}
                  alt={t('a11y.depositSlip', { ref: receipt.referenceNumber ?? '' })}
                />
                <span>{t('det.openFullSize')}</span>
              </AuthLink>
            )}
          </section>

          {receipt.notes ? (
            <section className={styles.section}>
              <h3>
                {receipt.status === 'REJECTED' ? t('det.whyRejected') : t('det.note')}
              </h3>
              {receipt.status === 'REJECTED' ? (
                <p className={styles.blocked}>{receipt.notes}</p>
              ) : (
                <p className={styles.none}>{receipt.notes}</p>
              )}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
