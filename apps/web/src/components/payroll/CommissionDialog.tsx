import { useEffect, useState, type FormEvent } from 'react'
import { businessDay } from '../../lib/tz'

import { api } from '../../lib/api'
import { useCategories } from '../../lib/categories'
import { CategoryDialog } from '../categories/CategoryDialog'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { CommissionPaymentRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

// A category id, or National ID, which is not a category of goods.
const NATIONAL_ID = 'NATIONAL_ID'
const NO_BRANCH = '__none__'

/** One item's commission: birr per item sold, or a percent of the sales. */
type Line = { key: number; item: string; rate: string; percent: boolean }

/**
 * What each person sold in the chosen days, per item: { userId: { item:
 * figures } }. paid: a commission already paid over some of those days.
 */
type Sold = Record<
  string,
  Record<string, { quantity: number; sales: number; paid: { from: string; to: string } | null }>
>

type Employee = {
  id: string
  name: string
  role: string
  isActive: boolean
  branch: { id: string; name: string } | null
}

function isoDay(date: Date) {
  return businessDay(date)
}

function today() {
  return isoDay(new Date())
}

/** The month's first day, and today or the month's last day if it is over. */
function monthDays(month: string) {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(year, number - 1, 1)
  const last = new Date(year, number, 0)
  return { from: isoDay(first), to: isoDay(new Date(Math.min(Date.now(), last.getTime()))) }
}

/**
 * Pay commission: the branch and one or more of its people, the day it was
 * paid, then one line per item — any of the Owner's categories, or National
 * ID — with its commission: birr per item, or a percent of the sales for
 * airtime. How many each person sold is read from their own sales for the
 * month, never typed in; each person gets their own payment at the same
 * rates. The same form edits a payment.
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
  onDone: (names: string, total: number, skipped: string[]) => void
}) {
  const t = useT()

  // Every category the Owner has, then National ID.
  const { categories, reload: reloadCategories } = useCategories()
  // The line a new category is being added for, so it lands there.
  const [addingFor, setAddingFor] = useState<number | null>(null)
  const items = [
    ...categories.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind })),
    { id: NATIONAL_ID, name: t('nav.nationalId'), kind: 'OTHER' as const },
  ]
  // Airtime is paid as a percent of its sales; everything else per item.
  const isPercentItem = (id: string) => items.find((option) => option.id === id)?.kind === 'AIRTIME_VOUCHER'

  const [employees, setEmployees] = useState<Employee[]>([])
  const [branchId, setBranchId] = useState(editing?.user.branch?.id ?? '')
  // The people being paid; the first row is always there.
  const [picked, setPicked] = useState<string[]>(editing ? [editing.user.id] : [''])
  const [paidOn, setPaidOn] = useState(editing?.paidAt.slice(0, 10) ?? today())
  // The days whose sales are paid for; quantities are counted over them.
  const editedStart = editing?.lines.find((line) => line.periodStart)?.periodStart
  const editedEnd = editing?.lines.find((line) => line.periodEnd)?.periodEnd
  const [from, setFrom] = useState(editedStart ? isoDay(new Date(editedStart)) : monthDays(month).from)
  const [to, setTo] = useState(
    editedEnd ? isoDay(new Date(new Date(editedEnd).getTime() - 1)) : monthDays(month).to,
  )
  const [lines, setLines] = useState<Line[]>(
    editing
      ? editing.lines.map((line, index) => ({
          key: index,
          item: line.categoryId ?? (line.label === 'National ID' ? NATIONAL_ID : ''),
          rate: String(Number(line.percent ?? line.unitPrice ?? 0)),
          percent: line.percent != null,
        }))
      : [{ key: 0, item: '', rate: '', percent: false }],
  )
  const [sold, setSold] = useState<Sold>({})
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

    api<{ employees: Employee[] }>('/api/payroll/employees', { signal: controller.signal })
      .then((payload) => setEmployees((payload.employees ?? []).filter((row) => row.isActive)))
      .catch(() => undefined)

    return () => controller.abort()
  }, [editing])

  const branchOptions = [
    ...new Map(
      employees.map((row) => [row.branch?.id ?? NO_BRANCH, row.branch?.name ?? t('dlg.noBranch')] as const),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const validBranchId = branchOptions.some(([id]) => id === branchId) ? branchId : (branchOptions[0]?.[0] ?? '')
  const branchPeople = employees
    .filter((row) => (row.branch?.id ?? NO_BRANCH) === validBranchId)
    .sort(
      (a, b) =>
        Number(b.role === 'SUPERVISOR') - Number(a.role === 'SUPERVISOR') || a.name.localeCompare(b.name),
    )

  // Each row's person: what was picked if it is in this branch, otherwise the
  // first of the branch's people not already taken by an earlier row.
  const people: { id: string; name: string }[] = editing
    ? [{ id: editing.user.id, name: editing.user.name }]
    : picked.reduce<{ id: string; name: string }[]>((rows, id) => {
        const taken = new Set(rows.map((row) => row.id))
        const chosen =
          branchPeople.find((row) => row.id === id && !taken.has(row.id)) ??
          branchPeople.find((row) => !taken.has(row.id))
        return chosen ? [...rows, { id: chosen.id, name: chosen.name }] : rows
      }, [])
  const peopleKey = people.map((row) => row.id).join(',')

  // How many each person sold in the chosen days, item by item.
  useEffect(() => {
    if (!peopleKey || !from || !to || to < from) return
    const controller = new AbortController()
    const query = new URLSearchParams({ from, to, userIds: peopleKey })
    if (editing) query.set('except', editing.id)
    api<{ sold: Sold }>(`/api/payroll/sold?${query}`, { signal: controller.signal })
      .then((payload) => setSold(payload.sold ?? {}))
      .catch(() => undefined)
    return () => controller.abort()
  }, [from, to, peopleKey, editing])

  const lineItem = (line: Line) => line.item || items[0]?.id || ''
  // A line still on its default item takes that item's mode (airtime: %).
  const modeOf = (line: Line) => (line.item ? line.percent : isPercentItem(lineItem(line)))
  const figuresFor = (userId: string, line: Line) =>
    sold[userId]?.[lineItem(line)] ?? { quantity: 0, sales: 0, paid: null }
  const amountFor = (userId: string, line: Line) => {
    const { quantity, sales } = figuresFor(userId, line)
    const rate = Number(line.rate) || 0
    return Math.round((modeOf(line) ? (sales * rate) / 100 : quantity * rate) * 100) / 100
  }

  const totalFor = (userId: string) => lines.reduce((sum, line) => sum + amountFor(userId, line), 0)
  const total = people.reduce((sum, person) => sum + totalFor(person.id), 0)
  // Days already paid for any person and item on the form: not again.
  const alreadyPaid = people.some((person) => lines.some((line) => figuresFor(person.id, line).paid))
  const valid =
    people.length > 0 &&
    paidOn !== '' &&
    from !== '' &&
    to !== '' &&
    from <= to &&
    !alreadyPaid &&
    lines.length > 0 &&
    lines.every((line) => Number(line.rate) > 0 && (!modeOf(line) || Number(line.rate) <= 100)) &&
    total > 0

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
        item: lineItem(line),
        rate: Number(line.rate),
        percent: modeOf(line),
      })),
      from,
      to,
      paidOn,
      ...(note.trim() ? { note: note.trim() } : {}),
    }

    try {
      if (editing) {
        await api(`/api/payroll/commissions/${editing.id}`, { method: 'PATCH', body })
        onDone(editing.user.name, total, [])
      } else {
        const payload = await api<{ skipped: string[] }>('/api/payroll/commissions', {
          method: 'POST',
          body: { userIds: people.map((row) => row.id), month, ...body },
        })
        const skipped = payload.skipped ?? []
        onDone(
          people
            .filter((row) => !skipped.includes(row.name))
            .map((row) => row.name)
            .join(', '),
          total,
          skipped,
        )
      }
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
              {t('common.branch')}<em>{t('common.required')}</em>
            </span>
            <select
              value={editing ? (editing.user.branch?.id ?? NO_BRANCH) : validBranchId}
              onChange={(event) => {
                setBranchId(event.target.value)
                setPicked([''])
              }}
              disabled={Boolean(editing)}
            >
              {editing ? (
                <option value={editing.user.branch?.id ?? NO_BRANCH}>
                  {editing.user.branch?.name ?? t('dlg.noBranch')}
                </option>
              ) : (
                branchOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))
              )}
            </select>
          </label>

          {/* One row per person paid at these rates; + Add employee for more. */}
          <div className={styles.field}>
            <span>
              {t('pay.employee')}<em>{t('common.required')}</em>
            </span>
            {people.map((person, index) => {
              const others = new Set(people.filter((_, i) => i !== index).map((row) => row.id))
              return (
                <div key={index} className={styles.withAdd}>
                  <select
                    value={person.id}
                    onChange={(event) =>
                      setPicked(people.map((row, i) => (i === index ? event.target.value : row.id)))
                    }
                    disabled={Boolean(editing)}
                    aria-label={t('pay.employee')}
                  >
                    {editing ? (
                      <option value={person.id}>{person.name}</option>
                    ) : (
                      branchPeople
                        .filter((row) => !others.has(row.id))
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))
                    )}
                  </select>
                  {index === 0 && !editing ? (
                    <button
                      type="button"
                      className={styles.addLine}
                      onClick={() => setPicked([...people.map((row) => row.id), ''])}
                      disabled={people.length >= branchPeople.length}
                    >
                      + {t('com.addEmployee')}
                    </button>
                  ) : null}
                  {index > 0 ? (
                    <button
                      type="button"
                      className={styles.deleteLine}
                      onClick={() => setPicked(people.filter((_, i) => i !== index).map((row) => row.id))}
                      aria-label={t('prod.delete')}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* The sales of these days are what the commission pays for. */}
          <div className={styles.field}>
            <span>
              {t('com.salesDates')}<em>{t('common.required')}</em>
            </span>
            <div className={styles.withAdd}>
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  if (to && event.target.value > to) setTo(event.target.value)
                }}
                aria-label={t('ibid.from')}
                required
              />
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  if (from && event.target.value < from) setFrom(event.target.value)
                }}
                aria-label={t('ibid.to')}
                required
              />
            </div>
          </div>

          <label className={styles.field}>
            <span>
              {t('pay.paidOn')}<em>{t('common.required')}</em>
            </span>
            <input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} required />
          </label>

          {lines.map((line, index) => (
            <fieldset key={line.key} className={styles.lineBox}>
              <div className={styles.withAdd}>
                <select
                  value={lineItem(line)}
                  onChange={(event) =>
                    change(line.key, { item: event.target.value, rate: '', percent: isPercentItem(event.target.value) })
                  }
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

              {/* Quantity is what was sold, read from the sales. The Owner
                  gives the value per item, or for airtime the percent of
                  its sales; the commission follows. */}
              <div className={styles.lineGrid}>
                <label>
                  <span>{t('com.quantity')}</span>
                  <input
                    className="tabular"
                    value={count(people.reduce((sum, person) => sum + figuresFor(person.id, line).quantity, 0))}
                    readOnly
                    tabIndex={-1}
                    aria-readonly="true"
                  />
                </label>
                <label>
                  <span>{t('com.value')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={modeOf(line) ? '' : line.rate}
                    onChange={(event) => change(line.key, { rate: event.target.value })}
                    placeholder={modeOf(line) ? '—' : '10'}
                    disabled={modeOf(line)}
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
                    value={modeOf(line) ? line.rate : ''}
                    onChange={(event) => change(line.key, { rate: event.target.value })}
                    placeholder={modeOf(line) ? '5' : '—'}
                    disabled={!modeOf(line)}
                  />
                </label>
                <label>
                  <span>{t('pay.commission')}</span>
                  <strong className="tabular">
                    {currency(people.reduce((sum, person) => sum + amountFor(person.id, line), 0))}
                  </strong>
                </label>
              </div>

              {/* What each person sold of it this month, and what that earns. */}
              <dl className={styles.facts}>
                {people.map((person) => {
                  const { quantity, sales, paid } = figuresFor(person.id, line)
                  return (
                    <div key={person.id}>
                      <dt>
                        {person.name} · {t('com.sold', { n: count(quantity) })}
                        {modeOf(line) ? ` · ${currency(sales)}` : ''}
                      </dt>
                      <dd className="tabular">
                        <strong>{currency(amountFor(person.id, line))}</strong>
                      </dd>
                      {paid ? (
                        <p className={styles.blocked} style={{ gridColumn: '1 / -1', margin: 0 }}>
                          {t('com.alreadyPaid', { from: shortDate(paid.from), to: shortDate(paid.to) })}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </dl>
            </fieldset>
          ))}

          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setLines((current) => {
                // The next item not used yet, so a new line is not a repeat.
                const next =
                  items.find((option) => !current.some((entry) => lineItem(entry) === option.id))?.id ?? ''
                return [
                  ...current,
                  {
                    key: Math.max(...current.map((entry) => entry.key)) + 1,
                    item: next,
                    rate: '',
                    percent: isPercentItem(next),
                  },
                ]
              })
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
            {people.length > 1
              ? people.map((person) => (
                  <div key={person.id}>
                    <dt>{person.name}</dt>
                    <dd className="tabular">{currency(totalFor(person.id))}</dd>
                  </div>
                ))
              : null}
            <div>
              <dt>{t('com.total')}</dt>
              <dd className="tabular">
                <strong>{currency(total)}</strong>
              </dd>
            </div>
          </dl>

          {people.length > 0 && total === 0 && lines.every((line) => Number(line.rate) > 0) ? (
            <p className={styles.blocked}>{t('com.nothingSold')}</p>
          ) : null}
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
            change(addingFor, { item: created.id, percent: created.kind === 'AIRTIME_VOUCHER' })
            setAddingFor(null)
            reloadCategories()
          }}
        />
      ) : null}
    </div>
  )
}
