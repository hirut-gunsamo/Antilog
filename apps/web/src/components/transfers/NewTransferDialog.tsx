import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { count } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { BranchRow, InventoryBalance } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Line = { key: number; productId: string; quantity: string }

/**
 * The Owner moves stock from one branch to another: from, to, the items, and
 * who is driving it. The goods leave the source at once and reach the other
 * branch when its supervisor presses Received.
 */
export function NewTransferDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()

  const [branches, setBranches] = useState<BranchRow[]>([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [stock, setStock] = useState<InventoryBalance[]>([])
  const [lines, setLines] = useState<Line[]>([{ key: 0, productId: '', quantity: '' }])
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [plate, setPlate] = useState('')
  const [notes, setNotes] = useState('')
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
    api<{ branches: BranchRow[] }>('/api/branches?isActive=true', { signal: controller.signal })
      .then((payload) => setBranches((payload.branches ?? []).filter((row) => row.isActive)))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  // What the sending branch holds, so only goods it has can be picked.
  useEffect(() => {
    if (!fromId) return
    const controller = new AbortController()
    api<{ inventory: InventoryBalance[] }>(`/api/inventory?locationId=${encodeURIComponent(fromId)}`, {
      signal: controller.signal,
    })
      .then((payload) => setStock((payload.inventory ?? []).filter((row) => row.onShelf > 0)))
      .catch(() => setStock([]))
    return () => controller.abort()
  }, [fromId])

  const held = (productId: string) => stock.find((row) => row.productId === productId)?.onShelf ?? 0

  const phoneOk = /^[+()\d][\d\s()+-]*$/.test(driverPhone.trim()) && driverPhone.trim().length >= 7
  const linesOk =
    lines.length > 0 &&
    lines.every((line) => {
      const qty = Number(line.quantity)
      return line.productId !== '' && Number.isInteger(qty) && qty > 0 && qty <= held(line.productId)
    })
  const valid =
    fromId !== '' &&
    toId !== '' &&
    fromId !== toId &&
    linesOk &&
    driverName.trim().length >= 2 &&
    phoneOk &&
    plate.trim().length >= 2

  function change(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api('/api/transfers', {
        method: 'POST',
        body: {
          fromLocationId: fromId,
          toLocationId: toId,
          items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
          driverName: driverName.trim(),
          driverPhone: driverPhone.trim(),
          vehiclePlate: plate.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      })
      const from = branches.find((row) => row.id === fromId)?.name ?? ''
      const to = branches.find((row) => row.id === toId)?.name ?? ''
      onDone(t('tr.sent', { from, to }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={t('tr.newTitle')} onClick={(event) => event.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2>{t('tr.newTitle')}</h2>
            <p>{t('tr.newNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('tr.from')}<em>{t('common.required')}</em>
            </span>
            <select
              value={fromId}
              onChange={(event) => {
                setFromId(event.target.value)
                setLines([{ key: 0, productId: '', quantity: '' }])
              }}
            >
              <option value="">{t('dlg.selectBranch')}</option>
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.isMainStock ? ` · ${t('tr.mainWarehouse')}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              {t('tr.to')}<em>{t('common.required')}</em>
            </span>
            <select value={toId} onChange={(event) => setToId(event.target.value)}>
              <option value="">{t('dlg.selectBranch')}</option>
              {branches
                .filter((row) => row.id !== fromId)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </label>

          {fromId !== '' ? (
            <>
              {lines.map((line) => (
                <div key={line.key} className={styles.withAdd}>
                  <select value={line.productId} onChange={(event) => change(line.key, { productId: event.target.value })} aria-label={t('dlg.product')}>
                    <option value="">{t('dlg.selectProduct')}</option>
                    {stock.map((row) => (
                      <option key={row.productId} value={row.productId}>
                        {row.product.name} · {t('tr.held', { n: count(row.onShelf) })}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={held(line.productId) || undefined}
                    step="1"
                    value={line.quantity}
                    onChange={(event) => change(line.key, { quantity: event.target.value })}
                    placeholder={t('dlg.quantity')}
                    aria-label={t('dlg.quantity')}
                    style={{ maxWidth: 110 }}
                  />
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className={styles.deleteLine}
                      onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                      aria-label={t('prod.delete')}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}

              {stock.length === 0 ? <p className={styles.blocked}>{t('tr.nothingHeld')}</p> : null}

              <button
                type="button"
                className={styles.addLine}
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { key: Math.max(...current.map((entry) => entry.key)) + 1, productId: '', quantity: '' },
                  ])
                }
              >
                + {t('com.addItem')}
              </button>
            </>
          ) : null}

          <h3 className={styles.gridHead}>{t('dlg.driver')}</h3>

          <label className={styles.field}>
            <span>
              {t('dlg.driverName')}<em>{t('common.required')}</em>
            </span>
            <input value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={120} placeholder={t('dlg.phDriverName')} />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.driverPhone')}<em>{t('common.required')}</em>
            </span>
            <input type="tel" inputMode="tel" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} maxLength={24} placeholder="09…" />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.vehiclePlate')}<em>{t('common.required')}</em>
            </span>
            <input value={plate} onChange={(event) => setPlate(event.target.value)} maxLength={40} placeholder={t('dlg.phPlate')} />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t('tr.send')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
