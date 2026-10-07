import { useState, useEffect, useRef } from 'react'
import {
  onDisplayConfig, onQueueCalled, onQueueStatusChanged, onQueueAudio, onQueueClear, updateDisplayConfig,
  getSystemFonts, getServicePoints, getCallsToday, getQueueList,
  getQDDefaultConfig, saveQDDefaultConfig, getTTSVoices, getDisplayConfigById,
  getDisplayQDConfig, saveDisplayQDConfig, previewServerTTS, prewarmTTS,
  type CallEntry
} from '../lib/api'
import './QueueDisplay.css'

interface QDConfig {
  title: string
  // Layout variant
  layout: 'table' | 'callboard'
  showUpcoming: boolean
  upcomingCount: number
  cbFontSize1: number // ขนาดตัวอักษร ส่วนที่ 1 (บล็อกคิวปัจจุบัน)
  cbFontSize2: number // ขนาดตัวอักษร ส่วนที่ 2 (ช่องบริการ)
  cbBg1: string // สีพื้นหลัง ส่วนที่ 1
  cbBg2: string // สีพื้นหลัง ส่วนที่ 2
  cbSpFontSize2: number // ขนาดตัวอักษรกล่อง "ช่อง" ในส่วนที่ 2 (แยกจาก spFontSize ของจอตาราง)
  cbHeader1: string // หัวคอลัมน์ ส่วนที่ 1 (พิมพ์ข้อความเองได้)
  cbLeftSize: number // % ความกว้างของส่วนที่ 1 (ที่เหลือเป็นของส่วนที่ 2) ปรับให้สอดคล้องกับจำนวนคอลัมน์ส่วนที่ 2
  cbSpLabelFontSize: number // ขนาดตัวอักษรป้าย "ช่อง X" ในส่วนที่ 1
  cbHeaderFontSize: number // ขนาดตัวอักษรหัวคอลัมน์ (ส่วนที่ 1 และส่วนที่ 2 ใช้ร่วมกัน — ต้องอยู่ระดับเดียวกัน)
  cbHeaderHeight: number // ความสูงหัวคอลัมน์ (ส่วนที่ 1 และส่วนที่ 2 ใช้ร่วมกัน)
  upcomingQueueMode: 'slot' | 'opd' | 'cur_dep' | 'slot_cur' // ประเภทคิวที่ใช้ดึงรายการคิวถัดไป (ส่วนที่ 4)
  // Header
  headerBg: string
  headerTextColor: string
  showClock: boolean
  clockColor: string
  soundEnabled: boolean
  // Table columns
  colSpHeader: string
  colQueueHeader: string
  tableHeaderBg: string
  tableHeaderColor: string
  spColumnBg: string
  spColumnColor: string
  spHeaderBg: string
  spHeaderColor: string
  showNoShowPanel: boolean
  noShowItemHeight: number
  queueBg: string
  queueColor: string
  spDisplayNames: Record<string, string>
  spFontSize: number
  spColumnWidth: number
  spColumnVisible: boolean
  borderColor: string
  borderWidth: number
  footerHeight: number
  // Right panel
  rightPanelBg: string
  rightPanelHeaderBg: string
  rightPanelHeaderColor: string
  rightPanelLabel: string
  rightPanelQueueColor: string
  rightPanelWidth: number
  rightPanelFontSize: number
  rightPanelMaxItems: number
  // Font / animation
  font: string
  fontSize: number
  animationType: 'fade' | 'slide' | 'scale' | 'bounce'
  // Blink on call
  blinkEnabled: boolean
  blinkColor: string
  blinkTarget: 'bg' | 'text'
  blinkCount: number
  blinkSpeed: number
  // Footer
  showFooter: boolean
  marqueeText: string
  footerBg: string
  footerTextColor: string
  footerFontSize: number
  footerScrollSpeed: number
  // Visibility & station config
  hiddenSPs: string[]
  displayStation: string
  filterDepts: string[]
  // Multi-column layout
  numColumns: number
  spColumns: Record<string, number>
  spRows: Record<string, number>
  // Display identity (set from URL ?id=)
  displayConfigId: string
  displayConfigName: string
  displayChannels: string[]
  // TTS (Text-to-Speech)
  ttsEnabled: boolean
  ttsSource: 'browser' | 'server'
  ttsPrefix1: string
  ttsMiddle: string
  ttsSuffix: string
  ttsVoiceName: string       // browser voice
  ttsServerVoiceName: string // Windows SAPI voice (server mode)
  ttsRate: number
  ttsPitch: number
  ttsVolume: number
  ttsShowName: boolean
  maskLastName: boolean
}

const DEFAULT: QDConfig = {
  title: 'ระบบคิวผู้ป่วยนอก',
  layout: 'table',
  showUpcoming: false,
  upcomingCount: 5,
  cbFontSize1: 10,
  cbFontSize2: 4.5,
  cbBg1: '#ffffff',
  cbBg2: '#ffffff',
  cbSpFontSize2: 1.6,
  cbHeader1: 'คิวที่กำลังเรียก',
  cbLeftSize: 57,
  cbSpLabelFontSize: 1.4,
  cbHeaderFontSize: 20,
  cbHeaderHeight: 48,
  upcomingQueueMode: 'slot',
  headerBg: '#1a237e',
  headerTextColor: '#ffffff',
  showClock: true,
  clockColor: '#ffd54f',
  soundEnabled: false,
  colSpHeader: 'ช่องบริการ',
  colQueueHeader: 'หมายเลขที่เรียกเข้าบริการ',
  tableHeaderBg: '#2e7d32',
  tableHeaderColor: '#ffffff',
  spColumnBg: '#f8f9fa',
  spColumnColor: '#1a1a2e',
  spHeaderBg: '#1a237e',
  spHeaderColor: '#ffffff',
  showNoShowPanel: true,
  noShowItemHeight: 80,
  queueBg: '#ffffff',
  queueColor: '#1565c0',
  spDisplayNames: {},
  spFontSize: 6,
  spColumnWidth: 220,
  spColumnVisible: true,
  borderColor: '#bbbbbb',
  borderWidth: 2,
  footerHeight: 46,
  rightPanelBg: '#1a0000',
  rightPanelHeaderBg: '#7f0000',
  rightPanelHeaderColor: '#ffffff',
  rightPanelLabel: 'เรียกแล้วไม่มา',
  rightPanelQueueColor: '#ff6b6b',
  rightPanelWidth: 260,
  rightPanelFontSize: 8,
  rightPanelMaxItems: 10,
  font: 'Sarabun',
  fontSize: 8,
  animationType: 'scale',
  blinkEnabled: true,
  blinkColor: '#ffeb3b',
  blinkTarget: 'bg',
  blinkCount: 6,
  blinkSpeed: 300,
  showFooter: true,
  marqueeText: 'ยินดีต้อนรับสู่ระบบคิว | Welcome to Queue System | กรุณานั่งรอเรียกหมายเลขคิว',
  footerBg: '#1565c0',
  footerTextColor: '#ffffff',
  footerFontSize: 20,
  footerScrollSpeed: 30,
  hiddenSPs: [],
  displayStation: '',
  filterDepts: [],
  numColumns: 1,
  spColumns: {},
  spRows: {},
  displayConfigId: '',
  displayConfigName: '',
  displayChannels: [],
  ttsEnabled: false,
  ttsSource: 'browser',
  ttsPrefix1: 'ขอเชิญลำดับ',
  ttsMiddle: 'ที่โต๊ะซักประวัติหมายเลข',
  ttsSuffix: 'ค่ะ',
  ttsVoiceName: '',
  ttsServerVoiceName: '',
  ttsRate: 0.9,
  ttsPitch: 1.1,
  ttsVolume: 1.0,
  ttsShowName: false,
  maskLastName: false,
}

// Read display config ID from URL hash: /#/display?id=XXX
function getDisplayIdFromURL(): string {
  try {
    const hash = window.location.hash // e.g. "#/display?id=12345"
    const qIdx = hash.indexOf('?')
    if (qIdx === -1) return ''
    return new URLSearchParams(hash.slice(qIdx + 1)).get('id') || ''
  } catch { return '' }
}

const URL_DISPLAY_ID = getDisplayIdFromURL()
const STORAGE_KEY = URL_DISPLAY_ID ? `qd-config-${URL_DISPLAY_ID}` : 'qd-config'

function fixConfig(merged: Record<string, unknown>): QDConfig {
  // strip undefined so DEFAULT values are used for missing/undefined keys
  const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null))
  const result = { ...DEFAULT, ...clean } as QDConfig
  if (result.fontSize > 20) result.fontSize = DEFAULT.fontSize
  if (!Array.isArray(result.hiddenSPs)) result.hiddenSPs = []
  if (typeof result.spDisplayNames !== 'object' || Array.isArray(result.spDisplayNames))
    result.spDisplayNames = {}
  if (typeof result.numColumns !== 'number' || result.numColumns < 1) result.numColumns = 1
  if (typeof result.spColumns !== 'object' || Array.isArray(result.spColumns)) result.spColumns = {}
  if (typeof result.spRows !== 'object' || Array.isArray(result.spRows)) result.spRows = {}
  if (result.layout !== 'table' && result.layout !== 'callboard') result.layout = 'table'
  if (typeof result.upcomingCount !== 'number' || result.upcomingCount < 1) result.upcomingCount = DEFAULT.upcomingCount
  if (typeof result.cbFontSize1 !== 'number' || result.cbFontSize1 <= 0) result.cbFontSize1 = DEFAULT.cbFontSize1
  if (typeof result.cbFontSize2 !== 'number' || result.cbFontSize2 <= 0) result.cbFontSize2 = DEFAULT.cbFontSize2
  if (typeof result.cbBg1 !== 'string' || !result.cbBg1) result.cbBg1 = DEFAULT.cbBg1
  if (typeof result.cbBg2 !== 'string' || !result.cbBg2) result.cbBg2 = DEFAULT.cbBg2
  if (typeof result.cbSpFontSize2 !== 'number' || result.cbSpFontSize2 <= 0) result.cbSpFontSize2 = DEFAULT.cbSpFontSize2
  if (typeof result.cbLeftSize !== 'number' || result.cbLeftSize < 20 || result.cbLeftSize > 80) result.cbLeftSize = DEFAULT.cbLeftSize
  if (typeof result.cbSpLabelFontSize !== 'number' || result.cbSpLabelFontSize <= 0) result.cbSpLabelFontSize = DEFAULT.cbSpLabelFontSize
  if (typeof result.cbHeaderFontSize !== 'number' || result.cbHeaderFontSize <= 0) result.cbHeaderFontSize = DEFAULT.cbHeaderFontSize
  if (typeof result.cbHeaderHeight !== 'number' || result.cbHeaderHeight <= 0) result.cbHeaderHeight = DEFAULT.cbHeaderHeight
  if (typeof result.cbHeader1 !== 'string') result.cbHeader1 = DEFAULT.cbHeader1
  if (!['slot', 'opd', 'cur_dep', 'slot_cur'].includes(result.upcomingQueueMode)) result.upcomingQueueMode = DEFAULT.upcomingQueueMode
  return result
}

function extractBadge(queueNo: string): string | null {
  const m = queueNo.match(/^([A-Za-ก-ฮ]+)/)
  return m ? m[1].toUpperCase() : null
}

// ปิด 4 ตัวท้ายนามสกุล → แสดงเป็น XXXX
function maskName(fullName: string): string {
  if (!fullName) return ''
  const spaceIdx = fullName.lastIndexOf(' ')
  if (spaceIdx === -1) return fullName // ไม่มีนามสกุล
  const firstName = fullName.slice(0, spaceIdx)
  const lastName = fullName.slice(spaceIdx + 1)
  // แทนที่ 4 ตัวท้าย (หรือทั้งหมดถ้าสั้นกว่า 4) ด้วย XXXX
  const visible = lastName.length > 4 ? lastName.slice(0, lastName.length - 4) : ''
  return `${firstName} ${visible}XXXX`
}

// สำหรับ TTS: ใช้ชื่อเต็ม (fname + lname) ตามที่ตั้งค่าในจอแสดงผล
// fullName = concat(fname, ' ', lname) เช่น "วิลาวัณย์ บุญลี"
function nameForTTS(fullName: string): string {
  return fullName || ''
}

// The global service-points fallback (server/index.js loadServicePoints default) names channels
// "ช่อง 1".."ช่อง 6", while a display's OWN dedicated channels (config.displayChannels) are bare
// "1".."9". A call placed without picking this display in QueueCall falls back to that global list,
// so servicePoint arrives as "ช่อง 1" — never matching this display's bare channel id, and duplicating
// the word "ช่อง"/ttsMiddle's own wording in both the on-screen badge and the TTS announcement.
// Stripping a leading "ช่อง" here (once, at the point every WS event is consumed) normalizes both.
function normalizeSpId(sp: string): string {
  if (!sp) return sp
  return sp.replace(/^ช่อง\s*/, '').trim()
}

// Callboard layout: shrink font size for longer queue codes so they don't overflow
// their (narrower, screen-shared) box — unlike the table layout's full-width cell.
function fitQueueFontSize(text: string, baseVw: number): number {
  const len = text.length || 1
  return len <= 3 ? baseVw : Math.max(baseVw * (3 / len), baseVw * 0.45)
}

// Callboard "upcoming" list (ส่วนที่ 4): scope to the selected room(s), falling back to the
// department of whatever was last called if none is explicitly selected — otherwise every
// department's oqueue sequence gets merged into one ranking and a department with naturally
// low numbers (e.g. pharmacy starting at 1) permanently outranks the room being worked right
// now. For opd/cur_dep modes, sort by ovst.oqueue (numeric) — matching the queue-call page —
// not by arrival time, and without grouping by department first (which is what pins a
// department-less queue to the top forever).
function computeUpcomingQueues(cfg: QDConfig, data: QueueItem[], lastCalledDept: string | undefined): QueueItem[] {
  const scopeDepts = cfg.filterDepts.length > 0 ? cfg.filterDepts : (lastCalledDept ? [lastCalledDept] : [])
  const list = data
    .filter(q => q.status === 'waiting' || !q.status)
    // Once a room scope is active (explicit or auto from the last call), a queue with no
    // department at all doesn't belong to it — don't let it slip through as an exception.
    .filter(q => scopeDepts.length === 0 || (!!q.department && scopeDepts.includes(q.department)))
  if (cfg.upcomingQueueMode === 'opd' || cfg.upcomingQueueMode === 'cur_dep') {
    list.sort((a, b) => {
      const na = Number(a.queue_no), nb = Number(b.queue_no)
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
      return String(a.queue_no || '').localeCompare(String(b.queue_no || ''))
    })
  }
  return list
}

export default function QueueDisplayPage() {
  const [config, setConfig] = useState<QDConfig>(() => {
    // localStorage — always use saved settings
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return fixConfig(JSON.parse(saved))
    } catch {}
    return { ...DEFAULT }
  })
  const [saveDefaultMsg, setSaveDefaultMsg] = useState<string | null>(null)

  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([])
  const [spQueues, setSpQueues] = useState<Record<string, string>>({})
  const [spNames, setSpNames] = useState<Record<string, string>>({})
  const [rowAnimKeys, setRowAnimKeys] = useState<Record<string, number>>({})
  // Track call order — most recently called SP moves to top of display
  const [spCallOrder, setSpCallOrder] = useState<string[]>([])
  const [noShowQueues, setNoShowQueues] = useState<CallEntry[]>([])
  // Callboard layout: most recently called queue (across all channels) + upcoming/waiting preview
  const [lastCalled, setLastCalled] = useState<{ sp: string; queueNo: string; queueName: string; department?: string; animKey: number } | null>(null)
  const lastCalledRef = useRef(lastCalled)
  useEffect(() => { lastCalledRef.current = lastCalled }, [lastCalled])
  const [waitingQueues, setWaitingQueues] = useState<QueueItem[]>([])
  const [clock, setClock] = useState(new Date())
  const [showSettings, setShowSettings] = useState(false)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [availDepts, setAvailDepts] = useState<string[]>([])

  const [blinkingSPs, setBlinkingSPs] = useState<Set<string>>(new Set())
  const blinkTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const servicePointsRef = useRef<ServicePoint[]>([])
  const [audioUnlocked, setAudioUnlocked] = useState(false)

  const audioCtx = useRef<AudioContext | null>(null)
  // Display update buffered from queue:called — applied just before audio plays (sync display+audio).
  // Each entry owns its OWN fallback timer + played flag (not a single shared ref) — otherwise
  // calling a second queue (even to a different channel) before the first's audio arrives would
  // cancel the first call's 9s fallback via a shared ref, silently losing its announcement if the
  // server audio for it never arrives either.
  const pendingDisplayRef = useRef<Array<{sp:string; queueNo:string; queueName:string; displayConfigId?:string|null; department?:string; played: boolean; fallbackTimer?: ReturnType<typeof setTimeout>}>>([])
  const audioQueue = useRef<Array<{ url: string; volume: number; display?: {sp:string; queueNo:string; queueName:string; department?:string} }>>([])
  const audioPlaying = useRef(false)
  const audioGeneration = useRef(0)
  // Single reusable element — avoids Android WebView's ~12 HTMLAudioElement per-page hard limit
  const audioEl = useRef<HTMLAudioElement | null>(null)
  // Tracks successful plays — element is recycled every 15 plays to prevent Android WebView state accumulation
  const audioPlayCount = useRef(0)
  const isResizing = useRef(false)
  const configRef = useRef(config)
  // Snapshot of the last-saved config — restored if the settings panel is closed without saving
  // (e.g. toggling layout table↔callboard to preview, then closing with ✕ instead of บันทึก)
  const savedConfigSnapshot = useRef<QDConfig | null>(null)
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([])
  const [serverTtsVoices, setServerTtsVoices] = useState<string[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [previewError, setPreviewError] = useState<string>('')
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  // Password dialog for enabling ttsShowName
  const [showNamePwdDialog, setShowNamePwdDialog] = useState(false)
  const [namePwd, setNamePwd] = useState('')
  const [namePwdError, setNamePwdError] = useState(false)
  const namePwdRef = useRef<HTMLInputElement>(null)

  const handleToggleShowName = (v: boolean) => {
    if (v) {
      // เปิด → ต้องกรอกรหัสผ่านก่อน
      setNamePwd('')
      setNamePwdError(false)
      setShowNamePwdDialog(true)
      setTimeout(() => namePwdRef.current?.focus(), 80)
    } else {
      // ปิด → ไม่ต้องยืนยัน
      setConfig(c => ({ ...c, ttsShowName: false, maskLastName: false }))
    }
  }

  const confirmNamePwd = () => {
    if (namePwd === 'bms123456') {
      setConfig(c => ({ ...c, ttsShowName: true }))
      setShowNamePwdDialog(false)
      setNamePwd('')
    } else {
      setNamePwdError(true)
      namePwdRef.current?.select()
    }
  }

  // Keep configRef in sync for use inside effects without re-registering
  useEffect(() => { configRef.current = config }, [config])

  // Auto-save config to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch {}
  }, [config])

  // Load config from server on startup
  // - Display with ?id= → load from per-display config (isolated)
  // - Display without id → load from global qd-default-config
  useEffect(() => {
    const loader = URL_DISPLAY_ID
      ? getDisplayQDConfig(URL_DISPLAY_ID)
      : getQDDefaultConfig()

    loader.then(serverCfg => {
      if (!serverCfg) {
        if (!localStorage.getItem(STORAGE_KEY)) setConfig({ ...DEFAULT })
        return
      }
      if (!localStorage.getItem(STORAGE_KEY)) {
        setConfig(fixConfig(serverCfg))
      } else {
        // Sync all settings from server (per-display config is authoritative)
        setConfig(c => ({ ...fixConfig(serverCfg), displayConfigId: c.displayConfigId, displayConfigName: c.displayConfigName, displayChannels: c.displayChannels }))
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When settings panel opens: re-sync TTS config from server + reload server voices
  const TTS_KEYS_CONST: (keyof QDConfig)[] = [
    'ttsEnabled', 'ttsSource', 'ttsPrefix1', 'ttsMiddle', 'ttsSuffix',
    'ttsVoiceName', 'ttsServerVoiceName', 'ttsRate', 'ttsPitch', 'ttsVolume', 'soundEnabled', 'ttsShowName', 'maskLastName'
  ]
  useEffect(() => {
    if (!showSettings) return
    refreshServerVoices()
    const loader = URL_DISPLAY_ID ? getDisplayQDConfig(URL_DISPLAY_ID) : getQDDefaultConfig()
    loader.then(serverCfg => {
      if (!serverCfg) return
      setConfig(c => {
        const merged = { ...fixConfig(serverCfg), displayConfigId: c.displayConfigId, displayConfigName: c.displayConfigName, displayChannels: c.displayChannels }
        savedConfigSnapshot.current = merged
        return merged
      })
    })
  }, [showSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load TTS voices (Web Speech API)
  // Electron's voiceschanged event is unreliable — poll until voices are available
  useEffect(() => {
    const load = () => {
      const voices = window.speechSynthesis?.getVoices() ?? []
      if (voices.length > 0) setTtsVoices(voices)
    }
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    const interval = setInterval(() => {
      const voices = window.speechSynthesis?.getVoices() ?? []
      if (voices.length > 0) {
        setTtsVoices(voices)
        clearInterval(interval)
      }
    }, 200)
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', load)
      clearInterval(interval)
    }
  }, [])

  // Load server TTS voices (Windows SAPI)
  const refreshServerVoices = () => {
    setLoadingVoices(true)
    getTTSVoices().then(v => { setServerTtsVoices(v); setLoadingVoices(false) }).catch(() => setLoadingVoices(false))
  }
  useEffect(() => { refreshServerVoices() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load service points
  useEffect(() => {
    getServicePoints().then(sps => { setServicePoints(sps); servicePointsRef.current = sps })
  }, [])

  // Detect autoplay capability — browsers block audio until user interacts with the page
  useEffect(() => {
    const el = new Audio()
    el.muted = true
    el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
    el.play().then(() => { el.pause(); setAudioUnlocked(true) }).catch(() => setAudioUnlocked(false))
  }, [])

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Poll no-show queues every 15s + load available depts
  useEffect(() => {
    const refresh = async () => {
      const cfg = configRef.current
      // Keep this display's channel list / name in sync with "จัดการหน้าจอแสดงคิว" — channels
      // added/removed there previously only took effect after a full page reload here.
      if (URL_DISPLAY_ID) {
        getDisplayConfigById(URL_DISPLAY_ID).then(dcfg => {
          if (!dcfg) return
          const channels = dcfg.channels || []
          setConfig(c => {
            const sameChannels = c.displayChannels.length === channels.length && c.displayChannels.every((ch, i) => ch === channels[i])
            if (sameChannels && c.displayConfigId === URL_DISPLAY_ID && c.displayConfigName === (dcfg.name || '')) return c
            return { ...c, displayConfigId: URL_DISPLAY_ID, displayConfigName: dcfg.name || '', displayChannels: channels }
          })
          if (dcfg.name) document.title = `จอ: ${dcfg.name} — Queue OPD`
        }).catch(() => {})
      }
      const [calls, queueRes] = await Promise.all([
        getCallsToday(),
        getQueueList(cfg.upcomingQueueMode).catch(() => ({ success: false, data: [] }))
      ])
      setNoShowQueues(calls.filter((c: CallEntry) => c.status === 'skip'))
      if (queueRes.success) {
        const waitingAll = computeUpcomingQueues(cfg, queueRes.data, lastCalledRef.current?.department)
        setWaitingQueues(waitingAll)
        // Prewarm Edge TTS for upcoming queues × visible channels — eliminates delay on first call
        if (cfg.ttsEnabled && cfg.ttsSource === 'server') {
          const waiting = waitingAll
            .slice(0, 3)
            .map((q: QueueItem) => ({ no: q.queue_slot || String(q.queue_no), name: q.queue_name }))
          if (waiting.length > 0) {
            const spList = cfg.displayChannels?.length > 0
              ? cfg.displayChannels.slice(0, 5)
              : servicePointsRef.current.length > 0
                ? servicePointsRef.current.slice(0, 5).map(sp => sp.id)
                : ['1', '2', '3']
            prewarmTTS(waiting, spList, cfg.displayConfigId || '')
          }
        }
        const depts = Array.from(new Set(queueRes.data.map((q: QueueItem) => q.department).filter(Boolean))).sort() as string[]
        setAvailDepts(depts)
        // อัพเดตชื่อโดยใช้ spQueues เป็น reference (match queueNo → name)
        // เพื่อป้องกันชื่อเก่า/ผิดช่องมาทับ
        setSpQueues(prev => {
          const nameMap: Record<string, string> = {}
          Object.entries(prev).forEach(([sp, qno]) => {
            if (!qno) return
            const match = queueRes.data.find((q: QueueItem) =>
              (q.queue_slot || q.queue_no) === qno && q.queue_name
            )
            if (match) nameMap[sp] = match.queue_name
          })
          if (Object.keys(nameMap).length > 0)
            setSpNames(names => ({ ...names, ...nameMap }))
          return prev
        })
      }
    }
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [])

  // WebSocket: real-time queue call events
  useEffect(() => {
    const off = onQueueCalled(data => {
      const cfg = configRef.current
      // Filter: if this display has an ID, only accept calls for this display (or untagged calls)
      if (cfg.displayConfigId && data.displayConfigId && data.displayConfigId !== cfg.displayConfigId) return

      // Filter: department — ถ้าตั้งค่ากรองแผนกไว้ และ event มีข้อมูลแผนก ต้องตรงกัน
      if (cfg.filterDepts.length > 0 && data.department && !cfg.filterDepts.includes(data.department)) return

      const isServerTts = cfg.ttsEnabled && cfg.ttsSource === 'server'
      const sp = normalizeSpId(data.servicePoint)

      if (isServerTts) {
        // Buffer display update — will be applied just before audio plays (keeps display+audio in sync).
        // Each call gets its own entry with its own fallback timer, so a second call (even to a
        // different channel) arriving before this one's audio does can never cancel THIS one's fallback.
        const entry: (typeof pendingDisplayRef)['current'][number] = {
          sp,
          queueNo: data.queueNo,
          queueName: (data as any).queueName || '',
          displayConfigId: data.displayConfigId,
          department: (data as any).department,
          played: false
        }
        pendingDisplayRef.current.push(entry)
        // Fallback: if queue:audio never arrives for THIS call (TTS failed), apply display + browser TTS after 9s
        const snapCfg = cfg
        entry.fallbackTimer = setTimeout(() => {
          if (entry.played) return
          entry.played = true
          const pi = pendingDisplayRef.current.indexOf(entry)
          if (pi >= 0) pendingDisplayRef.current.splice(pi, 1)
          setSpQueues(prev => ({ ...prev, [entry.sp]: entry.queueNo }))
          setSpNames(prev => ({ ...prev, [entry.sp]: entry.queueName }))
          setRowAnimKeys(prev => ({ ...prev, [entry.sp]: (prev[entry.sp] || 0) + 1 }))
          setLastCalled({ sp: entry.sp, queueNo: entry.queueNo, queueName: entry.queueName, department: entry.department, animKey: Date.now() })
          playTTS(entry.queueNo, entry.sp, snapCfg, entry.queueName)
        }, 9000)
      } else {
        // Non-server TTS or no TTS — update display immediately
        setSpQueues(prev => ({ ...prev, [sp]: data.queueNo }))
        setSpNames(prev => ({ ...prev, [sp]: (data as any).queueName || '' }))
        setRowAnimKeys(prev => ({ ...prev, [sp]: (prev[sp] || 0) + 1 }))
        setLastCalled({ sp, queueNo: data.queueNo, queueName: (data as any).queueName || '', department: (data as any).department, animKey: Date.now() })
        if (cfg.blinkEnabled) {
          clearTimeout(blinkTimers.current[sp])
          setBlinkingSPs(prev => new Set([...prev, sp]))
          blinkTimers.current[sp] = setTimeout(() => {
            setBlinkingSPs(prev => { const n = new Set(prev); n.delete(sp); return n })
          }, cfg.blinkCount * cfg.blinkSpeed * 2 + 400)
        }
        if (cfg.ttsEnabled && cfg.ttsSource !== 'server') {
          playTTS(data.queueNo, sp, cfg, (data as any).queueName)
        } else if (cfg.soundEnabled) {
          playBeep()
        }
      }
      setTimeout(() => {
        getCallsToday().then(c => setNoShowQueues(c.filter((x: CallEntry) => x.status === 'skip')))
        getQueueList(cfg.upcomingQueueMode).then(r => {
          if (!r.success) return
          setWaitingQueues(computeUpcomingQueues(cfg, r.data, lastCalledRef.current?.department))
        }).catch(() => {})
      }, 800)
    })
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket: status changed (skip/done/waiting) — refresh no-show list immediately
  useEffect(() => {
    const off = onQueueStatusChanged(() => {
      getCallsToday().then(c => setNoShowQueues(c.filter((x: CallEntry) => x.status === 'skip')))
    })
    return off
  }, [])

  // Handle page visibility change — Android background/foreground & TV channel switch
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Invalidate all in-flight drain sessions + discard stale audio
        audioGeneration.current++
        audioQueue.current = []
        pendingDisplayRef.current.forEach(p => { p.played = true; if (p.fallbackTimer) clearTimeout(p.fallbackTimer) })
        pendingDisplayRef.current = []
        if (audioEl.current) {
          audioEl.current.onerror = null
          audioEl.current.onended = null
          audioEl.current.pause()
          audioEl.current.src = ''
        }
        audioPlaying.current = false
        if (audioCtx.current) {
          audioCtx.current.close().catch(() => {})
          audioCtx.current = null
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Watchdog: if audioPlaying is stuck true for 15s+ with nothing actually playing, reset it
  // Covers the rare case where a Promise never resolves despite the 12s safety timeout
  useEffect(() => {
    const audioPlayingSince = { ts: 0 }
    const id = setInterval(() => {
      if (!audioPlaying.current) { audioPlayingSince.ts = 0; return }
      const el = audioEl.current
      const actuallyPlaying = el && !el.paused && !el.ended && el.readyState >= 2
      if (!actuallyPlaying) {
        if (audioPlayingSince.ts === 0) { audioPlayingSince.ts = Date.now(); return }
        if (Date.now() - audioPlayingSince.ts > 15000) {
          console.warn('[audio] watchdog: resetting stuck audioPlaying lock')
          audioPlaying.current = false
          audioPlayingSince.ts = 0
          if (audioQueue.current.length > 0) drainAudioQueue(audioGeneration.current)
        }
      } else {
        audioPlayingSince.ts = 0
      }
    }, 3000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Play audio via HTMLAudioElement — single element reused to stay within Android WebView's ~12 per-page limit,
  // but recycled every 15 plays to prevent internal state accumulation on old WebViews
  const playAudioUrl = (url: string, volume: number): Promise<void> => {
    return new Promise((resolve) => {
      try {
        // Recycle element proactively to avoid Android WebView state rot
        audioPlayCount.current++
        if (!audioEl.current || audioPlayCount.current > 15) {
          if (audioEl.current) {
            // Clear handlers BEFORE src='' — prevents stale error events from
            // firing on the new element's done() closure after we create it
            audioEl.current.onerror = null
            audioEl.current.onended = null
            audioEl.current.pause()
            audioEl.current.src = ''
          }
          audioEl.current = new Audio()
          audioPlayCount.current = 1
        }
        const audio = audioEl.current
        audio.pause()
        audio.volume = Math.min(Math.max(volume, 0), 1)
        audio.src = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`
        audio.load() // Explicit reset+reload — fixes stale internal state on old Android WebViews

        let settled = false
        // failed=true → force recycle on next call, but NEVER nullify audioEl.current:
        // a stale safety timer from a previous play session fires 8s later and would null out
        // the CURRENT session's element, causing two audio elements to play simultaneously.
        const done = (failed = false) => {
          if (!settled) {
            settled = true
            if (failed) audioPlayCount.current = 16 // trigger recycle next call
            resolve()
          }
        }
        const safety = setTimeout(() => done(true), 8000)
        audio.onended = () => { clearTimeout(safety); done() }
        audio.onerror = () => { clearTimeout(safety); done(true) }
        try {
          const p = audio.play()
          if (p !== undefined) {
            p.catch(() => { clearTimeout(safety); done(true) })
          } else {
            // Old Android: play() returns undefined — detect silent failure after 3s
            // (if audio started, paused=false; if failed silently, paused=true)
            setTimeout(() => { if (!settled && audio.paused) { clearTimeout(safety); done(true) } }, 3000)
          }
        } catch { clearTimeout(safety); done(true) }
      } catch { resolve() }
    })
  }

  // Drain audio queue sequentially — generation prevents stale async sessions from
  // resetting audioPlaying after a newer session has taken over
  const drainAudioQueue = async (gen: number) => {
    if (audioPlaying.current) return
    audioPlaying.current = true
    while (audioQueue.current.length > 0 && gen === audioGeneration.current) {
      const item = audioQueue.current.shift()!
      // Apply display update BEFORE playing audio — ensures display shows new queue as announcement starts
      if (item.display) {
        const { sp, queueNo, queueName, department } = item.display
        setSpQueues(prev => ({ ...prev, [sp]: queueNo }))
        setSpNames(prev => ({ ...prev, [sp]: queueName }))
        setRowAnimKeys(prev => ({ ...prev, [sp]: (prev[sp] || 0) + 1 }))
        setLastCalled({ sp, queueNo, queueName, department, animKey: Date.now() })
        if (configRef.current.blinkEnabled) {
          clearTimeout(blinkTimers.current[sp])
          setBlinkingSPs(prev => new Set([...prev, sp]))
          blinkTimers.current[sp] = setTimeout(() => {
            setBlinkingSPs(prev => { const n = new Set(prev); n.delete(sp); return n })
          }, configRef.current.blinkCount * configRef.current.blinkSpeed * 2 + 400)
        }
      }
      try {
        await playAudioUrl(item.url, item.volume)
      } catch { /* playAudioUrl should never reject — belt-and-suspenders guard */ }
      if (audioQueue.current.length > 0 && gen === audioGeneration.current) {
        await new Promise(r => setTimeout(r, 400))
      }
    }
    // Only release lock if we are still the current session
    if (gen === audioGeneration.current) {
      audioPlaying.current = false
      if (audioQueue.current.length > 0) drainAudioQueue(audioGeneration.current)
    }
  }

  const enqueueAudio = (url: string, volume: number, display?: {sp:string; queueNo:string; queueName:string; department?:string}) => {
    audioQueue.current.push({ url, volume, display })
    drainAudioQueue(audioGeneration.current)
  }

  // WebSocket: async TTS audio ready — queue in order, never interrupt current announcement
  useEffect(() => {
    const off = onQueueAudio(data => {
      const cfg = configRef.current
      if (cfg.displayConfigId && data.displayConfigId && data.displayConfigId !== cfg.displayConfigId) return
      if (cfg.filterDepts.length > 0 && (data as any).department && !cfg.filterDepts.includes((data as any).department)) return
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel()
      // Match this audio to ITS OWN pending entry by servicePoint+queueNo — not a blind FIFO shift().
      // Two calls can arrive close together (e.g. different channels) and their server TTS can finish
      // out of order, so shift() would sometimes pop the wrong entry and pair the wrong display update
      // with this audio (or leave the true match permanently stuck, silencing a later call).
      const audioSp = normalizeSpId(data.servicePoint || '')
      const pi = pendingDisplayRef.current.findIndex(p => !p.played && p.sp === audioSp && p.queueNo === data.queueNo)
      let pending: (typeof pendingDisplayRef)['current'][number] | undefined
      if (pi >= 0) {
        pending = pendingDisplayRef.current.splice(pi, 1)[0]
        pending.played = true
        if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer)
      } else {
        // No servicePoint/queueNo on this broadcast (older server) or already consumed — fall back to FIFO
        pending = pendingDisplayRef.current.shift()
        if (pending) { pending.played = true; if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer) }
      }
      // Enqueue audio + display update — drain applies display then plays audio in order
      enqueueAudio(data.audioUrl, cfg.ttsVolume ?? 1, pending ? { sp: pending.sp, queueNo: pending.queueNo, queueName: pending.queueName, department: pending.department } : undefined)
    })
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Display config broadcast — only global default displays (no ?id=) should react to this;
  // per-display screens have their own isolated config (loaded/saved via qd-config/:id) and must
  // not be overwritten by another screen's global-default save.
  useEffect(() => {
    const off = onDisplayConfig(cfg => {
      if (configRef.current.displayConfigId) return
      setConfig(c => ({ ...c, ...(cfg as Partial<QDConfig>) }))
    })
    return off
  }, [])

  // queue:clear — reset spQueues สำหรับจอนี้
  useEffect(() => {
    const off = onQueueClear(data => {
      const cfg = configRef.current
      // ถ้า event ระบุ displayConfigId ต้องตรงกับจอนี้จึงเคลีย
      if (data.displayConfigId && cfg.displayConfigId && data.displayConfigId !== cfg.displayConfigId) return
      setSpQueues({})
      setSpNames({})
      setLastCalled(null)
    })
    return off
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const playBeep = () => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext()
      const ctx = audioCtx.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    } catch {}
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = config.spColumnWidth

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = ev.clientX - resizeStartX.current
      const w = Math.max(60, Math.min(500, resizeStartW.current + delta))
      setConfig(c => ({ ...c, spColumnWidth: Math.round(w) }))
    }
    const onUp = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const playTTS = (queueNo: string, servicePoint: string, cfg: QDConfig, queueName?: string) => {
    if (!window.speechSynthesis) return
    // เมื่อเปิดประกาศชื่อ: อ่านแค่นามสกุล (lname) แทนเลขคิว
    const ttsName = queueName ? nameForTTS(queueName) : ''
    const text = cfg.ttsShowName && ttsName
      ? [cfg.ttsPrefix1, ttsName, cfg.ttsMiddle, servicePoint, cfg.ttsSuffix].filter(Boolean).join(' ')
      : [cfg.ttsPrefix1, queueNo, cfg.ttsMiddle, servicePoint, cfg.ttsSuffix].filter(Boolean).join(' ')
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.lang = 'th-TH'
    utt.rate = cfg.ttsRate
    utt.pitch = cfg.ttsPitch
    utt.volume = cfg.ttsVolume
    const voices = window.speechSynthesis.getVoices()
    const picked = voices.find(v => v.name === cfg.ttsVoiceName)
      || voices.find(v => v.lang === 'th-TH')
      || voices.find(v => v.lang.startsWith('th'))
    // If this display uses server TTS and no Thai voice is available, stay silent.
    // Playing English default is worse than silence when the configured voice is Thai.
    if (!picked && cfg.ttsSource === 'server') return
    if (picked) utt.voice = picked
    window.speechSynthesis.speak(utt)
  }

  const previewTTS = async () => {
    if (config.ttsSource === 'server') {
      setPreviewState('loading')
      setPreviewError('')
      try {
        const text = [config.ttsPrefix1, 'A001', config.ttsMiddle, '1', config.ttsSuffix].filter(Boolean).join(' ')
        const result = await previewServerTTS(text, config.ttsServerVoiceName, config.ttsRate ?? 1)
        if (result.url) {
          await playAudioUrl(result.url, config.ttsVolume ?? 1)
          setPreviewState('ok')
        } else {
          setPreviewError(result.error || 'error')
          setPreviewState('err')
        }
      } catch (e: unknown) {
        setPreviewError(e instanceof Error ? e.message : 'error')
        setPreviewState('err')
      }
      setTimeout(() => setPreviewState('idle'), 8000)
    } else {
      playTTS('A001', '1', config)
    }
  }

  const openSettings = () => {
    setShowSettings(true)
    getSystemFonts().then(setSystemFonts)
  }

  const saveConfig = async () => {
    if (URL_DISPLAY_ID) {
      await saveDisplayQDConfig(URL_DISPLAY_ID, config)
    } else {
      await saveQDDefaultConfig(config)
      updateDisplayConfig(config as unknown as DisplayConfig)
    }
    savedConfigSnapshot.current = config
    setShowSettings(false)
  }

  const saveAsDefault = async () => {
    if (URL_DISPLAY_ID) {
      await saveDisplayQDConfig(URL_DISPLAY_ID, config)
      setSaveDefaultMsg('บันทึกการตั้งค่าจอนี้สำเร็จ ✓')
    } else {
      await saveQDDefaultConfig(config)
      setSaveDefaultMsg('บันทึกเป็นค่าเริ่มต้นสำเร็จ ✓')
    }
    savedConfigSnapshot.current = config
    setTimeout(() => setSaveDefaultMsg(null), 2500)
  }

  // ปิดตั้งค่าโดยไม่บันทึก — คืนค่ากลับไปเป็นค่าที่บันทึกไว้ล่าสุด (กันกรณีลองสลับ
  // เลย์เอาต์ตาราง/บอร์ดเรียกคิวไปมาเพื่อดูตัวอย่าง แล้วปิดโดยไม่ได้กดบันทึก)
  const closeSettingsWithoutSaving = () => {
    if (savedConfigSnapshot.current) {
      const snap = savedConfigSnapshot.current
      setConfig(c => ({ ...snap, displayConfigId: c.displayConfigId, displayConfigName: c.displayConfigName, displayChannels: c.displayChannels }))
    }
    setShowSettings(false)
  }

  // Derived: use display-specific channels if this display has an ID, otherwise global SPs —
  // either way, apply hiddenSPs (เปิด/ปิด toggle) so a turned-off channel never renders
  const baseSPs = config.displayConfigId && config.displayChannels.length > 0
    ? config.displayChannels.map(ch => ({ id: ch, name: ch }))
    : servicePoints
  const visibleSPs = baseSPs.filter(sp => !config.hiddenSPs.includes(sp.id) && !config.hiddenSPs.includes(sp.name))

  const toggleFilterDept = (dept: string) =>
    setConfig(c => ({
      ...c,
      filterDepts: c.filterDepts.includes(dept)
        ? c.filterDepts.filter(d => d !== dept)
        : [...c.filterDepts, dept]
    }))

  const toggleSPVisibility = (sp: ServicePoint) => {
    const hidden = config.hiddenSPs.includes(sp.id) || config.hiddenSPs.includes(sp.name)
    setConfig(c => ({
      ...c,
      hiddenSPs: hidden
        ? c.hiddenSPs.filter(x => x !== sp.id && x !== sp.name)
        : [...c.hiddenSPs, sp.id]
    }))
  }

  const setSpDisplayName = (sp: ServicePoint, name: string) => {
    setConfig(c => ({
      ...c,
      spDisplayNames: { ...c.spDisplayNames, [sp.id]: name }
    }))
  }

  // เรียกแล้วไม่มา — ขอบเขตเดียวกับคิวถัดไป: ใช้ห้องตรวจที่เลือกไว้ ถ้าไม่ได้เลือกไว้ใช้แผนก
  // ของคิวล่าสุดที่เพิ่งเรียกแทน ไม่งั้นทุกจอจะเห็นคิวไม่มาของทุกห้องตรวจปนกันหมด
  const noShowScopeDepts = config.filterDepts.length > 0
    ? config.filterDepts
    : (lastCalled?.department ? [lastCalled.department] : [])
  const filteredNoShow = noShowScopeDepts.length === 0
    ? noShowQueues
    : noShowQueues.filter(q => q.department && noShowScopeDepts.includes(q.department))

  const fontFace = `'${config.font}', 'Sarabun', 'Tahoma', sans-serif`
  const animClass = { fade: 'anim-fade', slide: 'anim-slide', scale: 'anim-scale', bounce: 'anim-bounce' }[config.animationType]
  const marqueeStyle = { animationDuration: `${config.footerScrollSpeed}s`, fontSize: config.footerFontSize }
  const border = `${config.borderWidth}px solid ${config.borderColor}`

  const renderColumn = (sps: typeof visibleSPs, colIdx: number) => (
    <div key={colIdx} className="qd-main" style={{ position: 'relative', borderRight: border }}>
      {config.spColumnVisible && colIdx === 0 && (
        <div className="qd-col-resizer" style={{ left: config.spColumnWidth }} onMouseDown={startResize} title="ลากเพื่อปรับความกว้าง" />
      )}
      <div className="qd-thead">
        {config.spColumnVisible && (
          <div className="qd-th qd-th-sp" style={{ width: config.spColumnWidth, minWidth: config.spColumnWidth, background: config.spHeaderBg, color: config.spHeaderColor, borderRight: border, borderBottom: border }}>
            <span className="qd-th-label">{config.colSpHeader}</span>
          </div>
        )}
        <div className="qd-th qd-th-queue" style={{ background: config.tableHeaderBg, color: config.tableHeaderColor, borderBottom: border }}>
          {config.colQueueHeader}
        </div>
      </div>
      <div className="qd-tbody">
        {sps.length === 0 ? (
          <div className="qd-empty">{servicePoints.length === 0 ? 'กำลังโหลด...' : '—'}</div>
        ) : sps.map(sp => {
          const displayName = config.spDisplayNames[sp.id] || config.spDisplayNames[sp.name] || sp.name
          const queueNo = spQueues[sp.name] || spQueues[sp.id] || ''
          const rawName = config.ttsShowName ? (spNames[sp.name] || spNames[sp.id] || '') : ''
          const patientName = rawName && config.maskLastName ? maskName(rawName) : rawName
          const badge = queueNo ? extractBadge(queueNo) : null
          const rowKey = rowAnimKeys[sp.name] || rowAnimKeys[sp.id] || 0
          const isBlinking = config.blinkEnabled && !!queueNo && (blinkingSPs.has(sp.name) || blinkingSPs.has(sp.id))
          return (
            <div key={sp.id} className="qd-row" style={{ borderBottom: border }}>
              {config.spColumnVisible && (
                <div className="qd-td qd-td-sp" style={{ width: config.spColumnWidth, minWidth: config.spColumnWidth, background: config.spColumnBg, color: config.spColumnColor, fontSize: `${config.spFontSize}vw`, borderRight: border }}>
                  {displayName}
                </div>
              )}
              <div key={`q-${rowKey}`} className="qd-td qd-td-queue" style={{
                background: config.queueBg,
                ...(isBlinking && config.blinkTarget !== 'text' ? {
                  animation: `qd-blink-anim ${config.blinkSpeed}ms step-end ${config.blinkCount}`,
                  '--qd-blink-color': config.blinkColor,
                  '--qd-queue-bg': config.queueBg,
                } as React.CSSProperties : {})
              }}>
                {queueNo ? (
                  <div className={`qd-queue-cell ${animClass}`}>
                    {patientName ? (
                      <>
                        <span className="qd-queue-no-small" style={{ color: config.queueColor, ...textBlinkStyle(isBlinking) }}>{badge && <span className="qd-badge-inline">{badge}</span>}{queueNo}</span>
                        <span className="qd-patient-name-main" style={{ color: config.queueColor, fontSize: `${config.fontSize * 0.65}vw` }}>{patientName}</span>
                      </>
                    ) : (
                      <>
                        {badge && <span className="qd-badge">{badge}</span>}
                        <span className="qd-queue-no" style={{ color: config.queueColor, fontSize: `${config.fontSize}vw`, ...textBlinkStyle(isBlinking) }}>{queueNo}</span>
                      </>
                    )}
                  </div>
                ) : <span className="qd-dash">—</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─── Callboard layout: big "currently called" block + per-channel rows + upcoming preview ───
  // ส่วนที่ 1/2 มีขนาดตัวอักษรแยกกัน (cbFontSize1/cbFontSize2) และทุกส่วนเว้นช่องไฟระหว่างกัน
  const textBlinkStyle = (on: boolean): React.CSSProperties =>
    on && config.blinkTarget === 'text'
      ? { animation: `qd-blink-text ${config.blinkSpeed}ms step-end ${config.blinkCount}` }
      : {}

  const renderCallboard = () => {
    const cbIsBlinking = config.blinkEnabled && !!lastCalled && blinkingSPs.has(lastCalled.sp)
    const cbRawName = lastCalled && config.ttsShowName ? lastCalled.queueName : ''
    const cbPatientName = cbRawName && config.maskLastName ? maskName(cbRawName) : cbRawName
    const cbBadge = lastCalled?.queueNo ? extractBadge(lastCalled.queueNo) : null
    const upcoming = waitingQueues.slice(0, config.upcomingCount)
    const cbHeaderFontSize = `${config.cbHeaderFontSize}px`

    return (
      <div className="qd-cb-wrap">
        <div className="qd-cb-left" style={{ flex: `0 0 ${config.cbLeftSize}%` }}>
          <div className="qd-cb1-thead" style={{ background: config.tableHeaderBg, color: config.tableHeaderColor, height: config.cbHeaderHeight, fontSize: cbHeaderFontSize }}>
            {config.cbHeader1}
          </div>
          <div key={`cb-big-${lastCalled?.animKey || 0}`} className="qd-cb-big" style={{
            background: config.cbBg1,
            border: `${config.borderWidth}px solid ${config.borderColor}`,
            ...(cbIsBlinking && config.blinkTarget !== 'text' ? {
              animation: `qd-blink-anim-cb1 ${config.blinkSpeed}ms step-end ${config.blinkCount}`,
            } as React.CSSProperties : {})
          }}>
            {lastCalled?.queueNo ? (
              <div key={`cb-${lastCalled.animKey}`} className={`qd-cb-big-cell ${animClass}`}>
                {cbBadge && <span className="qd-badge qd-cb-badge">{cbBadge}</span>}
                <span className="qd-cb-queue-no" style={{ color: config.queueColor, fontSize: `${fitQueueFontSize(lastCalled.queueNo, config.cbFontSize1)}vw`, ...textBlinkStyle(cbIsBlinking) }}>
                  {lastCalled.queueNo}
                </span>
                {cbPatientName && (
                  <span className="qd-cb-patient-name" style={{ color: config.queueColor }}>{cbPatientName}</span>
                )}
                <span className="qd-cb-sp-label" style={{ background: config.tableHeaderBg, color: config.tableHeaderColor, fontSize: `${config.cbSpLabelFontSize}vw` }}>
                  {lastCalled.sp}
                </span>
              </div>
            ) : (
              <span className="qd-dash qd-cb-dash">รอเรียกคิว</span>
            )}
          </div>

          {config.showUpcoming && (
            <div className="qd-cb-upcoming" style={{ background: config.rightPanelBg }}>
              <div className="qd-cb-upcoming-hd" style={{ background: config.rightPanelHeaderBg, color: config.rightPanelHeaderColor }}>
                คิวถัดไป
              </div>
              <div className="qd-cb-upcoming-list">
                {upcoming.length === 0 ? (
                  <span className="qd-cb-upcoming-empty">— ไม่มีคิวรอ —</span>
                ) : upcoming.map(q => (
                  <div key={q.vn} className="qd-cb-upcoming-item" style={{ borderColor: config.borderColor }}>
                    <span className="qd-cb-upcoming-no">{q.queue_slot || q.queue_no}</span>
                    {q.department && <span className="qd-cb-upcoming-dept">{q.department}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ส่วนที่ 2: ช่องบริการ — แบ่งได้หลายคอลัมน์ (ตั้งค่าที่ "การจัดเรียงคอลัมน์") หัวคอลัมน์ + แถวแยกกล่อง "ช่อง" กับ "คิว" เป็นสี่เหลี่ยมขอบมน เว้นช่องไฟ ~2mm */}
        <div className="qd-cb2-multi">
          {columnGroups.every(g => g.length === 0) ? (
            <div className="qd-cb2-col" style={{ position: 'relative' }}>
              <div className="qd-col-resizer" style={{ left: config.spColumnWidth }} onMouseDown={startResize} title="ลากเพื่อปรับความกว้าง" />
              <div className="qd-empty">{servicePoints.length === 0 ? 'กำลังโหลด...' : '—'}</div>
            </div>
          ) : columnGroups.map((sps, colIdx) => (
            <div className="qd-cb2-col" key={colIdx} style={{ position: 'relative' }}>
              {colIdx === 0 && (
                <div className="qd-col-resizer" style={{ left: config.spColumnWidth }} onMouseDown={startResize} title="ลากเพื่อปรับความกว้าง" />
              )}
              <div className="qd-cb2-thead">
                <div className="qd-cb2-th-sp" style={{ width: config.spColumnWidth, minWidth: config.spColumnWidth, height: config.cbHeaderHeight, background: config.spHeaderBg, color: config.spHeaderColor, fontSize: cbHeaderFontSize }}>
                  {config.colSpHeader}
                </div>
                <div className="qd-cb2-th-queue" style={{ height: config.cbHeaderHeight, background: config.tableHeaderBg, color: config.tableHeaderColor, fontSize: cbHeaderFontSize }}>
                  {config.colQueueHeader}
                </div>
              </div>
              <div className="qd-cb2-wrap">
                {sps.map(sp => {
                  const displayName = config.spDisplayNames[sp.id] || config.spDisplayNames[sp.name] || sp.name
                  const queueNo = spQueues[sp.name] || spQueues[sp.id] || ''
                  const rowKey = rowAnimKeys[sp.name] || rowAnimKeys[sp.id] || 0
                  const chIsBlinking = config.blinkEnabled && !!queueNo && (blinkingSPs.has(sp.name) || blinkingSPs.has(sp.id))
                  const qn2FontSize = queueNo ? fitQueueFontSize(queueNo, config.cbFontSize2) : config.cbFontSize2 * 0.6
                  const boxBorder = `${config.borderWidth}px solid ${config.borderColor}`
                  return (
                    <div key={sp.id} className="qd-cb2-row">
                      <div className="qd-cb2-sp-box" style={{
                        width: config.spColumnWidth, minWidth: config.spColumnWidth,
                        background: config.spColumnBg, color: config.spColumnColor,
                        border: boxBorder, fontSize: `${config.cbSpFontSize2}vw`,
                      }}>
                        {displayName}
                      </div>
                      <div key={`qbox-${rowKey}`} className="qd-cb2-queue-box" style={{
                        background: config.cbBg2,
                        border: boxBorder,
                        ...(chIsBlinking && config.blinkTarget !== 'text' ? {
                          animation: `qd-blink-anim-cb2 ${config.blinkSpeed}ms step-end ${config.blinkCount}`,
                        } as React.CSSProperties : {})
                      }}>
                        <div key={`ch-${rowKey}`} className={`qd-cb2-queue-no ${animClass}`}
                          style={{ color: config.queueColor, fontSize: `${qn2FontSize}vw`, ...textBlinkStyle(chIsBlinking) }}>
                          {queueNo || <span className="qd-dash" style={{ fontSize: 'inherit' }}>—</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // แบ่ง visibleSPs ตาม spColumns แล้ว sort ตาม spRows
  const columnGroups: (typeof visibleSPs)[] = Array.from({ length: config.numColumns }, () => [])
  visibleSPs.forEach(sp => {
    const col = (config.spColumns[sp.id] ?? config.spColumns[sp.name] ?? 1)
    const idx = Math.min(Math.max(col - 1, 0), config.numColumns - 1)
    columnGroups[idx].push(sp)
  })
  columnGroups.forEach(group => {
    group.sort((a, b) => {
      const ra = config.spRows[a.id] ?? config.spRows[a.name] ?? 999
      const rb = config.spRows[b.id] ?? config.spRows[b.name] ?? 999
      return ra - rb
    })
  })

  return (
    <div className="qd-root" style={{ fontFamily: fontFace }}>
      {/* Inject actual blink colors — var() in @keyframes not supported on Android WebView.
          Callboard's ส่วนที่ 1/2 have independent backgrounds (cbBg1/cbBg2), so each needs its own keyframe. */}
      <style>{`
        @keyframes qd-blink-anim { 0%,100%{background-color:${config.blinkColor};} 50%{background-color:${config.queueBg};} }
        @keyframes qd-blink-anim-cb1 { 0%,100%{background-color:${config.blinkColor};} 50%{background-color:${config.cbBg1};} }
        @keyframes qd-blink-anim-cb2 { 0%,100%{background-color:${config.blinkColor};} 50%{background-color:${config.cbBg2};} }
        @keyframes qd-blink-text { 0%,100%{color:${config.blinkColor};} 50%{color:${config.queueColor};} }
      `}</style>

      {/* ─── HEADER ──────────────────────────────────────────── */}
      <header className="qd-header" style={{ background: config.headerBg, color: config.headerTextColor }}>
        <span className="qd-title">
          {config.title}
          {config.displayStation && <span className="qd-station-tag">{config.displayStation}</span>}
          {config.displayConfigId && (
            <span className="qd-station-tag" style={{ background: 'rgba(0,188,212,0.3)', marginLeft: 8, fontSize: '0.85em', fontWeight: 700, letterSpacing: 0.5 }}>
              📺 {config.displayConfigName || config.displayConfigId}
              {config.displayChannels.length > 0 && <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 5 }}>({config.displayChannels.length} ช่อง)</span>}
            </span>
          )}
        </span>
        <div className="qd-controls">
          {config.showClock && (
            <span className="qd-clock" style={{ color: config.clockColor }}>
              {clock.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            className={`qd-hdr-btn qd-sound-btn${config.soundEnabled ? ' on' : ''}`}
            onClick={() => setConfig(c => ({ ...c, soundEnabled: !c.soundEnabled }))}
          >
            {config.soundEnabled ? '🔊' : '🔇'} เสียง
          </button>
          <div className="qd-fs-ctrl">
            <button onClick={() => setConfig(c => ({ ...c, fontSize: Math.max(2, +(c.fontSize - 0.5).toFixed(1)) }))}>−</button>
            <span>{config.fontSize.toFixed(1)}</span>
            <button onClick={() => setConfig(c => ({ ...c, fontSize: Math.min(20, +(c.fontSize + 0.5).toFixed(1)) }))}>+</button>
          </div>
          <button
            className={`qd-hdr-btn${config.showNoShowPanel ? ' on' : ''}`}
            onClick={() => setConfig(c => ({ ...c, showNoShowPanel: !c.showNoShowPanel }))}
            title={config.showNoShowPanel ? 'ซ่อนคิวไม่มา' : 'แสดงคิวไม่มา'}
            style={{ background: config.showNoShowPanel ? 'rgba(239,83,80,0.25)' : 'rgba(255,255,255,0.1)' }}
          >
            {config.showNoShowPanel ? '🔴' : '⚫'} ไม่มา
          </button>
          <button className="qd-hdr-btn" onClick={openSettings}>⚙ ตั้งค่าหน้าจอ</button>
        </div>
      </header>

      {/* ─── BODY ────────────────────────────────────────────── */}
      <div className={`qd-body${config.layout === 'callboard' ? ' qd-body-callboard' : ''}`}>

        {/* ── Main content: table columns or callboard ─────────── */}
        {config.layout === 'callboard'
          ? renderCallboard()
          : columnGroups.map((sps, colIdx) => renderColumn(sps, colIdx))}

        {/* ── Right panel: เรียกแล้วไม่มา ──────────────────── */}
        {config.showNoShowPanel && <div
          className="qd-right"
          style={{ background: config.rightPanelBg, width: config.rightPanelWidth, minWidth: config.rightPanelWidth }}
        >
          <div className="qd-right-hd" style={{ background: config.rightPanelHeaderBg, color: config.rightPanelHeaderColor }}>
            {config.rightPanelLabel}
            {filteredNoShow.length > 0 && (
              <span className="qd-right-count">{filteredNoShow.length}</span>
            )}
          </div>
          <div className="qd-right-body">
            {filteredNoShow.length === 0 ? (
              <span className="qd-right-empty">ไม่มีรายการ</span>
            ) : (
              <div className="qd-noshow-list">
                {[...filteredNoShow].sort((a, b) => (b.calledAt || '').localeCompare(a.calledAt || '')).slice(0, config.rightPanelMaxItems).map((item) => {
                  const badge = extractBadge(item.queueNo)
                  return (
                    <div key={item.vn} className="qd-noshow-item"
                      style={{ height: config.noShowItemHeight, minHeight: config.noShowItemHeight }}>
                      <div className="qd-noshow-queue">
                        {badge && <span className="qd-right-badge">{badge}</span>}
                        <span className="qd-noshow-no" style={{ color: config.rightPanelQueueColor, fontSize: `${config.rightPanelFontSize}vw` }}>
                          {item.queueNo}
                        </span>
                      </div>
                      <div className="qd-noshow-sp">
                        {item.servicePoint} · {item.calledAt}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>}
      </div>

      {/* ─── FOOTER ──────────────────────────────────────────── */}
      {config.showFooter && (
        <footer className="qd-footer" style={{ background: config.footerBg, color: config.footerTextColor, height: config.footerHeight }}>
          <div className="qd-marquee" style={marqueeStyle}><span>{config.marqueeText}</span></div>
        </footer>
      )}

      {/* ─── SETTINGS PANEL ──────────────────────────────────── */}
      {showSettings && (
        <div className="qd-overlay">
          <div className="qd-panel" onClick={e => e.stopPropagation()} style={{ fontFamily: fontFace }}>
            <div className="qd-panel-hd">
              <h3>⚙ ตั้งค่าการแสดงผล</h3>
              <button className="qd-panel-close" onClick={closeSettingsWithoutSaving}>✕</button>
            </div>
            <div className="qd-panel-body">

              {/* ── รูปแบบจอแสดงผล ── */}
              <SSec>รูปแบบจอแสดงผล</SSec>
              <SRow label="เลย์เอาต์">
                <div className="qd-radio-group">
                  <label className="qd-radio-label">
                    <input type="radio" name="qd-layout" value="table"
                      checked={config.layout === 'table'}
                      onChange={() => setConfig(c => ({ ...c, layout: 'table' }))} />
                    ตาราง
                  </label>
                  <label className="qd-radio-label">
                    <input type="radio" name="qd-layout" value="callboard"
                      checked={config.layout === 'callboard'}
                      onChange={() => setConfig(c => ({ ...c, layout: 'callboard' }))} />
                    บอร์ดเรียกคิว
                  </label>
                </div>
              </SRow>
              {config.layout === 'callboard' && <>
                <SRow label="หัวคอลัมน์ ส่วนที่ 1">
                  <input className="input" value={config.cbHeader1}
                    placeholder="เช่น คิวที่กำลังเรียก"
                    onChange={e => setConfig(c => ({ ...c, cbHeader1: e.target.value }))} />
                </SRow>
                <SRow label="สีพื้นหลัง ส่วนที่ 1 (คิวปัจจุบัน)">
                  <CInput value={config.cbBg1} onChange={v => setConfig(c => ({ ...c, cbBg1: v }))} />
                </SRow>
                <SRow label={`ขนาดตัวอักษร ส่วนที่ 1 (คิวปัจจุบัน): ${config.cbFontSize1}vw`}>
                  <input type="range" min="4" max="22" step="0.5" value={config.cbFontSize1}
                    onChange={e => setConfig(c => ({ ...c, cbFontSize1: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ความกว้าง ส่วนที่ 1: ${config.cbLeftSize}%`} hint="ปรับให้เล็กลงเมื่อส่วนที่ 2 มีหลายคอลัมน์ จะได้มีที่ว่างพอ">
                  <input type="range" min="20" max="80" step="1" value={config.cbLeftSize}
                    onChange={e => setConfig(c => ({ ...c, cbLeftSize: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ขนาดตัวอักษรป้าย "ช่อง X" ส่วนที่ 1: ${config.cbSpLabelFontSize}vw`}>
                  <input type="range" min="0.5" max="6" step="0.1" value={config.cbSpLabelFontSize}
                    onChange={e => setConfig(c => ({ ...c, cbSpLabelFontSize: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ขนาดตัวอักษรหัวคอลัมน์: ${config.cbHeaderFontSize}px`} hint="ใช้ร่วมกันทั้งหัวส่วนที่ 1 และหัวส่วนที่ 2 ให้อยู่ระดับเดียวกัน">
                  <input type="range" min="8" max="32" step="1" value={config.cbHeaderFontSize}
                    onChange={e => setConfig(c => ({ ...c, cbHeaderFontSize: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ความสูงหัวคอลัมน์: ${config.cbHeaderHeight}px`}>
                  <input type="range" min="24" max="120" step="2" value={config.cbHeaderHeight}
                    onChange={e => setConfig(c => ({ ...c, cbHeaderHeight: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label="สีพื้นหลัง ส่วนที่ 2 (ช่องบริการ)">
                  <CInput value={config.cbBg2} onChange={v => setConfig(c => ({ ...c, cbBg2: v }))} />
                </SRow>
                <SRow label={`ขนาดตัวอักษร ส่วนที่ 2 (ช่องบริการ): ${config.cbFontSize2}vw`}>
                  <input type="range" min="2" max="12" step="0.5" value={config.cbFontSize2}
                    onChange={e => setConfig(c => ({ ...c, cbFontSize2: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ขนาดตัวอักษร กล่อง "ช่อง" ส่วนที่ 2: ${config.cbSpFontSize2}vw`} hint="แยกจากขนาดตัวอักษรช่องเรียกของจอตาราง">
                  <input type="range" min="0.5" max="8" step="0.1" value={config.cbSpFontSize2}
                    onChange={e => setConfig(c => ({ ...c, cbSpFontSize2: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label="แสดงคิวที่รอถัดไป">
                  <Tog checked={config.showUpcoming} onChange={v => setConfig(c => ({ ...c, showUpcoming: v }))} />
                </SRow>
                {config.showUpcoming && (<>
                  <SRow label="ประเภทคิว (ดึงคิวถัดไปตามโหมดนี้)">
                    <div className="qd-radio-group">
                      {([
                        ['slot', 'Queue_Prefix'],
                        ['slot_cur', 'Queue_Prefix_Room'],
                        ['opd', 'Queue_OPD'],
                        ['cur_dep', 'Queue_OPD_Room'],
                      ] as const).map(([val, label]) => (
                        <label key={val} className="qd-radio-label">
                          <input type="radio" name="qd-upcoming-mode" value={val}
                            checked={config.upcomingQueueMode === val}
                            onChange={() => setConfig(c => ({ ...c, upcomingQueueMode: val }))} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </SRow>
                  <SRow label={`จำนวนคิวที่แสดง: ${config.upcomingCount} คิว`}>
                    <input type="range" min="1" max="15" step="1" value={config.upcomingCount}
                      onChange={e => setConfig(c => ({ ...c, upcomingCount: Number(e.target.value) }))}
                      className="qd-slider" />
                  </SRow>
                  <SRow label="ห้องตรวจที่จะดึงคิวถัดไป">
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      {config.filterDepts.length === 0 ? 'ทุกห้องตรวจ' : `${config.filterDepts.length} ห้องตรวจ (ตามรายการ "กรองแผนกที่แสดง" ด้านล่าง)`}
                    </span>
                  </SRow>
                </>)}
              </>}

              {/* ── ทั่วไป ── */}
              <SSec>ข้อมูลจุดบริการ (แสดงบนจอนี้)</SSec>
              <SRow label="ชื่อระบบ">
                <input className="input" value={config.title}
                  onChange={e => setConfig(c => ({ ...c, title: e.target.value }))} />
              </SRow>
              <SRow label="ชื่อจุดบริการ / ห้อง">
                <input className="input" value={config.displayStation}
                  placeholder="เช่น ซักประวัติ ทั่วไป, อายุรกรรม"
                  onChange={e => setConfig(c => ({ ...c, displayStation: e.target.value }))} />
              </SRow>
              <SRow label="กรองแผนกที่แสดง">
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  {config.filterDepts.length === 0 ? 'ทุกแผนก' : `${config.filterDepts.length} แผนก`}
                </span>
              </SRow>
              {availDepts.length > 0 ? (
                <div className="qd-dept-checks">
                  {availDepts.map(d => (
                    <label key={d} className="qd-dept-check-item">
                      <input type="checkbox"
                        checked={config.filterDepts.includes(d)}
                        onChange={() => toggleFilterDept(d)} />
                      <span>{d}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '4px 0' }}>
                  (โหลดรายการแผนกจากฐานข้อมูล...)
                </div>
              )}

              {/* ── Header ── */}
              <SSec>ส่วนหัว (Header)</SSec>
              <SRow label="สีพื้นหลัง Header">
                <CInput value={config.headerBg} onChange={v => setConfig(c => ({ ...c, headerBg: v }))} />
              </SRow>
              <SRow label="สีข้อความ Header">
                <CInput value={config.headerTextColor} onChange={v => setConfig(c => ({ ...c, headerTextColor: v }))} />
              </SRow>
              <SRow label="สีนาฬิกา">
                <CInput value={config.clockColor} onChange={v => setConfig(c => ({ ...c, clockColor: v }))} />
              </SRow>
              <SRow label="แสดงนาฬิกา">
                <Tog checked={config.showClock} onChange={v => setConfig(c => ({ ...c, showClock: v }))} />
              </SRow>
              <SRow label="เสียงแจ้งเตือน">
                <Tog checked={config.soundEnabled} onChange={v => setConfig(c => ({ ...c, soundEnabled: v }))} />
              </SRow>

              {/* ── ตาราง ── */}
              <SSec>ตาราง (หัวคอลัมน์และสี)</SSec>
              <SRow label="หัวคอลัมน์ช่องเรียก">
                <input className="input" value={config.colSpHeader}
                  onChange={e => setConfig(c => ({ ...c, colSpHeader: e.target.value }))} />
              </SRow>
              <SRow label="หัวคอลัมน์แสดงคิว">
                <input className="input" value={config.colQueueHeader}
                  onChange={e => setConfig(c => ({ ...c, colQueueHeader: e.target.value }))} />
              </SRow>
              <SRow label="สีพื้นหัวตาราง (คิว)">
                <CInput value={config.tableHeaderBg} onChange={v => setConfig(c => ({ ...c, tableHeaderBg: v }))} />
              </SRow>
              <SRow label="สีข้อความหัวตาราง">
                <CInput value={config.tableHeaderColor} onChange={v => setConfig(c => ({ ...c, tableHeaderColor: v }))} />
              </SRow>
              <SRow label="สีพื้นหัวคอลัมน์ช่องบริการ">
                <CInput value={config.spHeaderBg} onChange={v => setConfig(c => ({ ...c, spHeaderBg: v }))} />
              </SRow>
              <SRow label="สีตัวอักษรหัวคอลัมน์ช่องบริการ">
                <CInput value={config.spHeaderColor} onChange={v => setConfig(c => ({ ...c, spHeaderColor: v }))} />
              </SRow>
              <SRow label="สีพื้นคอลัมน์ช่องเรียก (แถวข้อมูล)">
                <CInput value={config.spColumnBg} onChange={v => setConfig(c => ({ ...c, spColumnBg: v }))} />
              </SRow>
              <SRow label="สีตัวอักษรช่องเรียก (แถวข้อมูล)">
                <CInput value={config.spColumnColor} onChange={v => setConfig(c => ({ ...c, spColumnColor: v }))} />
              </SRow>
              <SRow label="สีพื้นช่องแสดงคิว">
                <CInput value={config.queueBg} onChange={v => setConfig(c => ({ ...c, queueBg: v }))} />
              </SRow>
              <SRow label="สีตัวเลขคิว">
                <CInput value={config.queueColor} onChange={v => setConfig(c => ({ ...c, queueColor: v }))} />
              </SRow>
              <SSec>เส้นขอบตาราง</SSec>
              <SRow label="สีเส้นขอบ">
                <CInput value={config.borderColor} onChange={v => setConfig(c => ({ ...c, borderColor: v }))} />
              </SRow>
              <SRow label={`ความหนาเส้นขอบ: ${config.borderWidth}px`}>
                <input type="range" min="0" max="10" step="1" value={config.borderWidth}
                  onChange={e => setConfig(c => ({ ...c, borderWidth: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>

              <SSec>คอลัมน์ช่องบริการ</SSec>
              <SRow label="แสดงคอลัมน์ช่องบริการ">
                <Tog checked={config.spColumnVisible !== false} onChange={v => setConfig(c => ({ ...c, spColumnVisible: v }))} />
              </SRow>
              <SRow label={`ความกว้างคอลัมน์: ${config.spColumnWidth}px`}>
                <input type="range" min="60" max="500" step="5" value={config.spColumnWidth}
                  onChange={e => setConfig(c => ({ ...c, spColumnWidth: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`ขนาดตัวอักษร ช่องเรียก: ${config.spFontSize}vw`}>
                <input type="range" min="1" max="20" step="0.5" value={config.spFontSize}
                  onChange={e => setConfig(c => ({ ...c, spFontSize: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`ขนาดตัวอักษร ช่องแสดงคิว: ${config.fontSize}vw`}>
                <input type="range" min="1" max="20" step="0.5" value={config.fontSize}
                  onChange={e => setConfig(c => ({ ...c, fontSize: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>

              {/* ── Multi-column layout ── */}
              <SSec>การจัดเรียงคอลัมน์</SSec>
              <SRow label="จำนวนคอลัมน์">
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4].map(n => (
                    <button key={n}
                      className={`qd-col-count-btn${config.numColumns === n ? ' active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, numColumns: n }))}>
                      {n}
                    </button>
                  ))}
                </div>
              </SRow>

              {/* ── ช่องบริการ ── */}
              {/* ใช้ baseSPs (ทุกช่อง ไม่กรอง hiddenSPs) ไม่งั้นช่องที่ปิดไว้จะหายจากลิสต์นี้ไปด้วย เปิดกลับไม่ได้ */}
              <SSec>ช่องบริการ (เปิด/ปิด + ชื่อที่แสดง{config.numColumns > 1 ? ' + คอลัมน์ (ฟ้า) + แถว (เขียว)' : ''})</SSec>
              {baseSPs.length === 0 ? (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', padding: '4px 0' }}>ยังไม่มีช่องบริการ</div>
              ) : (
                baseSPs.map(sp => {
                  const isVisible = !config.hiddenSPs.includes(sp.id) && !config.hiddenSPs.includes(sp.name)
                  const displayName = config.spDisplayNames[sp.id] || ''
                  const colVal = config.spColumns[sp.id] ?? config.spColumns[sp.name] ?? 1
                  const rowVal = config.spRows[sp.id] ?? config.spRows[sp.name] ?? 1
                  return (
                    <div key={sp.id} className="qd-sp-row">
                      <Tog checked={isVisible} onChange={() => toggleSPVisibility(sp)} />
                      <span className="qd-sp-sys-name">{sp.name}</span>
                      <input
                        className="input qd-sp-name-input"
                        placeholder={`ชื่อบนจอ (ค่าเริ่ม: ${sp.name})`}
                        value={displayName}
                        onChange={e => setSpDisplayName(sp, e.target.value)}
                      />
                      {config.numColumns > 1 && (
                        <>
                          <select
                            className="input qd-sp-col-select"
                            value={colVal}
                            title="คอลัมน์"
                            onChange={e => setConfig(c => ({ ...c, spColumns: { ...c.spColumns, [sp.id]: Number(e.target.value) } }))}
                          >
                            {Array.from({ length: config.numColumns }, (_, i) => (
                              <option key={i + 1} value={i + 1}>คอล {i + 1}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            className="input qd-sp-row-input"
                            min={1}
                            max={99}
                            value={rowVal}
                            title="ลำดับแถว"
                            onChange={e => setConfig(c => ({ ...c, spRows: { ...c.spRows, [sp.id]: Math.max(1, Number(e.target.value) || 1) } }))}
                          />
                        </>
                      )}
                    </div>
                  )
                })
              )}

              {/* ── แผงขวา ── */}
              <SSec>แผงเรียกแล้วไม่มา (ด้านขวา)</SSec>
              <SRow label="ป้ายกำกับ">
                <input className="input" value={config.rightPanelLabel}
                  onChange={e => setConfig(c => ({ ...c, rightPanelLabel: e.target.value }))} />
              </SRow>
              <SRow label={`ความกว้างแผง: ${config.rightPanelWidth}px`}>
                <input type="range" min="120" max="600" step="10" value={config.rightPanelWidth}
                  onChange={e => setConfig(c => ({ ...c, rightPanelWidth: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`ขนาดตัวเลขหลัก: ${config.rightPanelFontSize}vw`}>
                <input type="range" min="2" max="20" step="0.5" value={config.rightPanelFontSize}
                  onChange={e => setConfig(c => ({ ...c, rightPanelFontSize: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`จำนวนแสดงสูงสุด: ${config.rightPanelMaxItems} รายการ`}>
                <input type="range" min="1" max="20" step="1" value={config.rightPanelMaxItems}
                  onChange={e => setConfig(c => ({ ...c, rightPanelMaxItems: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`ความสูงต่อรายการ: ${config.noShowItemHeight}px`}>
                <input type="range" min="40" max="200" step="4" value={config.noShowItemHeight}
                  onChange={e => setConfig(c => ({ ...c, noShowItemHeight: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label="สีพื้นหลัง">
                <CInput value={config.rightPanelBg} onChange={v => setConfig(c => ({ ...c, rightPanelBg: v }))} />
              </SRow>
              <SRow label="สีพื้นหัว">
                <CInput value={config.rightPanelHeaderBg} onChange={v => setConfig(c => ({ ...c, rightPanelHeaderBg: v }))} />
              </SRow>
              <SRow label="สีข้อความหัว">
                <CInput value={config.rightPanelHeaderColor} onChange={v => setConfig(c => ({ ...c, rightPanelHeaderColor: v }))} />
              </SRow>
              <SRow label="สีตัวเลขคิว">
                <CInput value={config.rightPanelQueueColor} onChange={v => setConfig(c => ({ ...c, rightPanelQueueColor: v }))} />
              </SRow>

              {/* ── ฟ้อนต์/แอนิเมชัน ── */}
              <SSec>ฟ้อนต์และแอนิเมชัน</SSec>
              <SRow label="ฟ้อนต์">
                <select className="input" value={config.font}
                  onChange={e => setConfig(c => ({ ...c, font: e.target.value }))}>
                  {(systemFonts.length > 0
                    ? systemFonts
                    : ['Sarabun', 'Prompt', 'Kanit', 'Tahoma', 'Arial', 'Angsana New', 'CordiaNew', 'TH SarabunPSK']
                  ).map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </SRow>
              <SRow label={`ขนาดตัวเลขคิว: ${config.fontSize}vw`}>
                <input type="range" min="2" max="20" step="0.5" value={config.fontSize}
                  onChange={e => setConfig(c => ({ ...c, fontSize: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label="แอนิเมชัน">
                <div className="qd-radio-group">
                  {(['fade', 'slide', 'scale', 'bounce'] as const).map(a => (
                    <label key={a} className="qd-radio-label">
                      <input type="radio" name="qd-anim" value={a}
                        checked={config.animationType === a}
                        onChange={() => setConfig(c => ({ ...c, animationType: a }))} />
                      {a}
                    </label>
                  ))}
                </div>
              </SRow>

              {/* ── กระพริบขณะเรียกคิว ── */}
              <SSec>กระพริบขณะเรียกคิว</SSec>
              <SRow label="เปิดใช้กระพริบ">
                <Tog checked={config.blinkEnabled} onChange={v => setConfig(c => ({ ...c, blinkEnabled: v }))} />
              </SRow>
              {config.blinkEnabled && <>
                <SRow label="สีกระพริบ">
                  <CInput value={config.blinkColor} onChange={v => setConfig(c => ({ ...c, blinkColor: v }))} />
                </SRow>
                <SRow label="กระพริบที่">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([['bg', 'พื้นหลัง'], ['text', 'ตัวอักษร']] as const).map(([v, label]) => (
                      <button key={v} type="button"
                        onClick={() => setConfig(c => ({ ...c, blinkTarget: v }))}
                        className={config.blinkTarget === v ? 'qd-seg-on' : 'qd-seg'}
                        style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                          border: '1.5px solid #90caf9', background: config.blinkTarget === v ? '#1565c0' : '#fff',
                          color: config.blinkTarget === v ? '#fff' : '#1565c0' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </SRow>
                <SRow label={`จำนวนครั้ง: ${config.blinkCount} ครั้ง`}>
                  <input type="range" min="1" max="20" step="1" value={config.blinkCount}
                    onChange={e => setConfig(c => ({ ...c, blinkCount: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ความเร็ว: ${config.blinkSpeed} ms`} hint="ค่าน้อย = เร็ว">
                  <input type="range" min="100" max="1000" step="50" value={config.blinkSpeed}
                    onChange={e => setConfig(c => ({ ...c, blinkSpeed: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <div style={{ padding: '4px 0 4px 8px' }}>
                  <button
                    className="qd-tts-play-btn"
                    style={{ fontSize: 12, padding: '5px 14px' }}
                    onClick={() => {
                      const sp = visibleSPs[0]?.name || visibleSPs[0]?.id
                      if (!sp) return
                      clearTimeout(blinkTimers.current[sp])
                      setBlinkingSPs(prev => new Set([...prev, sp]))
                      blinkTimers.current[sp] = setTimeout(() => {
                        setBlinkingSPs(prev => { const n = new Set(prev); n.delete(sp); return n })
                      }, config.blinkCount * config.blinkSpeed * 2 + 400)
                    }}
                  >▶ ทดสอบกระพริบ</button>
                </div>
              </>}

              {/* ── เสียงประกาศ TTS ── */}
              <SSec>เสียงประกาศ (Text-to-Speech)</SSec>
              <SRow label="เปิดใช้เสียงประกาศ">
                <Tog checked={config.ttsEnabled} onChange={v => setConfig(c => ({ ...c, ttsEnabled: v }))} />
              </SRow>

              <SRow label="แสดง/อ่านชื่อคนไข้" hint="แสดงชื่อบนจอ + อ่านแทนเลขคิว">
                <div style={{ opacity: config.ttsEnabled ? 1 : 0.4, pointerEvents: config.ttsEnabled ? 'auto' : 'none' }}>
                  <Tog checked={config.ttsShowName} onChange={handleToggleShowName} />
                </div>
              </SRow>

              {config.ttsShowName && (
                <SRow label="ปิดนามสกุล (XXXX)" hint="แสดง XXXX แทน 4 ตัวท้ายนามสกุล">
                  <Tog checked={config.maskLastName} onChange={v => setConfig(c => ({ ...c, maskLastName: v }))} />
                </SRow>
              )}

              {config.ttsEnabled && <>
                <SRow label="แหล่งเสียง">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={`qd-tts-src-btn${config.ttsSource !== 'server' ? ' active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, ttsSource: 'browser' }))}
                    >🌐 Browser (เครื่องนี้)</button>
                    <button
                      className={`qd-tts-src-btn${config.ttsSource === 'server' ? ' active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, ttsSource: 'server' }))}
                    >🖥 Server (Host)</button>
                  </div>
                </SRow>

                {config.ttsSource === 'server' && (
                  <div className="qd-tts-warn" style={{ background: 'rgba(0,188,100,0.12)', borderLeft: '3px solid #00c864' }}>
                    ✅ เสียงจะสังเคราะห์บนเครื่อง Host แล้วส่งไปทุกเครื่อง
                    {serverTtsVoices.length === 0 && <><br/><small>⚠ ไม่พบเสียง SAPI บน Host — ติดตั้ง Thai Language Pack</small></>}
                  </div>
                )}

                <div className="qd-tts-preview-wrap">
                  <div className="qd-tts-template">
                    <span className="qd-tts-seg edit">{config.ttsPrefix1 || '…'}</span>
                    <span className="qd-tts-seg var">A001</span>
                    <span className="qd-tts-seg edit">{config.ttsMiddle || '…'}</span>
                    <span className="qd-tts-seg var">1</span>
                    <span className="qd-tts-seg edit">{config.ttsSuffix || '…'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="qd-tts-play-btn" onClick={previewTTS}
                      disabled={previewState === 'loading'}
                      style={previewState === 'ok' ? { background: '#16a34a' } : previewState === 'err' ? { background: '#dc2626' } : {}}>
                      {previewState === 'loading' ? '⟳ กำลังสร้าง…' : previewState === 'ok' ? '✓ สำเร็จ' : previewState === 'err' ? '✗ ไม่สำเร็จ' : '▶ ทดสอบเสียง'}
                    </button>
                    {previewState === 'err' && previewError && (
                      <div style={{ fontSize: 11, color: '#fca5a5', background: 'rgba(220,38,38,0.15)', padding: '4px 8px', borderRadius: 6, wordBreak: 'break-all' }}>
                        {previewError}
                      </div>
                    )}
                  </div>
                </div>

                <SRow label="ข้อความก่อนเลขคิว">
                  <input className="input" value={config.ttsPrefix1}
                    onChange={e => setConfig(c => ({ ...c, ttsPrefix1: e.target.value }))} />
                </SRow>
                <SRow label="ข้อความก่อนเลขช่อง">
                  <input className="input" value={config.ttsMiddle}
                    onChange={e => setConfig(c => ({ ...c, ttsMiddle: e.target.value }))} />
                </SRow>
                <SRow label="ข้อความปิดท้าย">
                  <input className="input" value={config.ttsSuffix}
                    onChange={e => setConfig(c => ({ ...c, ttsSuffix: e.target.value }))} />
                </SRow>

                <SRow label="เสียง (Voice)">
                  {config.ttsSource === 'server' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select className="input" value={config.ttsServerVoiceName}
                        onChange={e => setConfig(c => ({ ...c, ttsServerVoiceName: e.target.value }))}
                        disabled={loadingVoices}>
                        <option value="">{loadingVoices ? 'กำลังโหลด…' : serverTtsVoices.length === 0 ? 'ไม่พบเสียง' : 'อัตโนมัติ (อาจารา ไทย)'}</option>
                        {serverTtsVoices.map(v => {
                          const labels: Record<string, string> = {
                            'th-TH-Google':          '🇹🇭 Google TTS (ไทย) — เร็ว ~400ms',
                            'th-TH-AcharaNeural':    '🇹🇭 อาจารา (ไทย หญิง) — Neural',
                            'th-TH-NiwatNeural':     '🇹🇭 นิวัตร (ไทย ชาย) — Neural',
                            'th-TH-PremwadeeNeural': '🇹🇭 เปรมวดี (ไทย หญิง) — Neural',
                          }
                          return <option key={v} value={v}>{labels[v] ?? v}</option>
                        })}
                      </select>
                      <button className="qd-tts-play-btn" onClick={refreshServerVoices} disabled={loadingVoices}
                        title="โหลดรายการเสียงใหม่" style={{ padding: '7px 10px', flexShrink: 0 }}>
                        {loadingVoices ? '⟳' : '🔄'}
                      </button>
                    </div>
                  ) : (
                  <select className="input" value={config.ttsVoiceName}
                    onChange={e => setConfig(c => ({ ...c, ttsVoiceName: e.target.value }))}>
                    <option value="">อัตโนมัติ (ไทย)</option>
                    {ttsVoices
                      .filter(v => v.lang.startsWith('th') || v.lang.startsWith('TH'))
                      .map(v => (
                        <option key={v.name} value={v.name}>
                          {v.name} {v.localService ? '' : '(online)'}
                        </option>
                      ))
                    }
                    {ttsVoices.filter(v => !v.lang.startsWith('th') && !v.lang.startsWith('TH')).length > 0 && (
                      <optgroup label="─── เสียงอื่น ───">
                        {ttsVoices
                          .filter(v => !v.lang.startsWith('th') && !v.lang.startsWith('TH'))
                          .map(v => (
                            <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                          ))
                        }
                      </optgroup>
                    )}
                  </select>
                  )}
                </SRow>

                <SRow label={`ความเร็ว: ${config.ttsRate.toFixed(1)}x`}>
                  <input type="range" min="0.5" max="2" step="0.1" value={config.ttsRate}
                    onChange={e => setConfig(c => ({ ...c, ttsRate: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ระดับเสียง: ${Math.round(config.ttsPitch * 100)}%`}>
                  <input type="range" min="0.5" max="2" step="0.1" value={config.ttsPitch}
                    onChange={e => setConfig(c => ({ ...c, ttsPitch: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>
                <SRow label={`ความดัง: ${Math.round(config.ttsVolume * 100)}%`}>
                  <input type="range" min="0" max="1" step="0.05" value={config.ttsVolume}
                    onChange={e => setConfig(c => ({ ...c, ttsVolume: Number(e.target.value) }))}
                    className="qd-slider" />
                </SRow>

                {ttsVoices.filter(v => v.lang.startsWith('th')).length === 0 && (
                  <div className="qd-tts-warn">
                    ⚠ ไม่พบเสียงภาษาไทย — กรุณาติดตั้ง Thai Language Pack บน Windows<br/>
                    <small>Settings → Time &amp; Language → Language → Add Thai → Speech</small>
                  </div>
                )}
              </>}

              {/* ── ประกาศด้านล่าง (Footer) ── */}
              <SSec>ประกาศด้านล่าง (Footer)</SSec>
              <SRow label={`ความสูงแถบประกาศ: ${config.footerHeight}px`}>
                <input type="range" min="24" max="400" step="2" value={config.footerHeight}
                  onChange={e => setConfig(c => ({ ...c, footerHeight: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label="แสดงแถบประกาศ">
                <Tog checked={config.showFooter} onChange={v => setConfig(c => ({ ...c, showFooter: v }))} />
              </SRow>
              <SRow label="ข้อความประกาศ">
                <input className="input" value={config.marqueeText}
                  onChange={e => setConfig(c => ({ ...c, marqueeText: e.target.value }))} />
              </SRow>
              <SRow label={`ขนาดตัวอักษร: ${config.footerFontSize}px`}>
                <input type="range" min="12" max="120" step="1" value={config.footerFontSize}
                  onChange={e => setConfig(c => ({ ...c, footerFontSize: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label={`ความเร็ว: ${config.footerScrollSpeed}s`}>
                <input type="range" min="5" max="120" step="5" value={config.footerScrollSpeed}
                  onChange={e => setConfig(c => ({ ...c, footerScrollSpeed: Number(e.target.value) }))}
                  className="qd-slider" />
              </SRow>
              <SRow label="สีพื้นหลัง Footer">
                <CInput value={config.footerBg} onChange={v => setConfig(c => ({ ...c, footerBg: v }))} />
              </SRow>
              <SRow label="สีข้อความ Footer">
                <CInput value={config.footerTextColor} onChange={v => setConfig(c => ({ ...c, footerTextColor: v }))} />
              </SRow>
            </div>
            <div className="qd-panel-ft">
              {saveDefaultMsg && <span className="qd-default-msg">{saveDefaultMsg}</span>}
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>ยกเลิก</button>
              <button className="btn qd-btn-default" onClick={saveAsDefault}
                title={URL_DISPLAY_ID ? `บันทึกการตั้งค่าเฉพาะจอนี้ (${config.displayConfigName || URL_DISPLAY_ID})` : 'บันทึกเป็นค่าเริ่มต้นของระบบ (ทุกเครื่อง)'}>
                {URL_DISPLAY_ID ? '💾 บันทึกการตั้งค่าจอนี้' : '📌 ตั้งเป็นค่าเริ่มต้น'}
              </button>
              <button className="btn btn-primary" onClick={saveConfig}>💾 บันทึกและปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Password Dialog: ยืนยันเปิดแสดงชื่อคนไข้ ─── */}
      {showNamePwdDialog && (
        <div className="qd-overlay" style={{ zIndex: 1000 }} onClick={() => setShowNamePwdDialog(false)}>
          <div className="qd-pwd-modal" onClick={e => e.stopPropagation()}>
            <div className="qd-pwd-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="11" width="18" height="11" rx="2" stroke="#F57C00" strokeWidth="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#F57C00" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="qd-pwd-title">ยืนยันการเปิดใช้งาน</h3>
            <p className="qd-pwd-desc">กรอกรหัสผ่านเพื่อเปิดฟังก์ชันแสดงชื่อคนไข้</p>
            <input
              ref={namePwdRef}
              className={`input qd-pwd-input${namePwdError ? ' error' : ''}`}
              type="password"
              placeholder="รหัสผ่าน"
              value={namePwd}
              onChange={e => { setNamePwd(e.target.value); setNamePwdError(false) }}
              onKeyDown={e => { if (e.key === 'Enter') confirmNamePwd(); if (e.key === 'Escape') setShowNamePwdDialog(false) }}
            />
            {namePwdError && <p className="qd-pwd-error">รหัสผ่านไม่ถูกต้อง</p>}
            <div className="qd-pwd-actions">
              <button className="btn btn-ghost" onClick={() => setShowNamePwdDialog(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={confirmNamePwd}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── AUDIO UNLOCK OVERLAY ─────────────────────────────── */}
      {audioUnlocked === false && !(typeof window !== 'undefined' && (window as any).electronAPI) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', cursor: 'pointer' }}
          onClick={() => {
            const el = new Audio()
            el.muted = true
            el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
            el.play().catch(() => {}).finally(() => { el.pause(); setAudioUnlocked(true) })
          }}
        >
          <div style={{ background: '#1a2a4a', border: '2px solid #00bcd4', borderRadius: 16, padding: '40px 60px', textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔊</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>แตะเพื่อเปิดเสียง</div>
            <div style={{ fontSize: '0.9rem', opacity: 0.7 }}>Tap to enable audio</div>
          </div>
        </div>
      )}

    </div>
  )
}

function SRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="qd-setting-row">
      <label>{label}{hint && <span style={{ fontSize: 11, color: '#90A4AE', fontWeight: 400, marginLeft: 5 }}>({hint})</span>}</label>
      {children}
    </div>
  )
}

function SSec({ children }: { children: React.ReactNode }) {
  return <div className="qd-section-label">{children}</div>
}

function CInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="color-row">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <input className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
    </div>
  )
}

function Tog({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="qd-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="toggle-track" />
    </label>
  )
}
