import { useEffect, useState, type AnchorHTMLAttributes, type ImgHTMLAttributes } from 'react'

import { getToken } from '../lib/api'

/**
 * Receipt slips are served only to someone signed in, and a plain <img> or
 * link cannot send the sign-in header. These fetch the file with it and hand
 * the element a local copy instead, so the token never goes into a URL.
 */
function useAuthorizedUrl(url: string | null | undefined) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let made: string | null = null
    const token = getToken()

    fetch(url, {
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob) return
        made = URL.createObjectURL(blob)
        setObjectUrl(made)
      })
      .catch(() => {
        // Left blank: the slip shows as missing rather than breaking the page.
      })

    return () => {
      controller.abort()
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])

  return url ? objectUrl : null
}

export function AuthImg({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const url = useAuthorizedUrl(src)
  return url ? <img src={url} alt={alt} {...rest} /> : <span aria-hidden="true" />
}

export function AuthLink({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const url = useAuthorizedUrl(href)
  return (
    <a href={url ?? undefined} aria-disabled={!url} {...rest}>
      {children}
    </a>
  )
}
