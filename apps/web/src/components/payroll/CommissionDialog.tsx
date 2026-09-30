import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useCategories } from '../../lib/categories'
import { CategoryDialog } from '../categories/CategoryDialog'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { CommissionPaymentRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

// A category id, or National ID, which is not a category of goods.
const NATIONAL_ID = 'NATIONAL_ID'
type Line = { key: number; item: string; quantity: string; price: string; percent: string }

/** quantity x value, or a percent of it when one is given (airtime). */
const amountOf = (line: Line) => {
  const base = (Number(line.quantity) || 0) * (Number(line.price) || 0)
  const percent = Number(line.percent) || 0
  return Math.round((percent ? (base * percent) / 100 : base) * 100) / 100
}

/**
 * Pay commission: the employee, then one line per item — any of the Owner's
 * categories, or National ID — how many and the value each; commission is
 * quantity x value, or a percent of that for airtime.
 * Each line and the total are worked out. The same form edits a payment.
 */
export function CommissionDialog({
  month,
  editing,
  onClose,
  onDone,
}: {
  month: string
  editing: CommissionPaymentRow | null
  onClose: () => void
  onDone: (name: string, total: number) => void
}) {
  const t = useT()

  // Every category the Owner has, then National ID.
  const { categories, reload: reloadCategories } = useCategories()
  // The line a new category is being added for, so it lands there.
  const [addingFor, setAddingFor] = useState<number | null>(null)
  const items = [...categories.map((entry) => ({ id: entry.id, name: entry.name })), { id: NATIONAL_ID, name: t('nav.nationalId') }]

  const [employees, setEmployees] = useState<{ id: string; name: string; isActive: boolean; branch: { name: string } | null }[]>([])
  const [userId, setUserId] = useState(editing?.user.id ?? '')
  const [lines, setLines] = useState<Line[]>(
    editing
      ? editing.lines.map((line, index) => ({
          key: index,
          item: line.categoryId ?? (line.label === 'National ID' ? NATIONAL_ID : ''),
          quantity: line.quantity != null ? String(line.quantity) : '',
          price: line.unitPrice != null ? String(Number(line.unitPrice)) : '',
          percent: line.percent != null ? String(Number(line.percent)) : '',
        }))
      : [{ key: 0, item: '', quantity: '', price: '', percent: '' }],
  )
  const [note, setNote] = useState(editing?.note ?? '')
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
    if (editing) return
    const controller = new AbortController()

    api<{ employees: typeof employees }>('/api/payroll/employees', { signal: controller.signal })
      .then((payload) => setEmployees((payload.employees ?? []).filter((row) => row.isActive)))
      .catch(() => undefined)

    return () => controller.abort()
  }, [editing])

  const validUserId = editing ? editing.user.id : employees.some((row) => row.id === userId) ? userId : (employees[0]?.id ?? '')
  const name = editing ? editing.user.name : (employees.find((row) => row.id === validUserId)?.name ?? '')

  const total = lines.reduce((sum, line) => sum + amountOf(line), 0)
  const valid =
    validUserId !== '' &&
    lines.length > 0 &&
    lines.every((line) => Number(line.percent) <= 100 && amountOf(line) > 0)

  function change(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }


  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    const body = {
      lines: lines.map((line) => ({
        item: line.item || items[0]?.id,
        quantity: Number(line.quantity),
        unitPrice: Number(line.price),
        percent: line.percent.trim() === '' ? null : Number(line.percent),
      })),
      ...(note.trim() ? { note: note.trim() } : {}),
    }

    try {
      if (editing) {
        await api(`/api/payroll/commissions/${editing.id}`, { method: 'PATCH', body })
      } else {
        await api('/api/payroll/commissions', { method: 'POST', body: { userId: validUserId, month, ...body } })
      }
      onDone(name, total)
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
        aria-label={t(editing ? 'com.editTitle' : 'com.payTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(editing ? 'com.editTitle' : 'com.payTitle')}</h2>
            <p>{month}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('pay.employee')}<em>{t('common.required')}</em>
            </span>
            <select value={validUserId} onChange={(event) => setUserId(event.target.value)} disabled={Boolean(editing)}>
              {editing ? (
                <option value={editing.user.id}>{editing.user.name}</option>
              ) : (
                employees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.branch ? ` · ${row.branch.name}` : ''}
                  </option>
                ))
              )}
            </select>
          </label>

          {lines.map((line, index) => (
            <fieldset key={line.key} className={styles.lineBox}>
              <div className={styles.withAdd}>
                <select
                  value={line.item || items[0]?.id || ''}
                  onChange={(event) => change(line.key, { item: event.target.value })}
                  aria-label={t('com.item')}
                  autoFocus={index === lines.length - 1 && index > 0}
                >
                  {items.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={styles.addLine} onClick={() => setAddingFor(line.key)}>
                  + {t('cat.add')}
                </button>
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

              <div className={styles.lineGrid}>
                <label>
                  <span>{t('com.quantity')}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={line.quantity}
                    onChange={(event) => change(line.key, { quantity: event.target.value })}
                    placeholder="100"
                  />
                </label>
                <label>
                  <span>{t('com.value')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={line.price}
                    onChange={(event) => change(line.key, { price: event.target.value })}
                  />
                </label>
                <label>
                  <span>
                    {t('com.percent')} <em style={{ fontStyle: 'normal', fontWeight: 400 }}>{t('com.percentOptional')}</em>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={line.percent}
                    onChange={(event) => change(line.key, { percent: event.target.value })}
                    placeholder="—"
                  />
                </label>
                <label>
                  <span>{t('pay.commission')}</span>
                  <strong className="tabular">{currency(amountOf(line))}</strong>
                </label>
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: Math.max(...current.map((entry) => entry.key)) + 1,
                  // The next category not used yet, so a new line is not a repeat.
                  item: items.find((option) => !current.some((entry) => (entry.item || items[0]?.id) === option.id))?.id ?? '',
                  quantity: '',
                  price: '',
                  percent: '',
                },
              ])
            }
          >
            + {t('com.addItem')}
          </button>

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </label>

          <dl className={styles.facts}>
            <div>
              <dt>{t('com.total')}</dt>
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
              {busy ? t('prod.saving') : t(editing ? 'common.save' : 'com.pay')}
            </button>
          </div>
        </form>
      </aside>

      {addingFor !== null ? (
        <CategoryDialog
          onClose={() => setAddingFor(null)}
          onDone={(created) => {
            change(addingFor, { item: created.id })
            setAddingFor(null)
            reloadCategories()
          }}
        />
      ) : null}
    </div>
  )
}
