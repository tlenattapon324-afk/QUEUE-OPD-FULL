import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getQueueList, callQueue, onQueueCalled, updateQueueStatus,
  getServicePoints, getDisplayConfigs, getDisplayQDConfig, clearDisplayQueues, getCallsToday, prewarmTTS, getLabXray, getAppointmentDoctors, type LabXrayStatus,
  getQueueStaging, moveQueuesToStaging, type QueueStagingMap
} from '../lib/api'
import './QueueCall.css'

type QueueStatus = 'waiting' | 'calling' | 'done' | 'skip'
type QueueRow = QueueItem & { status: QueueStatus }
type QueueMode = 'slot' | 'opd' | 'cur_dep' | 'slot_cur'

function getPrefsKey() {
  const officer = sessionStorage.getItem('officer') || 'default'
  return `qc_prefs_${officer}`
}

function loadSavedPrefs() {
  try {
    return JSON.parse(localStorage.getItem(getPrefsKey()) || 'null') as
      { servicePointId?: string; filterDepts?: string[]; selectedDisplayId?: string; visitFilter?: 'all' | 'appt' | 'walkin'; selectedDoctors?: string[]; selectedClinics?: string[] } | null
  } catch { return null }
}

export default function QueueCallPage() {
  const navigate = useNavigate()
  const [queues, setQueues] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(false)
  const [callingId, setCallingId] = useState<string | null>(null)

  // Display configs
  const [displayConfigs, setDisplayConfigs] = useState<DisplayConfigItem[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>(() => loadSavedPrefs()?.selectedDisplayId || '')
  const [displaySearch, setDisplaySearch] = useState('')

  // Service points (global fallback)
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([])
  const [servicePointId, setServicePointId] = useState<string>(() => loadSavedPrefs()?.servicePointId || '')

  // Derived: channels from selected display (if any)
  const selectedDisplay = displayConfigs.find(d => d.id === selectedDisplayId)
  const displayChannels = selectedDisplay?.channels || []
  const filteredDisplayConfigs = displaySearch.trim()
    ? displayConfigs.filter(d => d.name.toLowerCase().includes(displaySearch.trim().toLowerCase()))
    : displayConfigs
  const useDisplayChannels = selectedDisplayId !== '' && displayChannels.length > 0

  // Active channel name
  const activeChannelName = useDisplayChannels
    ? (servicePointId || (displayChannels[0] ?? ''))
    : (servicePoints.find(sp => sp.id === servicePointId)?.name || '')

  const [mode, setMode] = useState<QueueMode>(() => (localStorage.getItem('qc_mode') as QueueMode) || 'slot')

  const [filterDepts, setFilterDepts] = useState<string[]>(() => loadSavedPrefs()?.filterDepts || [])
  const [savedPrefsMsg, setSavedPrefsMsg] = useState(false)
  const [showDeptMenu, setShowDeptMenu] = useState(false)
  const [deptSearch, setDeptSearch] = useState('')
  const deptSearchRef = useRef<HTMLInputElement>(null)
  const [visitFilter, setVisitFilter] = useState<'all' | 'appt' | 'walkin'>(() => loadSavedPrefs()?.visitFilter || 'all')
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>(() => loadSavedPrefs()?.selectedDoctors || [])
  const [doctorList, setDoctorList] = useState<Array<{ department: string; doctor_name: string }>>([])
  const [showDoctorMenu, setShowDoctorMenu] = useState(false)
  const [doctorSearch, setDoctorSearch] = useState('')
  const doctorMenuRef = useRef<HTMLDivElement>(null)
  const doctorSearchRef = useRef<HTMLInputElement>(null)
  const [selectedClinics, setSelectedClinics] = useState<string[]>(() => loadSavedPrefs()?.selectedClinics || [])
  const [showClinicMenu, setShowClinicMenu] = useState(false)
  const [clinicSearch, setClinicSearch] = useState('')
  const clinicMenuRef = useRef<HTMLDivElement>(null)
  const clinicSearchRef = useRef<HTMLInputElement>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'waiting' | 'calling' | 'done' | 'skip'>('all')
  const [currentCalled, setCurrentCalled] = useState<{ queueNo: string; servicePoint: string; calledAt?: string } | null>(null)
  const [callTimeMap, setCallTimeMap] = useState<Record<string, string>>({})
  const [clock, setClock] = useState(new Date())
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [quickCall, setQuickCall] = useState('')
  const [quickCallMsg, setQuickCallMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [checkDisplayPopup, setCheckDisplayPopup] = useState<{ queueNo: string; sp: string; px: number; py: number } | null>(null)
  const [deptMismatchWarning, setDeptMismatchWarning] = useState<{ queueNo: string; dept: string; displayName: string; px: number; py: number } | null>(null)
  const [qdFilterDepts, setQdFilterDepts] = useState<string[]>([])
  const callNextBtnRef = useRef<HTMLButtonElement>(null)
  const [manualTab, setManualTab] = useState<'search' | 'scan'>('search')
  const [confirmEnabled, setConfirmEnabled] = useState(() => localStorage.getItem('qc_confirm') === 'true')
  const [pendingCall, setPendingCall] = useState<QueueRow | null>(null)
  const [showDisplayMenu, setShowDisplayMenu] = useState(false)
  const [showChannelMenu, setShowChannelMenu] = useState(false)
  const [channelSearch, setChannelSearch] = useState('')
  const [clearMsg, setClearMsg] = useState(false)
  const [lockedVn, setLockedVn] = useState<string | null>(null)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)

  // Queue staging board (บอร์ดเตรียมคิว) — the selected จอแสดงคิว's channels become columns; queues
  // picked from the main table are parked in a column ahead of time. Purely organisational:
  // calling still happens from the main table, so this never changes what the main page does.
  const [showBoard, setShowBoard] = useState(() => localStorage.getItem('qc_show_board') === 'true')
  const [staging, setStaging] = useState<QueueStagingMap>({})
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [boardFilter, setBoardFilter] = useState('')
  const [hiddenChannels, setHiddenChannels] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('qc_board_hidden') || '{}') } catch { return {} }
  })

  const [labXrayMap, setLabXrayMap] = useState<Record<string, LabXrayStatus>>({})
  const lastCalledVnRef = useRef<string | null>(null)
  const currentSpNameRef = useRef<string>('')
  const prewarmCtxRef = useRef<{ spName: string; displayId: string }>({ spName: '', displayId: '' })
  const isLoadingQueues = useRef(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const quickCallRef = useRef<HTMLInputElement>(null)
  const deptMenuRef = useRef<HTMLDivElement>(null)
  const displayMenuRef = useRef<HTMLDivElement>(null)
  const displaySearchRef = useRef<HTMLInputElement>(null)
  const channelMenuRef = useRef<HTMLDivElement>(null)
  const channelSearchRef = useRef<HTMLInputElement>(null)
  const isModeFirstMount = useRef(true)

  const currentSp = servicePoints.find(sp => sp.id === servicePointId)
  const currentSpName = useDisplayChannels ? activeChannelName : (currentSp?.name || '')
  currentSpNameRef.current = currentSpName

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadSP = useCallback(async () => {
    try {
      const data = await getServicePoints()
      setServicePoints(data)
      setServicePointId(prev => {
        // Validate: saved ID still exists in the list
        if (prev && data.some(sp => sp.id === prev)) return prev
        // Fallback to first SP
        return data.length > 0 ? data[0].id : prev
      })
    } catch {}
  }, [])

  const savePrefs = () => {
    localStorage.setItem(getPrefsKey(), JSON.stringify({ servicePointId, filterDepts, selectedDisplayId, visitFilter, selectedDoctors, selectedClinics }))
    setSavedPrefsMsg(true)
    setTimeout(() => setSavedPrefsMsg(false), 2500)
  }

  useEffect(() => { loadSP() }, [loadSP])
  useEffect(() => { getDisplayConfigs().then(setDisplayConfigs) }, [])

  useEffect(() => {
    try { localStorage.setItem('qc_show_board', String(showBoard)) } catch {}
  }, [showBoard])

  useEffect(() => {
    try { localStorage.setItem('qc_board_hidden', JSON.stringify(hiddenChannels)) } catch {}
  }, [hiddenChannels])

  useEffect(() => { setSelectedKeys([]); setBoardFilter('') }, [selectedDisplayId])

  const loadStaging = useCallback(() => { getQueueStaging().then(setStaging).catch(() => {}) }, [])
  useEffect(() => {
    loadStaging()
    const t = setInterval(loadStaging, 15000)
    return () => clearInterval(t)
  }, [loadStaging])
  useEffect(() => {
    getAppointmentDoctors().then(r => { if (r.success) setDoctorList(r.data) })
  }, [])

  // Sync active SP and display for mini page — always write (even empty) so mini gets fresh values
  useEffect(() => {
    localStorage.setItem('qc_active_sp', servicePointId)
    localStorage.setItem('qc_active_display', selectedDisplayId)
  }, [servicePointId, selectedDisplayId])

  const loadQueues = useCallback(async () => {
    if (isLoadingQueues.current) return // prevent concurrent loads
    isLoadingQueues.current = true
    // Restore from sessionStorage cache so the table shows immediately while fetching
    try {
      const cached = sessionStorage.getItem(`qc_queue_cache_${mode}`)
      if (cached) {
        const { rows: cachedRows } = JSON.parse(cached) as { rows: QueueRow[] }
        setQueues(prev => prev.length === 0 ? cachedRows : prev)
      }
    } catch {}
    setLoading(true)
    try {
      const [res, calls] = await Promise.all([getQueueList(mode), getCallsToday(mode)])
      if (res.success) {
        const rows = res.data as QueueRow[]
        setQueues(rows)
        try { sessionStorage.setItem(`qc_queue_cache_${mode}`, JSON.stringify({ rows })) } catch {}
        // Keyed by vn::queueNo too (not just vn) — a VN can have multiple opd_qs_slot rows
        // (Queue_Prefix), each called independently with its own time; the plain-vn entry is
        // kept only as a fallback for modes where a VN never has more than one row.
        const map: Record<string, string> = {}
        calls.forEach(c => {
          if (!c.vn || !c.calledAt) return
          map[c.vn] = c.calledAt
          if (c.queueNo) map[`${c.vn}::${c.queueNo}`] = c.calledAt
        })
        setCallTimeMap(prev => ({ ...prev, ...map }))
        setCurrentCalled(prev => {
          if (prev) return prev
          // จำกัดเฉพาะแถวที่กำลังเรียกโดยช่องบริการของเครื่องนี้ ไม่เอาของช่องอื่นมาแสดง
          const callingRows = rows.filter(r => r.status === 'calling' && r.service_point === currentSpNameRef.current)
          if (callingRows.length === 0) return null
          // A VN can have multiple opd_qs_slot rows (Queue_Prefix) each with their own call
          // entry — match by queue_slot too when the row has one, not vn alone.
          const findCall = (r: QueueRow) => calls.find(c =>
            c.vn === r.vn && (!r.queue_slot || !c.queueNo || c.queueNo === r.queue_slot)
          )
          const latest = callingRows.reduce((best, r) => {
            const t = findCall(r)?.calledAt || ''
            const bestT = findCall(best)?.calledAt || ''
            return t > bestT ? r : best
          })
          const queueNo = String(latest.queue_slot || latest.queue_no || '')
          const callEntry = findCall(latest)
          if (!lastCalledVnRef.current) lastCalledVnRef.current = latest.vn
          return { queueNo, servicePoint: latest.service_point || '', calledAt: callEntry?.calledAt }
        })
      }
    } finally {
      setLoading(false)
      isLoadingQueues.current = false
    }
  }, [mode])

  useEffect(() => {
    if (isModeFirstMount.current) {
      isModeFirstMount.current = false
    } else {
      // Restore saved prefs when switching modes — so saved servicePoint/display/depts come back
      const saved = loadSavedPrefs()
      if (saved?.filterDepts?.length) setFilterDepts(saved.filterDepts)
      else setFilterDepts([])
      if (saved?.servicePointId) setServicePointId(saved.servicePointId)
      if (saved?.selectedDisplayId) setSelectedDisplayId(saved.selectedDisplayId)
      // Clear stale data from the previous mode immediately — otherwise old mode's
      // queues stay on screen until the new fetch resolves, looking like no refresh happened.
      // Also set loading=true in the same batch so the empty-state branch doesn't flash
      // "ไม่พบข้อมูล" before loadQueues() gets a chance to set it itself.
      setQueues([])
      setLoading(true)
    }
    setCurrentCalled(null)
    loadQueues()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(loadQueues, 15000)
    return () => clearInterval(t)
  }, [loadQueues])

  // Load lab/xray status in background — slow query, refresh every 30s
  useEffect(() => {
    let cancelled = false
    const load = () => getLabXray().then(d => { if (!cancelled) setLabXrayMap(d) })
    load()
    const t = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  useEffect(() => {
    const off = onQueueCalled((data) => {
      // อัปเดตกล่อง "กำลังให้บริการ" เฉพาะเมื่อเป็นคิวที่เรียกจากช่องบริการของเครื่องนี้เท่านั้น
      // ป้องกันไม่ให้ช่องอื่นเรียกคิวพร้อมกันแล้วมาทับค่าที่แสดงอยู่
      if (data.servicePoint === currentSpName) {
        setCurrentCalled(data)
        // sync lastCalledVnRef เมื่อเรียกจาก Mini หรือแหล่งอื่น
        setQueues(prev => {
          const row = prev.find(q => String(q.queue_slot || q.queue_no || '') === String(data.queueNo))
          if (row) lastCalledVnRef.current = row.vn
          return prev
        })
      }
      isLoadingQueues.current = false
      loadQueues()
    })
    return off
  }, [loadQueues, currentSpName])


  // Keep prewarmCtxRef current + trigger prewarm whenever SP/display/queues change
  useEffect(() => {
    prewarmCtxRef.current = { spName: currentSpName, displayId: selectedDisplayId }
  }, [currentSpName, selectedDisplayId])

  useEffect(() => {
    if (!currentSpName || !selectedDisplayId) return
    const waiting = queues
      .filter(q => q.status === 'waiting')
      .slice(0, 5)
      .map(q => ({ no: String(q.queue_slot || q.queue_no || ''), name: q.queue_name || '' }))
    if (waiting.length) prewarmTTS(waiting, currentSpName, selectedDisplayId)
  }, [queues, currentSpName, selectedDisplayId])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setShowSettingsMenu(false)
    }
    if (showSettingsMenu) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettingsMenu])

  // Sync filter state → Mini popup (ผ่าน localStorage + storage event)
  useEffect(() => {
    try { localStorage.setItem('qc_filter_depts', JSON.stringify(filterDepts)) } catch {}
  }, [filterDepts])

  useEffect(() => {
    try { localStorage.setItem('qc_mode', mode) } catch {}
  }, [mode])

  useEffect(() => {
    try { localStorage.setItem('qc_visit_filter', visitFilter) } catch {}
  }, [visitFilter])

  useEffect(() => {
    try { localStorage.setItem('qc_selected_doctors', JSON.stringify(selectedDoctors)) } catch {}
  }, [selectedDoctors])

  useEffect(() => {
    try { localStorage.setItem('qc_selected_clinics', JSON.stringify(selectedClinics)) } catch {}
  }, [selectedClinics])

  // Auto-focus quick-call input and redirect barcode scanner input here
  useEffect(() => {
    quickCallRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') return
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        quickCallRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptMenuRef.current && !deptMenuRef.current.contains(e.target as Node))
        setShowDeptMenu(false)
    }
    if (showDeptMenu) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => deptSearchRef.current?.focus(), 60)
    } else {
      setDeptSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showDeptMenu])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (doctorMenuRef.current && !doctorMenuRef.current.contains(e.target as Node))
        setShowDoctorMenu(false)
    }
    if (showDoctorMenu) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => doctorSearchRef.current?.focus(), 60)
    } else {
      setDoctorSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showDoctorMenu])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clinicMenuRef.current && !clinicMenuRef.current.contains(e.target as Node))
        setShowClinicMenu(false)
    }
    if (showClinicMenu) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => clinicSearchRef.current?.focus(), 60)
    } else {
      setClinicSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showClinicMenu])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (displayMenuRef.current && !displayMenuRef.current.contains(e.target as Node))
        setShowDisplayMenu(false)
    }
    if (showDisplayMenu) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => displaySearchRef.current?.focus(), 60)
    } else {
      setDisplaySearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showDisplayMenu])

  // รับ event จาก NavBar เมื่อเลือกช่องเรียกคิว
  useEffect(() => {
    const handler = (e: Event) => {
      const { displayId, channel } = (e as CustomEvent).detail
      setSelectedDisplayId(displayId)
      setServicePointId(channel)
    }
    window.addEventListener('qc-display-selected', handler)
    return () => window.removeEventListener('qc-display-selected', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (channelMenuRef.current && !channelMenuRef.current.contains(e.target as Node))
        setShowChannelMenu(false)
    }
    if (showChannelMenu) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => channelSearchRef.current?.focus(), 60)
    } else {
      setChannelSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showChannelMenu])

  // Auto-select ช่องแรกเมื่อเลือก display และยังไม่มีช่องที่เลือก — also re-runs when the display's
  // OWN channel list changes (e.g. renamed in "จัดการหน้าจอแสดงคิว"), not just when switching
  // displays, so a stale channel id (like "1" after channels were renamed to "โต๊ะ 1") gets
  // corrected instead of silently sticking around in the dropdown.
  const displayChannelsKey = displayChannels.join(',')
  useEffect(() => {
    if (selectedDisplayId && displayChannels.length > 0 && !displayChannels.includes(servicePointId)) {
      setServicePointId(displayChannels[0])
    }
  }, [selectedDisplayId, displayChannelsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // โหลด filterDepts ของจอที่เลือก จาก qd-config
  useEffect(() => {
    if (!selectedDisplayId) { setQdFilterDepts([]); return }
    getDisplayQDConfig(selectedDisplayId).then(cfg => {
      const depts = cfg?.filterDepts
      setQdFilterDepts(Array.isArray(depts) ? (depts as string[]) : [])
    })
  }, [selectedDisplayId])

  // ── Queue handlers ──────────────────────────────────────────────────────────

  const handleCall = async (queue: QueueRow) => {
    if (confirmEnabled) { setPendingCall(queue); return }
    await doCall(queue)
  }

  const doCall = async (queue: QueueRow) => {
    // A queue parked in a board channel is called into that channel; anything else uses the selected ช่องบริการ.
    const sp = channelByKey.get(queueKeyOf(queue)) || currentSpName
    // Main page is calling — clear mini flag so opener does NOT refocus mini
    ;(window as any).__miniCalledAt = null
    // ตรวจว่าจอที่เลือกกรองแผนก และแผนกคนไข้ไม่ตรง → ห้ามเรียก (ใช้ state ที่ sync แล้ว)
    if (qdFilterDepts.length > 0 && queue.department && !qdFilterDepts.includes(queue.department)) {
      const selDisplay = displayConfigs.find(d => d.id === selectedDisplayId)
      const r = callNextBtnRef.current?.getBoundingClientRect()
      setDeptMismatchWarning({
        queueNo: queue.queue_slot ?? queue.queue_no ?? '?',
        dept: queue.department,
        displayName: selDisplay?.name || '',
        px: r ? r.right + 12 : 320,
        py: r ? r.top + r.height / 2 : 200,
      })
      setTimeout(() => setDeptMismatchWarning(null), 5000)
      return
    }
    setCallingId(queue.vn)
    try {
      // Queue_Prefix: one VN can have multiple opd_qs_slot rows (one per doctor/service point) —
      // identifying by VN alone is ambiguous and could call a different doctor's slot than the
      // one on screen. queue_slot is unique per row, so prefer it whenever this row has one.
      const res = await callQueue(queue.queue_slot || queue.vn, sp, mode, selectedDisplayId || undefined)
      if (res.success) {
        lastCalledVnRef.current = queue.vn
        const calledNo = res.queueNo || queue.queue_no
        const calledAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        setCurrentCalled({ queueNo: calledNo, servicePoint: sp, calledAt })
        setCallTimeMap(prev => ({
          ...prev,
          [queue.vn]: calledAt,
          ...(queue.queue_slot ? { [`${queue.vn}::${queue.queue_slot}`]: calledAt } : {})
        }))
        // Optimistic update — status changes immediately, WebSocket queue:called will trigger full reload.
        // Match by queue_slot when this row has one — a VN can have multiple opd_qs_slot rows
        // (Queue_Prefix), and matching by vn alone would optimistically mark ALL of them as calling.
        setQueues(prev => prev.map(q =>
          (queue.queue_slot ? q.queue_slot === queue.queue_slot : q.vn === queue.vn)
            ? { ...q, status: 'calling' as QueueStatus, service_point: sp }
            : q
        ))
        if (!selectedDisplayId) {
          const r = callNextBtnRef.current?.getBoundingClientRect()
          setCheckDisplayPopup({ queueNo: calledNo, sp: sp, px: r ? r.right + 12 : 320, py: r ? r.top + r.height / 2 : 200 })
          setTimeout(() => setCheckDisplayPopup(null), 4000)
        }
      } else {
        setQuickCallMsg({ ok: false, text: res.message || 'เรียกคิวไม่สำเร็จ' })
        setTimeout(() => setQuickCallMsg(null), 3000)
      }
    } catch {
      setQuickCallMsg({ ok: false, text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' })
      setTimeout(() => setQuickCallMsg(null), 3000)
    } finally {
      setCallingId(null)
    }
  }

  const handleConfirm = async () => {
    if (!pendingCall) return
    const q = pendingCall
    setPendingCall(null)
    await doCall(q)
  }

  const handleCallNext = async () => {
    // If a row is locked (selected) and it's waiting → call that specific queue
    if (lockedVn) {
      const locked = queues.find(q => q.vn === lockedVn && q.status === 'waiting')
      if (locked) {
        setLockedVn(null)
        await handleCall(locked)
        return
      }
      // Locked row not waiting (e.g., already calling) — clear lock and fall through
      setLockedVn(null)
    }
    // Use filteredQueues (already sorted by queue_no, dept-filtered) to match displayed order
    const next = filteredQueues.find(q => q.status === 'waiting')
    if (next) await handleCall(next)
  }

  const handleRecall = async () => {
    if (!currentCalled) return
    // ค้นหา VN จาก queues ที่ตรงกับ queueNo ใน box 1 (กำลังให้บริการ)
    // ป้องกัน lastCalledVnRef ที่อาจเป็น VN เก่าจากคิวก่อนหน้า
    const callingRow = queues.find(q =>
      String(q.queue_slot || q.queue_no || '') === String(currentCalled.queueNo)
    )
    const identifier = (callingRow ? (callingRow.queue_slot || callingRow.vn) : null) ?? lastCalledVnRef.current ?? String(currentCalled.queueNo)
    setCallingId('__recall__')
    try {
      const res = await callQueue(identifier, currentSpName, mode, selectedDisplayId || undefined)
      if (res.success) {
        const calledNo = res.queueNo ?? String(currentCalled.queueNo)
        const calledAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        setCurrentCalled({ queueNo: calledNo, servicePoint: currentSpName, calledAt })
        loadQueues()
      }
    } catch {}
    finally { setCallingId(null) }
  }

  const handleNoShow = async () => {
    if (lockedVn) {
      // ล็อกแถวไว้แล้ว → skip แถวนั้น
      try {
        const target = queues.find(q => q.vn === lockedVn)
        const queueNo = target ? String(target.queue_slot || target.queue_no || '') : undefined
        await updateQueueStatus(lockedVn, 'skip', { queueNo, queueSlot: target?.queue_slot, servicePoint: currentSpName })
        setLockedVn(null)
        if (target?.status === 'calling') setCurrentCalled(null)
        loadQueues()
      } catch {}
    } else {
      // ยังไม่มีล็อก → ล็อกแถวที่กำลังเรียกอยู่ก่อน
      const cur = queues.find(q => q.status === 'calling')
      if (cur) setLockedVn(cur.vn)
    }
  }

  // ── Keyboard shortcuts (ต้องอยู่หลัง handleCallNext/Recall/NoShow) ─────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase()
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select'

      if (e.key === 'Escape') {
        setShowShortcutHelp(false)
        setShowSettingsMenu(false)
        setShowDisplayMenu(false)
        setShowChannelMenu(false)
        setShowDeptMenu(false)
        setPendingCall(null)
        setLockedVn(null)
        return
      }
      if (e.key === '?' && !inInput) {
        e.preventDefault()
        setShowShortcutHelp(v => !v)
        return
      }
      if (e.key === 'F1') { e.preventDefault(); handleConfirm(); return }
      if (e.key === 'F2') { e.preventDefault(); handleCallNext(); return }
      if (e.key === 'F3') { e.preventDefault(); handleRecall(); return }
      if (e.key === 'F4') { e.preventDefault(); handleNoShow(); return }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }) // intentionally no deps — re-registers each render for latest closures

  const handleQuickCall = async (e: React.FormEvent) => {
    e.preventDefault()
    const val = quickCall.trim()
    if (!val) return
    setCallingId('__quick__')
    try {
      // When a specific ห้องตรวจ is filtered, resolve the scanned/typed value against ONLY the
      // filtered rows first — a VN can have multiple opd_qs_slot records (one per doctor), so
      // calling by a bare VN/HN would let the server match whichever one it finds first, possibly
      // a different doctor's slot than the one currently filtered on screen.
      let callVal = val
      if (filterDepts.length > 0) {
        const match = filteredQueues.find(q =>
          String(q.vn) === val || String(q.hn || '') === val ||
          String(q.queue_no ?? '') === val || String(q.queue_slot || '') === val
        )
        if (!match) {
          setQuickCallMsg({ ok: false, text: 'ไม่พบคิวนี้ในห้องตรวจที่กรองไว้' })
          return
        }
        callVal = match.queue_slot || match.vn
      }
      const res = await callQueue(callVal, currentSpName, mode, selectedDisplayId || undefined)
      if (res.success) {
        const calledAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        setCurrentCalled({ queueNo: res.queueNo || val, servicePoint: currentSpName, calledAt })
        setQuickCall('')
        setQuickCallMsg({ ok: true, text: `เรียกคิว ${res.queueNo || val} สำเร็จ` })
        loadQueues()
      } else {
        setQuickCallMsg({ ok: false, text: res.message || 'ไม่พบคิว' })
      }
    } catch {
      setQuickCallMsg({ ok: false, text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' })
    } finally {
      setCallingId(null)
      setTimeout(() => setQuickCallMsg(null), 3000)
      quickCallRef.current?.focus()
    }
  }

  const handleStatusChange = async (queue: QueueRow, status: QueueStatus) => {
    try { await updateQueueStatus(queue.vn, status, { queueSlot: queue.queue_slot }); loadQueues() } catch {}
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const activeQueues = queues.filter(q => q.status === 'waiting' || q.status === 'calling')

  // "ห้องตรวจ" filter's grouping key — for Queue_Prefix (slot) it's the queue-slot's assigned
  // doctor/category (opd_qs_slot.doctor_code, e.g. "คิวผู้ป่วยนอก"/"คิว ศัลยกรรม"), not the visit's
  // kskdepartment. Every other mode keeps using department as before. The "แผนก" table column
  // always shows q.department regardless of mode — only this filter's grouping changes.
  const roomKeyOf = (q: QueueRow) => mode === 'slot' ? (q.slot_doctor_name || '') : (q.department || '')

  const deptOptions = Array.from(new Set(activeQueues.map(roomKeyOf).filter(Boolean))).sort()

  const toggleDept = (dept: string) =>
    setFilterDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])

  // Doctor list scoped to the currently selected ห้องตรวจ (filterDepts) — same relationship as
  // the "ห้องตรวจ" filter itself, so picking a room narrows which doctors show up here.
  // Queue_Prefix's filterDepts holds slot-doctor/category names, not real departments, so it
  // can't scope against the /appointment-doctors endpoint's department field — instead derive
  // the list directly from today's own queue rows (each already carries its own doctor_name),
  // filtered the same way as the ห้องตรวจ dropdown itself. This also means a doctor only shows
  // up here when they actually have a patient in the filtered room, matching doctorPatientCount.
  const doctorsInScope = Array.from(new Set(
    (mode === 'slot'
      ? activeQueues
          .filter(q => q.visit_type === 'appt' && (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q))))
          .map(q => q.doctor_name)
      : (filterDepts.length === 0 ? doctorList : doctorList.filter(d => filterDepts.includes(d.department)))
          .map(d => d.doctor_name)
    ).filter((name): name is string => !!name)
  )).sort()

  const toggleDoctor = (name: string) =>
    setSelectedDoctors(prev => prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name])

  // Real count of today's waiting appointment patients per doctor — doctorsInScope itself just lists
  // every doctor with an appointment today (regardless of visit status), so a doctor can show up with
  // a name but 0 here if their patients haven't checked in yet or were already called/done.
  const doctorPatientCount = (name: string) => activeQueues.filter(q =>
    q.visit_type === 'appt' && q.doctor_name === name &&
    (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q)))
  ).length

  // Clinic list scoped the same way as the doctor filter — clinic_name comes straight back on
  // every queue row (server-side oapp→clinic join) regardless of mode, so unlike doctorList this
  // never needs a separate API fallback for non-slot modes.
  const clinicsInScope = Array.from(new Set(
    activeQueues
      .filter(q => q.visit_type === 'appt' && (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q))))
      .map(q => q.clinic_name)
      .filter((name): name is string => !!name)
  )).sort()

  const toggleClinic = (name: string) =>
    setSelectedClinics(prev => prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name])

  const clinicPatientCount = (name: string) => activeQueues.filter(q =>
    q.visit_type === 'appt' && q.clinic_name === name &&
    (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q)))
  ).length

  const queueKeyOf = (q: QueueRow) => (q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn)

  const boardChannels = selectedDisplay?.channels || []
  const boardMap: Record<string, string[]> = selectedDisplayId ? (staging[selectedDisplayId] || {}) : {}

  // queue key -> channel it's parked in on the selected display (a queue sits in at most one)
  const channelByKey = new Map<string, string>()
  for (const ch of boardChannels) for (const k of boardMap[ch] || []) channelByKey.set(k, ch)

  const filteredQueues = (filterStatus === 'done' || filterStatus === 'skip' ? queues : activeQueues)
    .filter(q => {
      const matchDept = filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q))
      const matchStatus = filterStatus === 'all' ? true : q.status === filterStatus
      const matchBoard = !boardFilter || channelByKey.get(queueKeyOf(q)) === boardFilter
      const matchVisit = visitFilter === 'all' || q.visit_type === visitFilter
      const matchDoctor = visitFilter !== 'appt' || selectedDoctors.length === 0 || (!!q.doctor_name && selectedDoctors.includes(q.doctor_name))
      const matchClinic = visitFilter !== 'appt' || selectedClinics.length === 0 || (!!q.clinic_name && selectedClinics.includes(q.clinic_name))
      return matchDept && matchStatus && matchVisit && matchDoctor && matchClinic && matchBoard
    })
    .sort((a, b) => {
      // Queue_OPD / Queue_OPD_Room: sort oqueue (queue_no) numerically ascending
      if (mode === 'opd' || mode === 'cur_dep') {
        const an = parseInt(String(a.queue_no ?? ''), 10)
        const bn = parseInt(String(b.queue_no ?? ''), 10)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        if (!isNaN(an)) return -1
        if (!isNaN(bn)) return 1
      }
      // Queue_Prefix / Queue_Prefix_Room: the server's ORDER BY groups by kskdepartment first,
      // which no longer lines up with how ห้องตรวจ filters (slot_doctor_name for Queue_Prefix) —
      // sort by queue_slot (prefix, then its numeric suffix ascending) so a filtered category
      // reads in the order the tickets were actually issued.
      if (mode === 'slot' || mode === 'slot_cur') {
        const av = String(a.queue_slot || '')
        const bv = String(b.queue_slot || '')
        const am = av.match(/^([A-Za-z]*)(\d+)$/)
        const bm = bv.match(/^([A-Za-z]*)(\d+)$/)
        if (am && bm) {
          if (am[1] !== bm[1]) return am[1].localeCompare(bm[1])
          return parseInt(am[2], 10) - parseInt(bm[2], 10)
        }
        return av.localeCompare(bv)
      }
      return 0
    })

  // Count by status — respect dept + appointment/doctor filter so summary reflects selected room/display
  const deptFilteredQueues = queues.filter(q => {
    const matchDept = filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q))
    const matchVisit = visitFilter === 'all' || q.visit_type === visitFilter
    const matchDoctor = visitFilter !== 'appt' || selectedDoctors.length === 0 || (!!q.doctor_name && selectedDoctors.includes(q.doctor_name))
    const matchClinic = visitFilter !== 'appt' || selectedClinics.length === 0 || (!!q.clinic_name && selectedClinics.includes(q.clinic_name))
    return matchDept && matchVisit && matchDoctor && matchClinic
  })
  const countByStatus = (s: string) => deptFilteredQueues.filter(q => q.status === s).length

  const statusLabel: Record<string, string> = {
    waiting: 'รอเรียก', calling: 'กำลังเรียก', done: 'แล้ว', skip: 'ไม่มา'
  }
  const statusClass: Record<string, string> = {
    waiting: 'badge-waiting', calling: 'badge-calling', done: 'badge-done', skip: 'badge-skip'
  }

  const hasCallingQueue = queues.some(q => q.status === 'calling')
  const hasWaitingQueue = queues.some(q =>
    q.status === 'waiting' &&
    (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q))) &&
    (visitFilter === 'all' || q.visit_type === visitFilter) &&
    (visitFilter !== 'appt' || selectedDoctors.length === 0 || (!!q.doctor_name && selectedDoctors.includes(q.doctor_name))) &&
    (visitFilter !== 'appt' || selectedClinics.length === 0 || (!!q.clinic_name && selectedClinics.includes(q.clinic_name)))
  )

  // ── Staging board ───────────────────────────────────────────────────────────

  const boardQueuesOf = (ch: string) => queues
    .filter(q => channelByKey.get(queueKeyOf(q)) === ch)
    .sort((a, b) => String(a.queue_slot || a.queue_no || '').localeCompare(String(b.queue_slot || b.queue_no || ''), undefined, { numeric: true }))

  const boardCount = queues.filter(q => channelByKey.has(queueKeyOf(q))).length

  const hiddenOnBoard = selectedDisplayId ? (hiddenChannels[selectedDisplayId] || []) : []
  const visibleChannels = boardChannels.filter(ch => !hiddenOnBoard.includes(ch))
  const toggleChannelVisible = (ch: string) => {
    if (!selectedDisplayId) return
    setHiddenChannels(prev => {
      const cur = prev[selectedDisplayId] || []
      return { ...prev, [selectedDisplayId]: cur.includes(ch) ? cur.filter(c => c !== ch) : [...cur, ch] }
    })
  }

  const toggleSelectKey = (key: string) =>
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const setSelectionForRows = (rows: QueueRow[], on: boolean) => {
    const keys = rows.map(queueKeyOf)
    setSelectedKeys(prev => on
      ? Array.from(new Set([...prev, ...keys]))
      : prev.filter(k => !keys.includes(k)))
  }

  const moveKeysToChannel = async (keys: string[], channel: string | null) => {
    if (!selectedDisplayId || keys.length === 0) return
    try {
      await moveQueuesToStaging(selectedDisplayId, channel, keys)
      setSelectedKeys(prev => prev.filter(k => !keys.includes(k)))
      loadStaging()
      try { localStorage.setItem('qc_staging_at', String(Date.now())) } catch {}
    } catch {}
  }

  return (
    <div className="qc-bg">
      <div className="qc-bg-wave" />

      {/* ─── Top Bar ─── */}
      <header className="qc-topbar">
        <div className="qc-topbar-left">
          {/* ── จุดแสดงคิว selector ── */}
          <div className="qc-display-dropdown" ref={displayMenuRef}>
            <span className="qc-topbar-sp-label" style={{ marginRight: 6 }}>จอแสดงคิว</span>
            <button
              className={`qc-display-trigger${showDisplayMenu ? ' open' : ''}`}
              onClick={() => setShowDisplayMenu(v => !v)}
            >
              <span className="qc-display-trigger-text">
                {selectedDisplay ? `📺 ${selectedDisplay.name}` : '— ทั่วไป —'}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="qc-display-caret">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {showDisplayMenu && (
              <div className="qc-display-menu">
                <div className="qc-display-search-wrap">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="qc-display-search-icon">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <input
                    ref={displaySearchRef}
                    className="qc-display-search-input"
                    type="text"
                    placeholder="ค้นหาจอแสดงคิว..."
                    value={displaySearch}
                    onChange={e => setDisplaySearch(e.target.value)}
                    onKeyDown={e => e.stopPropagation()}
                  />
                  {displaySearch && (
                    <button className="qc-display-search-clear" onClick={() => { setDisplaySearch(''); displaySearchRef.current?.focus() }}>✕</button>
                  )}
                </div>
                <div className="qc-display-list-scroll">
                  {!displaySearch && (
                    <>
                      <div
                        className={`qc-display-item${selectedDisplayId === '' ? ' active' : ''}`}
                        onClick={() => { setSelectedDisplayId(''); setServicePointId(''); setShowDisplayMenu(false) }}
                      >
                        <span className="qc-display-item-icon">🖥</span>
                        <span className="qc-display-item-name">— ทั่วไป (ไม่ระบุจอ) —</span>
                      </div>
                      {displayConfigs.length > 0 && <div className="qc-display-divider" />}
                    </>
                  )}
                  {filteredDisplayConfigs.map(d => (
                    <div
                      key={d.id}
                      className={`qc-display-item${selectedDisplayId === d.id ? ' active' : ''}`}
                      onClick={() => { setSelectedDisplayId(d.id); setServicePointId(''); setShowDisplayMenu(false) }}
                    >
                      <span className="qc-display-item-icon">📺</span>
                      <span className="qc-display-item-name">{d.name}</span>
                      {d.channels?.length ? (
                        <span className="qc-display-item-badge">{d.channels.length} ช่อง</span>
                      ) : null}
                    </div>
                  ))}
                  {displaySearch && filteredDisplayConfigs.length === 0 && (
                    <div className="qc-display-no-result">ไม่พบจอ "{displaySearch}"</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── ช่องบริการ ── */}
          {/* ── ช่องบริการ custom dropdown ── */}
          <div className="qc-display-dropdown" ref={channelMenuRef}>
            <span className="qc-topbar-sp-label" style={{ marginRight: 6 }}>ช่องบริการ</span>
            {(useDisplayChannels || servicePoints.length > 0) ? (
              <>
                <button
                  className={`qc-display-trigger${showChannelMenu ? ' open' : ''}`}
                  onClick={() => setShowChannelMenu(v => !v)}
                >
                  <span className="qc-display-trigger-text">
                    {useDisplayChannels
                      ? (servicePointId || displayChannels[0] || '')
                      : (servicePoints.find(sp => sp.id === servicePointId)?.name || servicePoints[0]?.name || '— เลือก —')
                    }
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="qc-display-caret">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showChannelMenu && (() => {
                  const q = channelSearch.trim().toLowerCase()
                  const filteredChannels = useDisplayChannels
                    ? displayChannels.filter(ch => !q || ch.toLowerCase().includes(q) || `ช่อง ${ch}`.toLowerCase().includes(q))
                    : []
                  const filteredSPs = !useDisplayChannels
                    ? servicePoints.filter(sp => !q || sp.name.toLowerCase().includes(q))
                    : []
                  const noResult = q && (useDisplayChannels ? filteredChannels.length === 0 : filteredSPs.length === 0)
                  return (
                    <div className="qc-display-menu">
                      <div className="qc-display-search-wrap">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="qc-display-search-icon">
                          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                          <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <input
                          ref={channelSearchRef}
                          className="qc-display-search-input"
                          type="text"
                          placeholder="ค้นหาช่องบริการ..."
                          value={channelSearch}
                          onChange={e => setChannelSearch(e.target.value)}
                          onKeyDown={e => e.stopPropagation()}
                        />
                        {channelSearch && (
                          <button className="qc-display-search-clear" onClick={() => { setChannelSearch(''); channelSearchRef.current?.focus() }}>✕</button>
                        )}
                      </div>
                      <div className="qc-display-list-scroll">
                        {useDisplayChannels ? filteredChannels.map(ch => (
                          <div
                            key={ch}
                            className={`qc-display-item${servicePointId === ch ? ' active' : ''}`}
                            onClick={() => { setServicePointId(ch); setShowChannelMenu(false) }}
                          >
                            <span className="qc-display-item-icon">🏥</span>
                            <span className="qc-display-item-name">{ch}</span>
                          </div>
                        )) : filteredSPs.map(sp => (
                          <div
                            key={sp.id}
                            className={`qc-display-item${servicePointId === sp.id ? ' active' : ''}`}
                            onClick={() => { setServicePointId(sp.id); setShowChannelMenu(false) }}
                          >
                            <span className="qc-display-item-icon">🖥</span>
                            <span className="qc-display-item-name">{sp.name}</span>
                          </div>
                        ))}
                        {noResult && (
                          <div className="qc-display-no-result">ไม่พบช่อง "{channelSearch}"</div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </>
            ) : (
              <span className="qc-topbar-sp-none">— ไม่มีช่องบริการ</span>
            )}
          </div>

          {/* ── ปุ่มเคลียคิวจอแสดง ── */}
          <button
            className={`qc-clear-display-btn${clearMsg ? ' ok' : ''}`}
            title={selectedDisplay ? `เคลียคิวทั้งหมดบนจอ "${selectedDisplay.name}"` : 'เคลียคิวทุกจอแสดงผล'}
            onClick={async () => {
              await clearDisplayQueues(selectedDisplayId || undefined)
              setClearMsg(true)
              setTimeout(() => setClearMsg(false), 1800)
            }}
          >
            {clearMsg ? '✓ เคลียแล้ว' : (selectedDisplay ? `🗑 เคลียคิว "${selectedDisplay.name}"` : '🗑 เคลียทุกจอ')}
          </button>

          {/* ── บอร์ดเตรียมคิว ── */}
          <button
            className={`qc-board-toggle${showBoard ? ' active' : ''}`}
            disabled={!selectedDisplay || boardChannels.length === 0}
            title={selectedDisplay ? `บอร์ดเตรียมคิวของจอ "${selectedDisplay.name}"` : 'เลือกจอแสดงคิวก่อน'}
            onClick={() => setShowBoard(v => !v)}
          >
            🗂 บอร์ดเตรียมคิว{boardCount > 0 ? ` (${boardCount})` : ''}
          </button>
        </div>

        <div className="qc-topbar-center">
          <div className="qc-mode-switch">
            {/* ── กลุ่ม 1: Queue Prefix (opd_qs_slot) ── */}
            <div className="qc-mode-group group-prefix">
              <button
                className={`qc-mode-btn prefix${mode === 'slot' ? ' active' : ''}`}
                onClick={() => { setMode('slot'); localStorage.setItem('qc_mode', 'slot') }}
                title="HOSxP Queue Slot (opd_qs_slot / main_dep)"
              >Queue_Prefix</button>
              <button
                className={`qc-mode-btn prefix${mode === 'slot_cur' ? ' active' : ''}`}
                onClick={() => { setMode('slot_cur'); localStorage.setItem('qc_mode', 'slot_cur') }}
                title="HOSxP Queue Slot ตามห้องตรวจปัจจุบัน (opd_qs_slot / cur_dep)"
              >Queue_Prefix_Room</button>
            </div>

            <div className="qc-mode-sep" />

            {/* ── กลุ่ม 2: Queue OPD (ovst) ── */}
            <div className="qc-mode-group group-opd">
              <button
                className={`qc-mode-btn opd${mode === 'opd' ? ' active' : ''}`}
                onClick={() => { setMode('opd'); localStorage.setItem('qc_mode', 'opd') }}
                title="OPD Visit (ovst / main_dep)"
              >Queue_OPD</button>
              <button
                className={`qc-mode-btn opd${mode === 'cur_dep' ? ' active' : ''}`}
                onClick={() => { setMode('cur_dep'); localStorage.setItem('qc_mode', 'cur_dep') }}
                title="OPD Visit ตามห้องตรวจปัจจุบัน (ovst / cur_dep)"
              >Queue_OPD_Room</button>
            </div>
          </div>
        </div>

        <div className="qc-topbar-right">
          <button className="qc-shortcut-help-btn" onClick={() => setShowShortcutHelp(v => !v)} title="คีย์ลัด (?)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="17" r="1" fill="currentColor"/>
            </svg>
            ?
          </button>
          <div className="qc-clock">
            {clock.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="qc-settings-wrap" ref={settingsRef}>
            <button className="qc-settings-btn" onClick={() => setShowSettingsMenu(v => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              ตั้งค่า
            </button>
            {showSettingsMenu && (
              <div className="qc-settings-dropdown">
                <div className="qc-sd-header">ตั้งค่า</div>
                <button className="qc-sd-action" onClick={() => { navigate('/app-settings'); setShowSettingsMenu(false) }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  จัดการช่องบริการ
                </button>
                <div className="qc-sd-divider" />
                <button className="qc-sd-action" onClick={() => { navigate('/queue-history'); setShowSettingsMenu(false) }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  ประวัติการเรียกคิว
                </button>
                <div className="qc-sd-divider" />
                <button className="qc-sd-action" onClick={() => { navigate('/display-configs'); setShowSettingsMenu(false) }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 20h8M12 18v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  จัดการหน้าจอแสดงคิว
                </button>
                <div className="qc-sd-divider" />
                <button className="qc-sd-action" onClick={() => { loadQueues(); setShowSettingsMenu(false) }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  รีเฟรชคิว
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="qc-body">

        {/* ─── Left Panel ─── */}
        <aside className="qc-panel-left">
          <div className="qc-serve-card">
            <div className="qc-serve-label">
              <span>กำลังให้บริการ &nbsp;·&nbsp; {currentSpName || '—'}</span>
              {currentCalled?.calledAt && (
                <span className="qc-serve-time">🕐 {currentCalled.calledAt} น.</span>
              )}
            </div>
            {currentCalled ? (
              <div className="qc-serve-no">{currentCalled.queueNo}</div>
            ) : (
              <div className="qc-serve-empty">—</div>
            )}
          </div>

          <button ref={callNextBtnRef} className="qc-btn-action qc-btn-next" onClick={handleCallNext}
            disabled={!!callingId || !hasWaitingQueue}>
            {callingId && callingId !== '__quick__'
              ? <span className="qc-btn-spinner" />
              : <span className="qc-btn-icon">▶</span>}
            {(() => {
              const locked = lockedVn ? queues.find(q => q.vn === lockedVn && q.status === 'waiting') : null
              return locked ? `เรียก · ${locked.queue_slot ?? locked.queue_no ?? '?'}` : 'เรียกคิวถัดไป'
            })()}
            <span className="qc-kbd">F2</span>
          </button>

          <button className="qc-btn-action qc-btn-recall" onClick={handleRecall}
            disabled={!!callingId || !currentCalled}>
            <span className="qc-btn-icon">○</span>เรียกซ้ำ
            <span className="qc-kbd">F3</span>
          </button>

          <button className={`qc-btn-action qc-btn-noshow${lockedVn ? ' locked' : ''}`}
            onClick={handleNoShow}
            disabled={!!callingId || (!hasCallingQueue && !lockedVn)}>
            <span className="qc-btn-icon">✕</span>
            {lockedVn
              ? `ยืนยัน ไม่มา · ${queues.find(q => q.vn === lockedVn)?.queue_slot ?? queues.find(q => q.vn === lockedVn)?.queue_no ?? '?'}`
              : 'เรียกไม่มา'}
            <span className="qc-kbd">F4</span>
          </button>

          <div className="qc-manual-card">
            <div className="qc-manual-label">เรียกด้วย Q / HN</div>
            <form onSubmit={handleQuickCall} className="qc-manual-form">
              <input ref={quickCallRef} className="input qc-manual-input" type="text"
                placeholder="พิมพ์เลขคิว (Q) หรือ HN... / ยิงบาร์โค้ด"
                value={quickCall} onChange={e => setQuickCall(e.target.value)}
                autoFocus
                onBlur={() => setTimeout(() => {
                  const tag = document.activeElement?.tagName.toLowerCase()
                  if (!tag || !['input','select','textarea','button'].includes(tag))
                    quickCallRef.current?.focus()
                }, 150)} />
              <button className="qc-manual-btn" type="submit"
                disabled={callingId === '__quick__' || !quickCall.trim()}>
                {callingId === '__quick__' ? <span className="qc-btn-spinner" /> : '📢'}
              </button>
            </form>
            {quickCallMsg && (
              <p className={`qc-quick-msg ${quickCallMsg.ok ? 'ok' : 'err'}`}>{quickCallMsg.text}</p>
            )}
          </div>

          <div className="qc-stats-row">
            <div className={`qc-stat-box stat-waiting${filterStatus === 'waiting' ? ' active' : ''}`}
              onClick={() => setFilterStatus(v => v === 'waiting' ? 'all' : 'waiting')} style={{ cursor: 'pointer' }}>
              <span>{countByStatus('waiting')}</span><label>คิวรอ</label>
            </div>
            <div className={`qc-stat-box stat-done${filterStatus === 'done' ? ' active' : ''}`}
              onClick={() => setFilterStatus(v => v === 'done' ? 'all' : 'done')} style={{ cursor: 'pointer' }}>
              <span>{countByStatus('done')}</span><label>ให้บริการแล้ว</label>
            </div>
            <div className={`qc-stat-box stat-skip${filterStatus === 'skip' ? ' active' : ''}`}
              onClick={() => setFilterStatus(v => v === 'skip' ? 'all' : 'skip')} style={{ cursor: 'pointer' }}>
              <span>{countByStatus('skip')}</span><label>ไม่มา</label>
            </div>
          </div>

          <label className={`qc-autocall-toggle ${confirmEnabled ? 'on' : ''}`}>
            <div className="qc-autocall-left">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>ยืนยันก่อนเรียกคิว</span>
            </div>
            <div className="qc-autocall-switch">
              <input type="checkbox" checked={confirmEnabled} onChange={e => {
                setConfirmEnabled(e.target.checked)
                localStorage.setItem('qc_confirm', String(e.target.checked))
              }} />
              <span className="qc-autocall-track">
                <span className="qc-autocall-thumb" />
              </span>
            </div>
          </label>
        </aside>

        {/* ─── Right Panel ─── */}
        <main className="qc-panel-right">
          <div className="qc-filters card">
            <div className="qc-dept-row">
            <span className="qc-dept-label">ห้องตรวจ</span>
            <div className="qc-dept-dropdown" ref={deptMenuRef}>
              <button className={`qc-dept-trigger ${showDeptMenu ? 'open' : ''}`}
                onClick={() => setShowDeptMenu(v => !v)}>
                <span className="qc-dept-trigger-text">
                  {filterDepts.length === 0
                    ? 'ห้องตรวจทั้งหมด'
                    : filterDepts.length === 1
                      ? filterDepts[0]
                      : `เลือก ${filterDepts.length} ห้องตรวจ`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="qc-dept-caret">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showDeptMenu && (
                <div className="qc-dept-menu">
                  <div className="qc-dept-search-wrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="qc-dept-search-icon">
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      ref={deptSearchRef}
                      className="qc-dept-search-input"
                      type="text"
                      placeholder="ค้นหาแผนก..."
                      value={deptSearch}
                      onChange={e => setDeptSearch(e.target.value)}
                      onKeyDown={e => e.stopPropagation()}
                    />
                    {deptSearch && (
                      <button className="qc-dept-search-clear" onClick={() => { setDeptSearch(''); deptSearchRef.current?.focus() }}>✕</button>
                    )}
                  </div>
                  <div className="qc-dept-list-scroll">
                    {!deptSearch && (
                      <>
                        <label className="qc-dept-item all-item">
                          <input type="checkbox" checked={filterDepts.length === 0} onChange={() => setFilterDepts([])} />
                          <span>ห้องตรวจทั้งหมด</span>
                          <span className="qc-dept-item-cnt">{activeQueues.length}</span>
                        </label>
                        <div className="qc-dept-divider" />
                      </>
                    )}
                    {deptOptions
                      .filter(d => !deptSearch || d.toLowerCase().includes(deptSearch.toLowerCase()))
                      .map(dept => (
                        <label key={dept} className="qc-dept-item">
                          <input
                            type="checkbox"
                            checked={filterDepts.length === 0 || filterDepts.includes(dept)}
                            onChange={() => toggleDept(dept)}
                          />
                          <span>{dept}</span>
                          <span className="qc-dept-item-cnt">
                            {activeQueues.filter(q => roomKeyOf(q) === dept).length}
                          </span>
                        </label>
                      ))
                    }
                    {deptSearch && deptOptions.filter(d => d.toLowerCase().includes(deptSearch.toLowerCase())).length === 0 && (
                      <div className="qc-dept-no-result">ไม่พบแผนก "{deptSearch}"</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              className={`qc-save-prefs-btn${savedPrefsMsg ? ' saved' : ''}`}
              onClick={savePrefs}
              title={`จำค่าช่องบริการ (${currentSpName}) และแผนกที่เลือก สำหรับ ${sessionStorage.getItem('officer') || 'user'}`}
            >
              {savedPrefsMsg ? '✓ บันทึกแล้ว' : '💾 จำค่า'}
            </button>

            <div className="qc-visit-filter-group">
              {([
                ['all', 'ทั้งหมด'],
                ['walkin', 'เฉพาะ Walk-in'],
                ['appt', 'เฉพาะคนไข้นัด'],
              ] as const).map(([val, label]) => (
                <button key={val}
                  className={`qc-tab ${visitFilter === val ? 'active' : ''}`}
                  onClick={() => setVisitFilter(val)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className={`qc-doctor-dropdown${visitFilter === 'appt' ? '' : ' disabled'}`} ref={doctorMenuRef}>
              <button className={`qc-dept-trigger ${showDoctorMenu ? 'open' : ''}`}
                disabled={visitFilter !== 'appt'}
                onClick={() => setShowDoctorMenu(v => !v)}>
                <span className="qc-dept-trigger-text">
                  {selectedDoctors.length === 0
                    ? 'แพทย์ทั้งหมด'
                    : selectedDoctors.length === 1
                      ? selectedDoctors[0]
                      : `เลือก ${selectedDoctors.length} แพทย์`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="qc-dept-caret">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showDoctorMenu && (
                <div className="qc-dept-menu">
                  <div className="qc-dept-search-wrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="qc-dept-search-icon">
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      ref={doctorSearchRef}
                      className="qc-dept-search-input"
                      type="text"
                      placeholder="ค้นหาแพทย์..."
                      value={doctorSearch}
                      onChange={e => setDoctorSearch(e.target.value)}
                      onKeyDown={e => e.stopPropagation()}
                    />
                    {doctorSearch && (
                      <button className="qc-dept-search-clear" onClick={() => { setDoctorSearch(''); doctorSearchRef.current?.focus() }}>✕</button>
                    )}
                  </div>
                  <div className="qc-dept-list-scroll">
                    {!doctorSearch && (
                      <>
                        <label className="qc-dept-item all-item">
                          <input type="checkbox" checked={selectedDoctors.length === 0} onChange={() => setSelectedDoctors([])} />
                          <span>แพทย์ทั้งหมด</span>
                          <span className="qc-dept-item-cnt">
                            {activeQueues.filter(q => q.visit_type === 'appt' && (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q)))).length}
                          </span>
                        </label>
                        <div className="qc-dept-divider" />
                      </>
                    )}
                    {doctorsInScope.length === 0 ? (
                      <div className="qc-dept-no-result">ไม่พบแพทย์ที่มีนัดหมายวันนี้</div>
                    ) : doctorsInScope
                      .filter(name => !doctorSearch || name.toLowerCase().includes(doctorSearch.toLowerCase()))
                      .map(name => (
                        <label key={name} className="qc-dept-item">
                          <input
                            type="checkbox"
                            checked={selectedDoctors.length === 0 || selectedDoctors.includes(name)}
                            onChange={() => toggleDoctor(name)}
                          />
                          <span>{name}</span>
                          <span className="qc-dept-item-cnt">{doctorPatientCount(name)}</span>
                        </label>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>

            <div className={`qc-clinic-dropdown${visitFilter === 'appt' ? '' : ' disabled'}`} ref={clinicMenuRef}>
              <button className={`qc-dept-trigger ${showClinicMenu ? 'open' : ''}`}
                disabled={visitFilter !== 'appt'}
                onClick={() => setShowClinicMenu(v => !v)}>
                <span className="qc-dept-trigger-text">
                  {selectedClinics.length === 0
                    ? 'คลินิกทั้งหมด'
                    : selectedClinics.length === 1
                      ? selectedClinics[0]
                      : `เลือก ${selectedClinics.length} คลินิก`}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="qc-dept-caret">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showClinicMenu && (
                <div className="qc-dept-menu">
                  <div className="qc-dept-search-wrap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="qc-dept-search-icon">
                      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <input
                      ref={clinicSearchRef}
                      className="qc-dept-search-input"
                      type="text"
                      placeholder="ค้นหาคลินิก..."
                      value={clinicSearch}
                      onChange={e => setClinicSearch(e.target.value)}
                      onKeyDown={e => e.stopPropagation()}
                    />
                    {clinicSearch && (
                      <button className="qc-dept-search-clear" onClick={() => { setClinicSearch(''); clinicSearchRef.current?.focus() }}>✕</button>
                    )}
                  </div>
                  <div className="qc-dept-list-scroll">
                    {!clinicSearch && (
                      <>
                        <label className="qc-dept-item all-item">
                          <input type="checkbox" checked={selectedClinics.length === 0} onChange={() => setSelectedClinics([])} />
                          <span>คลินิกทั้งหมด</span>
                          <span className="qc-dept-item-cnt">
                            {activeQueues.filter(q => q.visit_type === 'appt' && (filterDepts.length === 0 || filterDepts.includes(roomKeyOf(q)))).length}
                          </span>
                        </label>
                        <div className="qc-dept-divider" />
                      </>
                    )}
                    {clinicsInScope.length === 0 ? (
                      <div className="qc-dept-no-result">ไม่พบคลินิกที่มีนัดหมายวันนี้</div>
                    ) : clinicsInScope
                      .filter(name => !clinicSearch || name.toLowerCase().includes(clinicSearch.toLowerCase()))
                      .map(name => (
                        <label key={name} className="qc-dept-item">
                          <input
                            type="checkbox"
                            checked={selectedClinics.length === 0 || selectedClinics.includes(name)}
                            onChange={() => toggleClinic(name)}
                          />
                          <span>{name}</span>
                          <span className="qc-dept-item-cnt">{clinicPatientCount(name)}</span>
                        </label>
                      ))
                    }
                  </div>
                </div>
              )}
            </div>
            </div>
            <div className="qc-filter-tabs">
              {(['all', 'waiting', 'calling', 'done', 'skip'] as const).map(s => (
                <button key={s} className={`qc-tab ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                  {s === 'all' ? `ทั้งหมด (${deptFilteredQueues.length})` : `${statusLabel[s]} (${countByStatus(s)})`}
                </button>
              ))}
              {boardChannels.length > 0 && (
                <div className="qc-board-filter">
                  <span className="qc-board-filter-label">🗂 บอร์ด</span>
                  {boardChannels.map(ch => {
                    const n = boardQueuesOf(ch).length
                    return (
                      <button key={ch}
                        className={`qc-tab qc-board-filter-chip ${boardFilter === ch ? 'active' : ''}`}
                        onClick={() => {
                          if (boardFilter === ch) { setBoardFilter(''); return }
                          setBoardFilter(ch)
                          setServicePointId(ch)
                        }}
                        title={`แสดงเฉพาะคิวในช่อง ${ch} และเรียกจากช่องนี้`}>
                        ช่อง {ch} ({n})
                      </button>
                    )
                  })}
                </div>
              )}
              <button className="qc-history-btn" onClick={() => navigate('/queue-history')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                ประวัติ
              </button>
            </div>
          </div>

          {selectedKeys.length > 0 && (
            <div className="qc-stage-toolbar">
              <span className="qc-stage-toolbar-count">เลือก {selectedKeys.length} คิว → ใส่บอร์ด</span>
              {boardChannels.length === 0 ? (
                <span className="qc-stage-toolbar-hint">เลือกจอแสดงคิวที่มีช่องก่อน</span>
              ) : boardChannels.map(ch => (
                <button key={ch} className="qc-stage-chip" onClick={() => moveKeysToChannel(selectedKeys, ch)}>
                  {ch}
                </button>
              ))}
              <button className="qc-stage-chip ghost" onClick={() => setSelectedKeys([])}>ยกเลิกการเลือก</button>
            </div>
          )}

          <div className="qc-table-wrap">
            {loading && <div className="qc-progress-bar"><div className="qc-progress-bar-inner" /></div>}
            {queues.length === 0 && loading ? (
              <div className="qc-empty"><div className="qc-loader" /><p>กำลังโหลด...</p></div>
            ) : filteredQueues.length === 0 ? (
              <div className="qc-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" opacity="0.2">
                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fff" strokeWidth="1.5" />
                  <path d="M9 9h6M9 12h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p>ไม่พบข้อมูล</p>
              </div>
            ) : (
              <table className="qc-table">
                <thead><tr>
                  <th className="qc-th-select">
                    <input type="checkbox"
                      checked={filteredQueues.length > 0 && filteredQueues.every(q => selectedKeys.includes(queueKeyOf(q)))}
                      onChange={e => setSelectionForRows(filteredQueues, e.target.checked)}
                      title="เลือกทั้งหมดที่แสดงอยู่" />
                  </th>
                  <th>วันที่</th>
                  <th className="qc-th-lab">Lab</th>
                  <th className="qc-th-lab">X-ray</th>
                  {(mode === 'slot' || mode === 'slot_cur') && <th>Queue Dep</th>}
                  <th>{(mode === 'slot' || mode === 'slot_cur') ? 'oqueue' : 'คิว'}</th>
                  <th>HN</th>
                  <th>ชื่อ</th><th>สิทธิการรักษา</th><th>แผนก</th>
                  <th>ประเภท</th><th>สถานะ</th><th>เวลาเรียก</th>
                  <th>
                    <div className="qc-th-action">
                      จัดการ
                      {queues.some(q => q.status === 'calling') && (
                        <button
                          className="qc-tick-all-btn"
                          onClick={async () => {
                            const calling = queues.filter(q => q.status === 'calling')
                            await Promise.all(calling.map(q => updateQueueStatus(q.vn, 'done', { queueSlot: q.queue_slot })))
                            setCurrentCalled(null)
                            loadQueues()
                          }}
                          title="ติ๊ก done ทุก calling"
                        >
                          ✓ All
                        </button>
                      )}
                    </div>
                  </th>
                </tr></thead>
                <tbody>
                  {filteredQueues.map((q, i) => (
                    <tr key={`${q.vn}-${i}`}
                      className={`qc-tr ${q.status === 'calling' ? 'qc-tr-calling' : ''} ${q.status === 'done' ? 'qc-tr-done' : ''} ${lockedVn === q.vn ? 'qc-tr-locked' : ''} ${(q.status === 'waiting' || q.status === 'calling') ? 'qc-tr-selectable' : ''}`}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('button')) return
                        if (q.status === 'waiting' || q.status === 'calling') {
                          setLockedVn(prev => prev === q.vn ? null : q.vn)
                        }
                      }}>
                      <td className="qc-td-select" onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={selectedKeys.includes(queueKeyOf(q))}
                          onChange={() => toggleSelectKey(queueKeyOf(q))} />
                        {channelByKey.has(queueKeyOf(q)) && (
                          <span className="qc-stage-tag" title="อยู่ในบอร์ดเตรียมคิว">{channelByKey.get(queueKeyOf(q))}</span>
                        )}
                      </td>
                      <td className="qc-td-date">
                        <div>{q.vstdate ? String(q.vstdate).substring(0, 10) : '—'}</div>
                        {q.vsttime && <div className="qc-td-time">{String(q.vsttime).substring(0, 5)}</div>}
                      </td>
                      <td className="qc-td-lab">
                        {(() => { const lx = labXrayMap[q.vn]
                          if (!lx) return null
                          const { confirm_report, lab_receive } = lx
                          if (confirm_report === 'Y') return (
                            <span className="lab-icon lab-icon-ready" title="ผล Lab ออกแล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 3h6v7l3 5H6l3-5V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M6 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="10" cy="15" r="1" fill="currentColor"/><circle cx="14" cy="13" r="1" fill="currentColor"/></svg>
                              <span className="lab-icon-label">ผลออก</span>
                            </span>
                          )
                          if (lab_receive === 'Y') return (
                            <span className="lab-icon lab-icon-received" title="ห้อง Lab รับแล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 3h6v7l3 5H6l3-5V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M6 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                              <span className="lab-icon-label">รับแล้ว</span>
                            </span>
                          )
                          return (
                            <span className="lab-icon lab-icon-ordered" title="สั่ง Lab แล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 3h6v7l3 5H6l3-5V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M6 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                              <span className="lab-icon-label">สั่ง</span>
                            </span>
                          )
                        })()}
                      </td>
                      <td className="qc-td-lab">
                        {(() => { const lx = labXrayMap[q.vn]
                          if (!lx) return null
                          const { xray_confirm, xray_confirm_radiology } = lx
                          if (xray_confirm_radiology === 'Y') return (
                            <span className="lab-icon xray-icon-taken" title="ถ่ายภาพแล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
                              <span className="lab-icon-label">ถ่ายแล้ว</span>
                            </span>
                          )
                          if (xray_confirm === 'Y') return (
                            <span className="lab-icon xray-icon-received" title="รับรายการ X-ray แล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8"/></svg>
                              <span className="lab-icon-label">รับแล้ว</span>
                            </span>
                          )
                          if (!xray_confirm && !xray_confirm_radiology) return null
                          return (
                            <span className="lab-icon xray-icon-ordered" title="สั่ง X-ray แล้ว">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><line x1="8" y1="9" x2="16" y2="15" stroke="currentColor" strokeWidth="1.5"/><line x1="16" y1="9" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5"/></svg>
                              <span className="lab-icon-label">สั่ง</span>
                            </span>
                          )
                        })()}
                      </td>
                      {(mode === 'slot' || mode === 'slot_cur') && <td className="qc-td-center"><span className="qc-slot-pill">{q.queue_slot ?? '—'}</span></td>}
                      <td className="qc-td-center"><span className="qc-qno-pill">{q.queue_no || '—'}</span></td>
                      <td className="qc-td-hn"><span>{q.hn || '—'}</span></td>
                      <td className="qc-td-name">
                        {q.queue_name || '—'}
                        {q.visit_type === 'appt' && q.doctor_name && (
                          <div className="qc-name-doctor">แพทย์ : {q.doctor_name}</div>
                        )}
                      </td>
                      <td className="qc-td-ins">{q.insurance || '—'}</td>
                      <td className="qc-td-dep">
                        {q.department || '—'}
                        {q.clinic_name && (
                          <div className="qc-clinic-name"><span className="qc-clinic-label">คลินิก : </span>{q.clinic_name}</div>
                        )}
                      </td>
                      <td className="qc-td-center">
                        <span className={`qc-visit-badge ${q.ist_name?.includes('นัด') ? 'vb-appt' : 'vb-walk'}`}>
                          {q.ist_name || '—'}
                        </span>
                        {q.ost_name && (
                          <div className="qc-ost-label">ส่งต่อ : {q.ost_name}</div>
                        )}
                      </td>
                      <td className="qc-td-center">
                        <span className={`qc-badge ${statusClass[q.status] || 'badge-waiting'}`}>
                          {statusLabel[q.status] || q.status}
                        </span>
                      </td>
                      <td className="qc-td-calltime">{callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn] || '—'}</td>
                      <td className="qc-td-action">
                        {q.status === 'waiting' && (
                          <button className="btn btn-primary qc-call-btn" onClick={() => handleCall(q)} disabled={!!callingId}>
                            {callingId === q.vn ? <span className="spinner" /> : '📢'} เรียก
                          </button>
                        )}
                        {q.status === 'calling' && (
                          <div className="qc-action-group">
                            <button className="btn btn-accent qc-recall-btn" onClick={() => handleCall(q)} disabled={!!callingId}>🔁</button>
                            <button className="btn btn-success qc-done-btn" onClick={() => handleStatusChange(q, 'done')}>✓</button>
                          </div>
                        )}
                        {(q.status === 'skip' || q.status === 'done') && (
                          <button className="btn btn-accent qc-recall-btn" onClick={() => handleCall(q)} disabled={!!callingId}
                            title="เรียกคิวซ้ำ">
                            {callingId === q.vn ? <span className="spinner" /> : '↻'} เรียกซ้ำ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

        {/* ─── Staging Board ─── */}
        {showBoard && selectedDisplay && boardChannels.length > 0 && (
          <aside className="qc-board">
            <div className="qc-board-head">
              <span className="qc-board-title">🗂 {selectedDisplay.name}</span>
              <div className="qc-board-chips">
                {boardChannels.map(ch => {
                  const on = !hiddenOnBoard.includes(ch)
                  return (
                    <button key={ch} className={`qc-board-chip${on ? ' on' : ''}`}
                      onClick={() => toggleChannelVisible(ch)}
                      title={on ? `ซ่อนช่อง ${ch}` : `แสดงช่อง ${ch}`}>
                      {on ? '👁' : '—'} ช่อง {ch}
                    </button>
                  )
                })}
              </div>
              <button className="qc-board-close" onClick={() => setShowBoard(false)} title="ปิดบอร์ด">✕</button>
            </div>
            <div className="qc-board-columns">
              {visibleChannels.length === 0 && (
                <div className="qc-box-empty">ทุกช่องถูกซ่อนอยู่ — กดชื่อช่องด้านบนเพื่อแสดง</div>
              )}
              {visibleChannels.map(ch => {
                const rows = boardQueuesOf(ch)
                return (
                  <div key={ch} className="qc-board-col">
                    <div className="qc-board-col-head">
                      <span>ช่อง {ch}</span>
                      <span className="qc-board-col-count">{rows.length}</span>
                    </div>
                    <div className="qc-board-col-list">
                      {rows.length === 0 ? (
                        <div className="qc-box-empty">ยังไม่มีคิว<br />เลือกคิวจากตารางแล้วกดช่องนี้</div>
                      ) : rows.map((q, i) => (
                        <div key={`${q.vn}-${i}`} className="qc-board-card">
                          <div className="qc-board-card-top">
                            <span className="qc-board-qno">{q.queue_slot || q.queue_no || '—'}</span>
                            <button className="qc-board-remove" title="นำออกจากบอร์ด"
                              onClick={() => moveKeysToChannel([queueKeyOf(q)], null)}>✕</button>
                          </div>
                          <div className="qc-board-card-name">{q.queue_name || '—'}</div>
                          <div className="qc-board-card-meta">
                            <span className={`qc-board-status s-${q.status}`}>{statusLabel[q.status] || q.status}</span>
                            {q.department || '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        )}
      </div>

      {/* ─── Confirmation Modal ─── */}
      {pendingCall && (
        <div className="qc-confirm-overlay" onClick={() => setPendingCall(null)}>
          <div className="qc-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="qc-confirm-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#00BCD4" strokeWidth="2" />
                <path d="M12 8v4M12 16h.01" stroke="#00BCD4" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="qc-confirm-title">ยืนยันการเรียกคิว</h3>
            <div className="qc-confirm-body">
              <div className="qc-confirm-no">{pendingCall.queue_slot || pendingCall.queue_no || '—'}</div>
              <p className="qc-confirm-name">{pendingCall.queue_name || '—'}</p>
              <p className="qc-confirm-meta">
                {pendingCall.department || '—'} &nbsp;·&nbsp; ช่อง <strong>{pendingCall ? (channelByKey.get(queueKeyOf(pendingCall)) || currentSpName) : currentSpName}</strong>
              </p>
            </div>
            <div className="qc-confirm-actions">
              <button className="btn btn-ghost qc-confirm-cancel" onClick={() => setPendingCall(null)}>
                ยกเลิก <span className="qc-kbd" style={{ background: 'rgba(0,0,0,0.08)', borderColor: 'rgba(0,0,0,0.15)', color: '#546E7A' }}>Esc</span>
              </button>
              <button className="btn btn-primary qc-confirm-ok" onClick={handleConfirm} disabled={!!callingId}>
                {callingId ? <span className="spinner" /> : null}
                📢 ยืนยันเรียกคิว <span className="qc-kbd">F1</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Keyboard Shortcut Help ─── */}
      {showShortcutHelp && (
        <div className="qc-confirm-overlay" onClick={() => setShowShortcutHelp(false)}>
          <div className="qc-shortcut-modal" onClick={e => e.stopPropagation()}>
            <div className="qc-shortcut-hd">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h4M18 14h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              คีย์ลัด (Keyboard Shortcuts)
              <button className="qc-shortcut-close" onClick={() => setShowShortcutHelp(false)}>✕</button>
            </div>
            <div className="qc-shortcut-body">
              <div className="qc-shortcut-section">การเรียกคิว</div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>F1</kbd></span>
                <span className="qc-shortcut-desc">ยืนยันเรียกคิว (เมื่อ dialog เปิดอยู่)</span>
              </div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>F2</kbd></span>
                <span className="qc-shortcut-desc">เรียกคิวถัดไป</span>
              </div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>F3</kbd></span>
                <span className="qc-shortcut-desc">เรียกซ้ำ (Recall)</span>
              </div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>F4</kbd></span>
                <span className="qc-shortcut-desc">ไม่มา (No-show)</span>
              </div>
              <div className="qc-shortcut-section" style={{ marginTop: 12 }}>ทั่วไป</div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>Esc</kbd></span>
                <span className="qc-shortcut-desc">ยกเลิก / ปิด dialog</span>
              </div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>?</kbd></span>
                <span className="qc-shortcut-desc">เปิด/ปิดหน้าต่างนี้</span>
              </div>
              <div className="qc-shortcut-row">
                <span className="qc-shortcut-keys"><kbd>ตัวเลข / ตัวอักษร</kbd></span>
                <span className="qc-shortcut-desc">เรียกตามเลขคิว / HN</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {checkDisplayPopup && (
        <div className="qc-check-display-popup"
          style={{ top: checkDisplayPopup.py, left: checkDisplayPopup.px }}
          onClick={() => setCheckDisplayPopup(null)}>
          <div className="qc-check-display-inner">
            <div className="qc-check-display-icon">🖥️</div>
            <div className="qc-check-display-no">{checkDisplayPopup.queueNo}</div>
            <div className="qc-check-display-sp">{checkDisplayPopup.sp}</div>
            <div className="qc-check-display-msg">กรุณาตรวจสอบจุดแสดงคิว</div>
          </div>
        </div>
      )}

      {deptMismatchWarning && (
        <div className="qc-dept-mismatch-popup"
          style={{ top: deptMismatchWarning.py, left: deptMismatchWarning.px }}
          onClick={() => setDeptMismatchWarning(null)}>
          <div className="qc-dept-mismatch-inner">
            <div className="qc-dept-mismatch-icon">⚠️</div>
            <div className="qc-dept-mismatch-no">{deptMismatchWarning.queueNo}</div>
            <div className="qc-dept-mismatch-dept">{deptMismatchWarning.dept}</div>
            <div className="qc-dept-mismatch-msg">ไม่ตรงกับจอ · {deptMismatchWarning.displayName}</div>
          </div>
        </div>
      )}

    </div>
  )
}
