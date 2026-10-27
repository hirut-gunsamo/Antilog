import { useEffect, useState, type RefObject } from 'react'

/**
 * Filters every table on the open page by the search term, without each page
 * knowing about it: rows that do not match are marked and hidden by CSS. A
 * page that loads or re-renders its rows is filtered again as they arrive.
 * Returns how many body rows there are and how many still show.
 */
export function useTableFilter(root: RefObject<HTMLElement | null>, query: string) {
  const [counts, setCounts] = useState({ shown: 0, total: 0 })

  useEffect(() => {
    const element = root.current
    if (!element) return
    const term = query.trim().toLowerCase()

    function apply() {
      let shown = 0
      let total = 0
      element!.querySelectorAll('table tbody tr').forEach((row) => {
        total += 1
        const hit = term === '' || (row.textContent ?? '').toLowerCase().includes(term)
        if (hit) {
          shown += 1
          row.removeAttribute('data-search-hidden')
        } else {
          row.setAttribute('data-search-hidden', '')
        }
      })
      setCounts((current) =>
        current.shown === shown && current.total === total ? current : { shown, total },
      )
    }

    apply()

    // Only content changes are watched, so the marks set above never
    // retrigger it.
    let frame = 0
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    })
    observer.observe(element, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root, query])

  return counts
}
