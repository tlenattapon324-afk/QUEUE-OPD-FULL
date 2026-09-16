// BMS session cookie + URL helpers — see BMS-SESSION-SPECIFICATION.md

const COOKIE_NAME = 'bms-session-id'
const COOKIE_DAYS = 7

export function setSessionCookie(sessionId: string) {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString()
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; expires=${expires}; path=/; SameSite=Lax${secure}`
}

export function getSessionCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function removeSessionCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

// Reads ?bms-session-id=... from either a plain query string or from after the
// HashRouter's hash (#/login?bms-session-id=...) — an external HOSxP link has no
// way to know this app routes via hash.
export function getSessionFromUrl(): string | null {
  const search = new URLSearchParams(window.location.search)
  const fromSearch = search.get('bms-session-id')
  if (fromSearch) return fromSearch
  const hashQuery = window.location.hash.split('?')[1]
  if (hashQuery) return new URLSearchParams(hashQuery).get('bms-session-id')
  return null
}

export function removeSessionFromUrl() {
  const url = new URL(window.location.href)
  if (url.searchParams.has('bms-session-id')) {
    url.searchParams.delete('bms-session-id')
    window.history.replaceState({}, '', url.toString())
  }
  const [hashPath, hashQuery] = window.location.hash.slice(1).split('?')
  if (hashQuery) {
    const params = new URLSearchParams(hashQuery)
    params.delete('bms-session-id')
    const rest = params.toString()
    window.location.hash = rest ? `${hashPath}?${rest}` : hashPath
  }
}

// Combined flow: extract from URL -> store in cookie -> clean URL.
export function handleUrlSession(): string | null {
  const sessionId = getSessionFromUrl()
  if (sessionId) {
    setSessionCookie(sessionId)
    removeSessionFromUrl()
  }
  return sessionId
}
