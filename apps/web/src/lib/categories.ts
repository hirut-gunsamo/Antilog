import { useEffect, useState } from 'react'

import { api } from './api'
import type { CategoryRow } from './types'

/** The Owner's categories, in the order they were made, and a way to re-read them. */
export function useCategories() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    api<{ categories: CategoryRow[] }>('/api/categories', { signal: controller.signal })
      .then((payload) => {
        setCategories(payload.categories ?? [])
        setLoaded(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true)
      })

    return () => controller.abort()
  }, [version])

  return { categories, loaded, reload: () => setVersion((n) => n + 1) }
}
