// Thin wrapper over fetch: attaches the token, unwraps JSON, and turns a
// non-2xx response into an Error carrying the server's own message so the UI
// can show what the API actually said.

const TOKEN_KEY = 'sim.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private windows and blocked site data both throw here.
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Not fatal: the session simply will not survive a reload.
  }
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** Thrown when the request never reached the server at all. */
export class OfflineError extends Error {
  constructor(message = 'No connection') {
    super(message)
    this.name = 'OfflineError'
  }
}

type Options = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /**
   * Marks this mutation so the server can recognise a replay of it. Set by the
   * offline queue when it drains; an ordinary online call leaves it unset and
   * behaves exactly as before.
   */
  mutationId?: string
  deviceId?: string
}

export async function api<T>(
  path: string,
  { method = 'GET', body, signal, mutationId, deviceId }: Options = {},
): Promise<T> {
  const token = getToken()

  let response: Response

  try {
    response = await fetch(path, {
      method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(mutationId ? { 'X-Client-Mutation-Id': mutationId } : {}),
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (caught) {
    // An aborted request is the caller's own doing, not a lost connection.
    if (signal?.aborted) throw caught

    // fetch only rejects when the request never completed — DNS, a dropped
    // connection, or the device being offline. Naming that separately is what
    // lets a caller decide to queue the work instead of failing.
    throw new OfflineError(
      caught instanceof Error ? caught.message : 'No connection',
    )
  }

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : null) ?? `Request failed (${response.status})`

    throw new ApiError(response.status, message, payload)
  }

  return payload as T
}

// Downloads a CSV report. The browser saves it rather than navigating, and the
// token still has to travel in the header, so it goes through fetch.
export async function downloadCsv(path: string, filename: string) {
  const token = getToken()

  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    throw new ApiError(response.status, 'Could not download the report', null)
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}

/**
 * Multipart upload. `api` sets a JSON content type and stringifies the body,
 * neither of which works for a file — the browser has to set the boundary
 * itself, so the header is deliberately omitted here.
 */
export async function upload<T>(
  path: string,
  form: FormData,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken()

  const response = await fetch(path, {
    method: 'POST',
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      (payload as { message?: string } | null)?.message ??
      'Could not upload the file'

    throw new ApiError(response.status, message, payload)
  }

  return payload as T
}
