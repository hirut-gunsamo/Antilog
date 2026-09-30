import { useState, type FormEvent } from 'react'

import { LANG_LABEL, LANGS, useT } from '../../lib/i18n'
import { api } from '../../lib/api'
import {
  CURRENCIES,
  DATE_FORMAT_LABEL,
  TIME_FORMAT_LABEL,
  useSettings,
} from '../../lib/settings'
import type { AppSettings, DateFormat, TimeFormat } from '../../lib/types'
import { Card, Empty } from '../Card'
import styles from '../../pages/Settings.module.css'

/**
 * The organisation's own settings, as opposed to the per-browser preferences
 * beside them. Only the Owner may save; everyone else sees the values
 * read-only, because they still decide what every screen shows.
 */
export function GeneralSettings(props: {
  canEdit: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const { settings, loading } = useSettings()
  const t = useT()

  if (loading) {
    return (
      <Card title={t('gen.title')}>
        <Empty>{t('gen.loading')}</Empty>
      </Card>
    )
  }

  // Keyed on the last write, so the draft is re-seeded from props after a save
  // or a reset rather than copied into state by an effect.
  return <GeneralForm key={settings.updatedAt} {...props} />
}

function GeneralForm({
  canEdit,
  onSaved,
  onError,
}: {
  canEdit: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const { settings, setSettings } = useSettings()
  const t = useT()

  const [draft, setDraft] = useState<AppSettings>(settings)
  const [busy, setBusy] = useState(false)

  const changed =
    draft.systemName !== settings.systemName ||
    draft.defaultLanguage !== settings.defaultLanguage ||
    draft.currency !== settings.currency ||
    draft.dateFormat !== settings.dateFormat ||
    draft.timeFormat !== settings.timeFormat ||
    draft.itemsPerPage !== settings.itemsPerPage ||
    draft.nationalIdOriginalRate !== settings.nationalIdOriginalRate ||
    draft.nationalIdCopyRate !== settings.nationalIdCopyRate ||
    draft.lowHoldingSim !== settings.lowHoldingSim ||
    draft.lowHoldingPhone !== settings.lowHoldingPhone ||
    draft.lowHoldingVoucher !== settings.lowHoldingVoucher

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!changed || busy || !canEdit) return

    setBusy(true)

    try {
      const payload = await api<{ settings: AppSettings }>('/api/settings', {
        method: 'PATCH',
        body: {
          systemName: draft.systemName.trim(),
          defaultLanguage: draft.defaultLanguage,
          currency: draft.currency,
          dateFormat: draft.dateFormat,
          timeFormat: draft.timeFormat,
          itemsPerPage: draft.itemsPerPage,
          nationalIdOriginalRate: Number(draft.nationalIdOriginalRate),
          nationalIdCopyRate: Number(draft.nationalIdCopyRate),
          lowHoldingSim: Number(draft.lowHoldingSim),
          lowHoldingPhone: Number(draft.lowHoldingPhone),
          lowHoldingVoucher: Number(draft.lowHoldingVoucher),
        },
      })

      setSettings(payload.settings)
      onSaved(t('gen.saved'))
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Could not save settings.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={t('gen.title')}
      subtitle={canEdit ? t('gen.noteOwner') : t('gen.noteOther')}
    >
      <form className={styles.form} onSubmit={save}>
        <label className={styles.field}>
          <span>{t('gen.systemName')}</span>
          <input
            value={draft.systemName}
            onChange={(event) =>
              setDraft({ ...draft, systemName: event.target.value })
            }
            maxLength={120}
            disabled={!canEdit}
            required
          />
        </label>

        <label className={styles.field}>
          <span>
            {t('gen.defaultLanguage')}<em>{t('gen.defaultLanguageNote')}</em>
          </span>
          <select
            value={draft.defaultLanguage}
            onChange={(event) =>
              setDraft({ ...draft, defaultLanguage: event.target.value })
            }
            disabled={!canEdit}
          >
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {LANG_LABEL[code]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>
            {t('gen.currency')}<em>{t('gen.currencyNote')}</em>
          </span>
          <select
            value={draft.currency}
            onChange={(event) =>
              setDraft({ ...draft, currency: event.target.value })
            }
            disabled={!canEdit}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>{t('gen.dateFormat')}</span>
          <select
            value={draft.dateFormat}
            onChange={(event) =>
              setDraft({
                ...draft,
                dateFormat: event.target.value as DateFormat,
              })
            }
            disabled={!canEdit}
          >
            {Object.entries(DATE_FORMAT_LABEL).map(([value, example]) => (
              <option key={value} value={value}>
                {example}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>{t('gen.timeFormat')}</span>
          <select
            value={draft.timeFormat}
            onChange={(event) =>
              setDraft({
                ...draft,
                timeFormat: event.target.value as TimeFormat,
              })
            }
            disabled={!canEdit}
          >
            {Object.entries(TIME_FORMAT_LABEL).map(([value, example]) => (
              <option key={value} value={value}>
                {example} ({t(value === '24h' ? 'gen.hour24' : 'gen.hour12')})
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>
            {t('set.rowsPerPage')}<em>{t('gen.rowsNote')}</em>
          </span>
          <input
            type="number"
            min="5"
            max="200"
            value={draft.itemsPerPage}
            onChange={(event) =>
              setDraft({ ...draft, itemsPerPage: Number(event.target.value) })
            }
            disabled={!canEdit}
          />
        </label>

        {/* When a seller is told to ask for more. Per category: five phones
            is a lot to be carrying, five vouchers is nearly nothing. */}
        <div className={styles.group}>
          <span className={styles.groupLabel}>{t('set.lowHolding')}</span>
          <p className={styles.hint}>{t('set.lowHoldingNote')}</p>

          <div className={styles.rateRow}>
            {(
              [
                ['lowHoldingSim', 'set.lowSim'],
                ['lowHoldingPhone', 'set.lowPhone'],
                ['lowHoldingVoucher', 'set.lowVoucher'],
              ] as const
            ).map(([key, labelKey]) => (
              <label key={key} className={styles.field}>
                <span>{t(labelKey)}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: Number(event.target.value) })
                  }
                  disabled={!canEdit}
                />
              </label>
            ))}
          </div>
        </div>

        {/* The rates National ID revenue is worked out from. A record keeps
            the rate it was saved with, so changing these is not retroactive. */}
        <div className={styles.group}>
          <span className={styles.groupLabel}>{t('nid.rates')}</span>
          <p className={styles.hint}>{t('nid.ratesNote')}</p>

          <div className={styles.rateRow}>
            <label className={styles.field}>
              <span>
                {t('nid.originalRate')}
                <em>{t('nid.perPrint')}</em>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.nationalIdOriginalRate}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    nationalIdOriginalRate: event.target.value,
                  })
                }
                disabled={!canEdit}
              />
            </label>

            <label className={styles.field}>
              <span>
                {t('nid.copyRate')}
                <em>{t('nid.perPrint')}</em>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.nationalIdCopyRate}
                onChange={(event) =>
                  setDraft({ ...draft, nationalIdCopyRate: event.target.value })
                }
                disabled={!canEdit}
              />
            </label>
          </div>
        </div>

        {settings.updatedBy ? (
          <p className={styles.hint}>
            {t('gen.lastChangedBy', { name: settings.updatedBy.name })}
          </p>
        ) : null}

        {canEdit ? (
          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.submit}
              disabled={!changed || busy}
            >
              {busy ? t('common.saving') : t('dlg.saveChanges')}
            </button>
          </div>
        ) : null}
      </form>
    </Card>
  )
}
