import { useEffect, useState } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { permissionText } from '../../lib/permissions'
import type { PermissionModule } from '../../lib/types'
import { Card, Empty } from '../Card'
import styles from '../../pages/Settings.module.css'

/**
 * Who can do what, per module.
 *
 * Read-only, and the card says why: access is enforced by route guards on the
 * server. Making this editable would mean every guard consulting the database
 * on every request — a security-critical change that deserves its own design
 * pass rather than a grid of checkboxes.
 */
export function PermissionMatrix() {
  const t = useT()
  const [modules, setModules] = useState<PermissionModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    api<{ permissions: PermissionModule[] }>('/api/settings/permissions', {
      signal: controller.signal,
    })
      .then((payload) => setModules(payload.permissions ?? []))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not load permissions.',
        )
      })

    return () => controller.abort()
  }, [])

  return (
    <Card
      title={t('perm.title')}
      subtitle={t('perm.note')}
    >
      {error ? (
        <Empty>{error}</Empty>
      ) : !modules ? (
        <Empty>{t('perm.loading')}</Empty>
      ) : (
        <>
          <div className={styles.matrixScroll}>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th scope="col">{t('perm.action')}</th>
                  <th scope="col">{t('role.OWNER')}</th>
                  <th scope="col">{t('role.SUPERVISOR')}</th>
                  <th scope="col">{t('role.SALES')}</th>
                </tr>
              </thead>

              {modules.map((entry) => (
                <tbody key={entry.module}>
                  <tr className={styles.matrixGroup}>
                    <th colSpan={4} scope="colgroup">
                      {permissionText(t, entry.module)}
                    </th>
                  </tr>

                  {entry.abilities.map((ability) => (
                    <tr key={`${entry.module}-${ability.action}`}>
                      <td>
                        {permissionText(t, ability.action)}
                        {ability.note ? (
                          <span className={styles.matrixNote}>
                            {permissionText(t, ability.note)}
                          </span>
                        ) : null}
                      </td>
                      {([ability.owner, ability.supervisor, ability.sales] as const).map(
                        (allowed, index) => (
                          <td
                            key={index}
                            className={styles.matrixCell}
                            data-allowed={allowed}
                          >
                            <span aria-label={t(allowed ? 'perm.allowed' : 'perm.notAllowed')}>
                              {allowed ? '✓' : '—'}
                            </span>
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <p className={styles.hint}>
            {t('perm.footer')}
          </p>
        </>
      )}
    </Card>
  )
}
