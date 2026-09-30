import { useCallback, useRef, useState } from 'react'

// Kept out of Toasts.tsx so that file only exports components, which is what
// React Fast Refresh needs to hot-reload it cleanly.

// 'info' is for news rather than the result of something the person did.
export type ToastKind = 'success' | 'error' | 'info'

export type Toast = {
  id: number
  kind: ToastKind
  text: string
  /** Makes the toast a link to where the thing can be dealt with. */
  href?: string
}

/** Owns the toast list. The page pushes; <Toasts /> renders. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, text: string, href?: string) => {
    const id = nextId.current
    nextId.current += 1

    setToasts((current) => [...current, { id, kind, text, href }])
  }, [])

  return { toasts, push, dismiss }
}
