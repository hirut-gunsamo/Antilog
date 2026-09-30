import { useEffect } from 'react'

import { currency, count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { stockStatus } from '../../lib/stock'
import type {
  InventoryBalance,
  InventoryUnit,
  StockMovement,
} from '../../lib/types'
import styles from './Panel.module.css'

const STATUS_KEY = {
  IN_STOCK: 'inv.inStock',
  LOW_STOCK: 'inv.lowStock',
  OUT_OF_STOCK: 'inv.outOfStock',
} as const

// The identifier a unit is actually known by depends on what it is: a SIM is
// tracked by ICCID, a phone by IMEI.
function identifier(unit: InventoryUnit) {
  return unit.iccid ?? unit.imei ?? unit.simNumber ?? unit.serialNumber ?? '—'
}

export function UnitDetails({
  balance,
  units,
  movements,
  threshold,
  onClose,
}: {
  balance: InventoryBalance
  units: InventoryUnit[]
  movements: StockMovement[]
  threshold: number
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

  const state = stockStatus(balance.product.category, balance.onShelf)

  // The movement list is every branch's history for this product, so label
  // each row with where it came from and went to.
  const recent = movements.slice(0, 12)

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('a11y.detailsFor', { name: balance.product.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{balance.product.name}</h2>
            <p className="tabular">{balance.product.sku}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <dl className={styles.facts}>
            <div>
              <dt>{t('det.branch')}</dt>
              <dd>{balance.location.name}</dd>
            </div>
            <div>
              <dt>{t('inv.onShelf')}</dt>
              <dd className="tabular">{count(balance.onShelf)}</dd>
            </div>
            <div>
              <dt>{t('inv.withSales')}</dt>
              <dd className="tabular">{count(balance.withSellers)}</dd>
            </div>
            <div>
              <dt>{t('inv.branchTotal')}</dt>
              <dd className="tabular">{count(balance.quantity)}</dd>
            </div>
            <div>
              <dt>{t('det.status')}</dt>
              <dd>
                <span className={styles.status} data-state={state}>
                  {t(STATUS_KEY[state])}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t('dlg.price')}</dt>
              <dd className="tabular">
                {currency(Number(balance.product.price ?? 0))}
              </dd>
            </div>
            <div>
              <dt>{t('det.lowStockAt')}</dt>
              <dd className="tabular">{threshold || '—'}</dd>
            </div>
            <div>
              <dt>{t('det.stockValue')}</dt>
              <dd className="tabular">
                {currency(
                  Number(balance.product.price ?? 0) * balance.quantity,
                )}
              </dd>
            </div>
          </dl>

          <section className={styles.section}>
            <h3>
              {t('det.soldUnits')}
              <span>{units.length}</span>
            </h3>

            {units.length === 0 ? (
              <p className={styles.none}>{t('det.noSoldUnits')}</p>
            ) : (
              <ul className={styles.units}>
                {units.slice(0, 25).map((unit) => (
                  <li key={unit.id}>
                    <span className="tabular">{identifier(unit)}</span>
                    <em data-state={unit.status}>{unit.status}</em>
                  </li>
                ))}
                {units.length > 25 ? (
                  <li className={styles.more}>
                    {t('det.more', { n: units.length - 25 })}
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h3>
              {t('det.stockHistory')}
              <span>{movements.length}</span>
            </h3>

            {recent.length === 0 ? (
              <p className={styles.none}>{t('det.noMovements')}</p>
            ) : (
              <ul className={styles.moves}>
                {recent.map((move) => (
                  <li key={move.id}>
                    <span className={styles.moveType} data-type={move.type}>
                      {move.type}
                    </span>
                    <span className={styles.moveWhere}>
                      {move.fromLocation?.name ?? 'Supplier'} →{' '}
                      {move.toLocation?.name ?? 'Sold'}
                    </span>
                    <span className={`${styles.moveQty} tabular`}>
                      {count(move.quantity)}
                    </span>
                    <span className={styles.moveWhen}>
                      {shortDate(move.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
