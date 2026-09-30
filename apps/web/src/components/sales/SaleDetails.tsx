import { useEffect } from 'react'

import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { saleItemCount, saleRef, STATUS_KEY } from '../../lib/sales'
import type { Sale, SaleItem } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

// A serialised line names the exact units that left the shelf.
function unitLabel(unit: SaleItem['inventoryUnits'][number]) {
  return unit.iccid ?? unit.imei ?? unit.serialNumber ?? unit.id.slice(-8)
}

export function SaleDetails({
  sale,
  onClose,
}: {
  sale: Sale
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

  const received = Number(sale.cashReceived) + Number(sale.transferReceived)
  const change = received - Number(sale.totalAmount)

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('a11y.saleRef', { ref: saleRef(sale) })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className="tabular">{saleRef(sale)}</h2>
            <p>
              {shortDate(sale.saleDate)} · {sale.location.name}
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
                <span className={styles.status} data-state={sale.status}>
                  {t(STATUS_KEY[sale.status])}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t('det.employee')}</dt>
              <dd>{sale.salesperson.name}</dd>
            </div>
            <div>
              <dt>{t('det.items')}</dt>
              <dd className="tabular">{count(saleItemCount(sale))}</dd>
            </div>
            <div>
              <dt>{t('det.total')}</dt>
              <dd className="tabular">{currency(Number(sale.totalAmount))}</dd>
            </div>
            <div>
              <dt>{t('pay.method')}</dt>
              <dd>
                {sale.paymentMethod === 'TRANSFER'
                  ? `${t('pay.transfer')} · ${sale.bankName ?? ''}`
                  : t('pay.cash')}
              </dd>
            </div>
            <div>
              <dt>{t(sale.paymentMethod === 'TRANSFER' ? 'pay.transferReceived' : 'dlg.cashReceived')}</dt>
              <dd className="tabular">{currency(received)}</dd>
            </div>
            <div>
              <dt>{change < 0 ? t('det.shortBy') : t('det.change')}</dt>
              <dd className="tabular">{currency(Math.abs(change))}</dd>
            </div>
          </dl>

          <section className={styles.section}>
            <h3>
              {t('det.items')}
              <span>{sale.items.length}</span>
            </h3>

            <ul className={styles.moves}>
              {sale.items.map((item) => (
                <li key={item.id}>
                  <span className={styles.moveWhere}>
                    {item.product.name}
                    <em className={styles.sub}>
                      {count(item.quantity)} × {currency(Number(item.unitPrice))}
                    </em>
                  </span>
                  <span className={`${styles.moveQty} tabular`}>
                    {currency(Number(item.lineTotal))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {sale.items.some((item) => item.inventoryUnits.length > 0) ? (
            <section className={styles.section}>
              <h3>
                {t('det.unitsSold')}
                <span>
                  {sale.items.reduce(
                    (total, item) => total + item.inventoryUnits.length,
                    0,
                  )}
                </span>
              </h3>

              <ul className={styles.units}>
                {sale.items.flatMap((item) =>
                  item.inventoryUnits.map((unit) => (
                    <li key={unit.id}>
                      <span className="tabular">{unitLabel(unit)}</span>
                      <em>{item.product.sku}</em>
                    </li>
                  )),
                )}
              </ul>
            </section>
          ) : null}

          <section className={styles.section}>
            <h3>{t('det.approval')}</h3>

            {sale.status === 'REJECTED' && sale.rejectionReason ? (
              <p className={styles.blocked}>{sale.rejectionReason}</p>
            ) : sale.approvedBy ? (
              <p className={styles.none}>
                {sale.approvedAt
                  ? t('det.approvedByOn', {
                      name: sale.approvedBy.name,
                      when: shortDate(sale.approvedAt),
                    })
                  : t('det.approvedBy', { name: sale.approvedBy.name })}
              </p>
            ) : sale.submittedAt ? (
              <p className={styles.none}>
                {t('det.submittedWaiting', { when: shortDate(sale.submittedAt) })}
              </p>
            ) : (
              <p className={styles.none}>{t('det.stillDraft')}</p>
            )}
          </section>

          {sale.notes ? (
            <section className={styles.section}>
              <h3>{t('det.note')}</h3>
              <p className={styles.none}>{sale.notes}</p>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
