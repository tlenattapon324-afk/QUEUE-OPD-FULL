/// <reference types="vite/client" />

interface DbSettings {
  type: 'mysql' | 'postgresql'
  host: string
  port: number
  database: string
  username: string
  password: string
  hospitalCode?: string
  apiToken?: string
}

interface QueueItem {
  vn: string
  hn: string
  queue_no: string
  queue_slot: string | null
  queue_name: string
  queue_type?: string
  insurance: string
  department: string
  slot_doctor_name?: string | null
  visit_type: string
  doctor_name?: string | null
  clinic_name?: string | null
  ist_name?: string | null
  ost_name?: string | null
  vstdate: string
  vsttime: string
  sign_datetime?: string | null
  sign_time?: string | null
  service_point: string
  status: string
  lab_receive?: string | null
  confirm_report?: string | null
  xray_confirm?: string | null
  xray_confirm_radiology?: string | null
}

interface ServicePoint {
  id: string
  name: string
}

interface DisplayConfig {
  bgColor: string
  textColor: string
  queueColor: string
  font: string
  fontSize: number
  title: string
  showClock: boolean
  subTitle?: string
  queueBgColor?: string
  showHistory?: boolean
  animationType?: 'fade' | 'slide' | 'scale' | 'bounce'
  soundEnabled?: boolean
}

interface DisplayConfigItem extends DisplayConfig {
  id: string
  name: string
  channels?: string[]
  filterDepts?: string[]
}

// Document Picture-in-Picture API — not yet in lib.dom.d.ts. Chromium 116+ (Chrome/Edge) only.
interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
  readonly window: Window | null
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture
  // Injected server-side into the served index.html — see requireApiToken in server/index.js.
  __API_TOKEN__?: string
  electronAPI: {
    loadSettings: () => Promise<DbSettings | null>
    saveSettings: (s: DbSettings) => Promise<{ success: boolean }>
    testConnection: (s: DbSettings) => Promise<{ success: boolean; message: string }>
    login: (u: string, p: string) => Promise<{ success: boolean; message?: string; username?: string }>
    getQueueList: () => Promise<{ success: boolean; data: QueueItem[]; message?: string }>
    callQueue: (identifier: string, servicePoint: string) => Promise<{ success: boolean; message?: string; queueNo?: string; queueSlot?: number }>
    updateQueueStatus: (vn: string, status: string) => Promise<{ success: boolean }>
    onQueueCalled: (cb: (d: { queueNo: string; servicePoint: string }) => void) => () => void
    minimizeMiniWindow: () => Promise<void>
    restoreMiniWindow: () => Promise<void>
    openDisplay: (config: DisplayConfig) => Promise<void>
    updateDisplayConfig: (config: DisplayConfig) => Promise<void>
    onDisplayConfig: (cb: (config: unknown) => void) => () => void
    getSystemFonts: () => Promise<string[]>
    getDisplayConfigs: () => Promise<DisplayConfigItem[]>
    createDisplayConfig: (cfg: Omit<DisplayConfigItem, 'id'>) => Promise<{ success: boolean; data?: DisplayConfigItem }>
    updateDisplayConfigItem: (id: string, cfg: DisplayConfigItem) => Promise<{ success: boolean }>
    deleteDisplayConfig: (id: string) => Promise<{ success: boolean }>
  }
}
