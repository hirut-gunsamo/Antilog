import { useEffect, useState } from 'react'

import { api } from './api'
import type { BranchRow } from './types'

/**
 * Every branch the viewer may see, as [id, name] pairs.
 *
 * Branch filters used to be built only from the rows on screen, so a new
 * branch never appeared in them until it had a sale, a request or stock. The
 * pages merge this in so it shows the moment it is created. The API scopes
 * the list to the viewer's own branch for everyone but the Owner.
 */
export function useBranchList(): [string, string][] {
  const [branches, setBranches] = useState<[string, string][]>([])

  useEffect(() => {
    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', { signal: controller.signal })
      .then((payload) =>
        setBranches(
          (payload.branches ?? []).map((row): [string, string] => [row.id, row.name]),
        ),
      )
      .catch(() => {
        // The filter falls back to the branches seen in the rows.
      })

    return () => controller.abort()
  }, [])

  return branches
}
