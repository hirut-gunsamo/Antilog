import { useEffect } from 'react'

import { useT } from '../../lib/i18n'
import type { StockRequest } from '../../lib/types'
import panel from '../inventory/Panel.module.css'
import { CategoryDecisions } from './CategoryDecisions'

/**
 * A request's items, to approve before anything is sent: tick all or some
 * and approve them together, or decide each one. Once the last item is
 * decided the page moves on to Send, where the driver is named.
 */
export function ApproveItemsDialog({
  request,
  onClose,
  onDecided,
  onError,
}: {
  request: StockRequest
  onClose: () => void
  onDecided: (updated: StockRequest, message: string) => void
  onError: (message: string) => void
}) {
  const t = useT()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const from = [request.requestedBy.name, request.requestedBy.branch?.name].filter(Boolean).join(' · ')

  return (
    <div className={panel.scrim} onClick={onClose}>
      <aside
        className={panel.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('appr.approveItemsTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={panel.head}>
          <div>
            <h2>{t('appr.approveItemsTitle')}</h2>
            <p>{from}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={panel.body}>
          <p className={panel.hint}>{t('appr.approveItemsNote')}</p>
          <CategoryDecisions request={request} onDecided={onDecided} onError={onError} />

          <div className={panel.actions}>
            <button type="button" className={panel.cancel} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
