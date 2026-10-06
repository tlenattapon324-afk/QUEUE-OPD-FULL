// Unified API layer — works in both Electron and Browser modes

const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI

const BASE = '/api'

// Patches window.fetch (once) so every request to /api/* — whether through fetchJSON below or a
// raw fetch() call scattered elsewhere in the app — automatically carries the API token the
// server injected into this page on load (window.__API_TOKEN__). This is what lets the browser
// UI keep working transparently once a token is configured, while a request replayed elsewhere
// (Postman, curl) without that token gets rejected by requireApiToken on the server.
if (typeof window !== 'undefined' && !(window as any).__fetchPatchedForApiToken__) {
  ;(window as any).__fetchPatchedForApiToken__ = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/api/') && window.__API_TOKEN__) {
      init = { ...init, headers: { ...(init?.headers || {}), 'X-API-Token': window.__API_TOKEN__ } }
    }
    return originalFetch(input, init)
  }
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || res.statusText)
  }
  return res.json()
}

// ─── WebSocket (Browser mode) ─────────────────────────────────────────────────
let _ws: WebSocket | null = null
const _wsListeners: Set<(data: { queueNo: string; servicePoint: string; audioUrl?: string | null; displayConfigId?: string | null }) => void> = new Set()
const _configListeners: Set<(config: unknown) => void> = new Set()
const _statusListeners: Set<(data: { vn: string; status: string; queueNo?: string; servicePoint?: string }) => void> = new Set()
const _audioListeners: Set<(data: { audioUrl: string; displayConfigId?: string | null; servicePoint?: string; queueNo?: string }) => void> = new Set()
const _clearListeners: Set<(data: { displayConfigId: string | null }) => void> = new Set()

let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let _wsPingInterval: ReturnType<typeof setInterval> | null = null

function hasActiveListeners() {
  return _wsListeners.size > 0 || _audioListeners.size > 0 ||
    _configListeners.size > 0 || _statusListeners.size > 0 || _clearListeners.size > 0
}

function getWS(): WebSocket {
  // Reuse if already open OR still connecting — prevents duplicate connections
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return _ws
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}`)
  _ws = ws

  // Heartbeat: send ping every 25s to prevent Android/router idle timeout (~30s)
  if (_wsPingInterval) clearInterval(_wsPingInterval)
  _wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
  }, 25000)

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'queue:called') {
        _wsListeners.forEach(cb => cb(msg.data))
      } else if (msg.type === 'queue:audio') {
        _audioListeners.forEach(cb => cb(msg.data))
      } else if (msg.type === 'display:config') {
        _configListeners.forEach(cb => cb(msg.data))
      } else if (msg.type === 'queue:status') {
        _statusListeners.forEach(cb => cb(msg.data))
      } else if (msg.type === 'queue:clear') {
        _clearListeners.forEach(cb => cb(msg.data))
      }
    } catch {}
  }

  ws.onclose = () => {
    if (_wsPingInterval) { clearInterval(_wsPingInterval); _wsPingInterval = null }
    if (_ws !== ws) return
    _ws = null
    // Auto-reconnect if any listener is still active
    if (hasActiveListeners()) {
      if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer)
      _wsReconnectTimer = setTimeout(() => { _wsReconnectTimer = null; getWS() }, 3000)
    }
  }

  ws.onerror = () => ws.close()

  return ws
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<DbSettings | null> {
  if (isElectron()) return window.electronAPI.loadSettings()
  return fetchJSON<DbSettings | null>('/settings')
}

export async function saveSettings(s: DbSettings): Promise<{ success: boolean }> {
  if (isElectron()) return window.electronAPI.saveSettings(s)
  return fetchJSON('/settings', { method: 'POST', body: JSON.stringify(s) })
}

// ─── Database ────────────────────────────────────────────────────────────────

export async function testConnection(s: DbSettings): Promise<{ success: boolean; message: string }> {
  if (isElectron()) return window.electronAPI.testConnection(s)
  return fetchJSON('/db/test', { method: 'POST', body: JSON.stringify(s) })
}

export async function checkQueueOpdQsSlotTable(
  s: DbSettings
): Promise<{ success: boolean; exists?: boolean; message?: string }> {
  return fetchJSON('/db/table/queue-opd-qs-slot/check', { method: 'POST', body: JSON.stringify(s) })
}

export async function createQueueOpdQsSlotTable(
  s: DbSettings
): Promise<{ success: boolean; exists?: boolean; message?: string }> {
  return fetchJSON('/db/table/queue-opd-qs-slot/create', { method: 'POST', body: JSON.stringify(s) })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(
  u: string, p: string
): Promise<{ success: boolean; message?: string; username?: string }> {
  if (isElectron()) return window.electronAPI.login(u, p)
  return fetchJSON('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export async function getQueueList(
  mode: 'slot' | 'opd' | 'cur_dep' | 'slot_cur' = 'slot'
): Promise<{ success: boolean; data: QueueItem[]; message?: string }> {
  if (isElectron()) return window.electronAPI.getQueueList()
  return fetchJSON(`/queue/list?mode=${mode}`)
}

export async function getAppointmentDoctors(): Promise<
  { success: boolean; data: Array<{ department: string; doctor_name: string }>; message?: string }
> {
  if (isElectron()) return { success: true, data: [] }
  return fetchJSON('/queue/appointment-doctors')
}

export async function callQueue(
  identifier: string, servicePoint: string, mode: 'slot' | 'opd' | 'cur_dep' | 'slot_cur' = 'slot', displayConfigId?: string
): Promise<{ success: boolean; message?: string; queueNo?: string; queueSlot?: number }> {
  if (isElectron()) return window.electronAPI.callQueue(identifier, servicePoint)
  return fetchJSON('/queue/call', { method: 'POST', body: JSON.stringify({ identifier, servicePoint, mode, displayConfigId }) })
}

export function prewarmTTS(
  queues: Array<{ no: string; name?: string }>,
  servicePoints: string | string[],
  displayConfigId: string
): void {
  if (isElectron()) return
  const spList = Array.isArray(servicePoints) ? servicePoints : [servicePoints]
  fetch('/api/tts/prewarm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queues, servicePoints: spList, displayConfigId }),
  }).catch(() => {})
}

export interface LabXrayStatus {
  lab_receive?: string | null
  confirm_report?: string | null
  xray_confirm?: string | null
  xray_confirm_radiology?: string | null
}

export async function getLabXray(): Promise<Record<string, LabXrayStatus>> {
  if (isElectron()) return {}
  try {
    const res = await fetchJSON('/queue/lab-xray') as { success: boolean; data: Record<string, LabXrayStatus> }
    return res.success ? res.data : {}
  } catch { return {} }
}

export async function updateQueueStatus(
  vn: string, status: string, extra?: { queueNo?: string; queueSlot?: string | null; servicePoint?: string }
): Promise<{ success: boolean }> {
  if (isElectron()) return window.electronAPI.updateQueueStatus(vn, status)
  return fetchJSON('/queue/status', { method: 'POST', body: JSON.stringify({ vn, status, ...extra }) })
}

export interface CallEntry {
  vn: string
  status: string
  servicePoint: string
  calledAt: string
  queueNo: string
  department?: string
}

export async function getCallsToday(mode?: string): Promise<CallEntry[]> {
  if (isElectron()) return []
  try {
    const qs = mode ? `?mode=${mode}` : ''
    return await fetchJSON<CallEntry[]>(`/queue/calls-today${qs}`)
  } catch {
    return []
  }
}

export async function getQDDefaultConfig(): Promise<Record<string, unknown> | null> {
  try {
    return await fetchJSON<Record<string, unknown> | null>('/display/qd-default')
  } catch {
    return null
  }
}

export async function saveQDDefaultConfig(cfg: unknown): Promise<{ success: boolean }> {
  return fetchJSON('/display/qd-default', { method: 'POST', body: JSON.stringify(cfg) })
}

export async function getDisplayQDConfig(displayId: string): Promise<Record<string, unknown> | null> {
  try {
    return await fetchJSON<Record<string, unknown> | null>(`/display/qd-config/${displayId}`)
  } catch {
    return null
  }
}

export async function saveDisplayQDConfig(displayId: string, cfg: unknown): Promise<{ success: boolean }> {
  return fetchJSON(`/display/qd-config/${displayId}`, { method: 'POST', body: JSON.stringify(cfg) })
}

export async function getTTSVoices(): Promise<string[]> {
  try { return await fetchJSON<string[]>('/tts/voices') } catch { return [] }
}

export async function previewServerTTS(text: string, voiceName: string, rate: number): Promise<{ url: string | null; error?: string }> {
  try {
    const r = await fetchJSON<{ success: boolean; audioUrl?: string; message?: string }>('/tts/preview', {
      method: 'POST',
      body: JSON.stringify({ text, voiceName, rate })
    })
    if (r.success && r.audioUrl) return { url: r.audioUrl }
    return { url: null, error: r.message || 'server error' }
  } catch (e: unknown) {
    return { url: null, error: e instanceof Error ? e.message : 'unknown error' }
  }
}

export function onQueueCalled(
  cb: (data: { queueNo: string; servicePoint: string; audioUrl?: string | null; displayConfigId?: string | null; department?: string }) => void
): () => void {
  if (isElectron()) return window.electronAPI.onQueueCalled(cb)
  if (typeof window !== 'undefined') getWS()
  _wsListeners.add(cb)
  return () => _wsListeners.delete(cb)
}

// ─── Service Points ───────────────────────────────────────────────────────────

export async function getServicePoints(): Promise<ServicePoint[]> {
  if (isElectron()) return (window.electronAPI as any).getServicePoints?.() ?? []
  return fetchJSON<ServicePoint[]>('/service-points')
}

export async function createServicePoint(name: string): Promise<{ success: boolean; data?: ServicePoint }> {
  if (isElectron()) return (window.electronAPI as any).createServicePoint?.(name) ?? { success: false }
  return fetchJSON('/service-points', { method: 'POST', body: JSON.stringify({ name }) })
}

export async function updateServicePoint(id: string, name: string): Promise<{ success: boolean }> {
  if (isElectron()) return (window.electronAPI as any).updateServicePoint?.(id, name) ?? { success: false }
  return fetchJSON(`/service-points/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
}

export async function deleteServicePoint(id: string): Promise<{ success: boolean }> {
  if (isElectron()) return (window.electronAPI as any).deleteServicePoint?.(id) ?? { success: false }
  return fetchJSON(`/service-points/${id}`, { method: 'DELETE' })
}

// ─── Display ──────────────────────────────────────────────────────────────────

export async function openDisplay(config: DisplayConfig): Promise<void> {
  if (isElectron()) return window.electronAPI.openDisplay(config)
  const id = (config as DisplayConfigItem).id
  const url = id ? `/#/display?id=${id}` : '/#/display'
  window.open(url, '_blank', 'noopener')
}

export async function getDisplayConfigById(id: string): Promise<DisplayConfigItem | null> {
  try { return await fetchJSON<DisplayConfigItem>(`/display/configs/${id}`) } catch { return null }
}

export async function updateDisplayConfig(config: DisplayConfig): Promise<void> {
  if (isElectron()) return window.electronAPI.updateDisplayConfig(config)
  return fetchJSON('/display/config', { method: 'POST', body: JSON.stringify(config) })
}

export function onDisplayConfig(cb: (config: unknown) => void): () => void {
  if (isElectron()) return window.electronAPI.onDisplayConfig(cb)
  if (typeof window !== 'undefined') getWS()
  _configListeners.add(cb)
  return () => _configListeners.delete(cb)
}

export function onQueueAudio(
  cb: (data: { audioUrl: string; displayConfigId?: string | null; servicePoint?: string; queueNo?: string }) => void
): () => void {
  if (typeof window !== 'undefined') getWS()
  _audioListeners.add(cb)
  return () => _audioListeners.delete(cb)
}

export async function clearDisplayQueues(displayConfigId?: string): Promise<{ success: boolean }> {
  return fetchJSON('/display/clear', { method: 'POST', body: JSON.stringify({ displayConfigId: displayConfigId || null }) })
}

export function onQueueClear(
  cb: (data: { displayConfigId: string | null }) => void
): () => void {
  if (typeof window !== 'undefined') getWS()
  _clearListeners.add(cb)
  return () => _clearListeners.delete(cb)
}

export function onQueueStatusChanged(
  cb: (data: { vn: string; status: string; queueNo?: string; servicePoint?: string }) => void
): () => void {
  if (isElectron()) return () => {}
  if (typeof window !== 'undefined') getWS()
  _statusListeners.add(cb)
  return () => _statusListeners.delete(cb)
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

export async function getSystemFonts(): Promise<string[]> {
  if (isElectron()) return window.electronAPI.getSystemFonts()
  return fetchJSON<string[]>('/system/fonts')
}

// ─── Display configs CRUD ─────────────────────────────────────────────────────

export async function getDisplayConfigs(): Promise<DisplayConfigItem[]> {
  if (isElectron()) return window.electronAPI.getDisplayConfigs()
  return fetchJSON<DisplayConfigItem[]>('/display/configs')
}

export async function createDisplayConfig(
  cfg: Omit<DisplayConfigItem, 'id'>
): Promise<{ success: boolean; data?: DisplayConfigItem }> {
  if (isElectron()) return window.electronAPI.createDisplayConfig(cfg)
  return fetchJSON('/display/configs', { method: 'POST', body: JSON.stringify(cfg) })
}

export async function updateDisplayConfigItem(
  id: string, cfg: DisplayConfigItem
): Promise<{ success: boolean }> {
  if (isElectron()) return window.electronAPI.updateDisplayConfigItem(id, cfg)
  return fetchJSON(`/display/configs/${id}`, { method: 'PUT', body: JSON.stringify(cfg) })
}

export async function deleteDisplayConfig(id: string): Promise<{ success: boolean }> {
  if (isElectron()) return window.electronAPI.deleteDisplayConfig(id)
  return fetchJSON(`/display/configs/${id}`, { method: 'DELETE' })
}


// ─── Queue staging board ────────────────────────────────────────────────────────

export type QueueStagingMap = Record<string, Record<string, string[]>>

export async function getQueueStaging(): Promise<QueueStagingMap> {
  return fetchJSON<QueueStagingMap>('/queue-staging')
}

export async function moveQueuesToStaging(
  displayId: string, channel: string | null, keys: string[]
): Promise<{ success: boolean }> {
  return fetchJSON('/queue-staging/move', { method: 'POST', body: JSON.stringify({ displayId, channel, keys }) })
}
