import { useState, useEffect, useCallback, useRef } from 'react'
import { getQueueList, callQueue, onQueueCalled, onQueueAudio, updateQueueStatus, getDisplayConfigs, getDisplayQDConfig, getCallsToday, prewarmTTS, getQueueStaging, type QueueStagingMap } from '../lib/api'
import './QueueMini.css'

type QueueStatus = 'waiting' | 'calling' | 'done' | 'skip'
type QueueRow = QueueItem & { status: QueueStatus }
type QueueMode = 'slot' | 'opd' | 'slot_cur' | 'cur_dep'

export default function QueueMiniPage() {
  const [queues, setQueues] = useState<QueueRow[]>([])
  const [staging, setStaging] = useState<QueueStagingMap>({})
  const [displayConfigs, setDisplayConfigs] = useState<DisplayConfigItem[]>([])
  // On open: sync from main page via loadDisplays (reads fresh localStorage after async)
  // These start empty/default and are overwritten by loadDisplays on mount
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>('')
  const [selectedChannel, setSelectedChannel] = useState<string>('')
  const [mode, setMode] = useState<QueueMode>(
    () => (localStorage.getItem('qc_mode') as QueueMode) || 'slot'
  )
  const [currentCalled, setCurrentCalled] = useState<{ queueNo: string; servicePoint: string } | null>(null)
  const [callingId, setCallingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [manualVal, setManualVal] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [qdFilterDepts, setQdFilterDepts] = useState<string[]>([])
  const [selectedDept, setSelectedDept] = useState<string>(() => {
    try {
      const depts: string[] = JSON.parse(localStorage.getItem('qc_filter_depts') || '[]')
      return depts.length === 1 ? depts[0] : ''
    } catch { return '' }
  })
  // Inherited from the main queue-call page — "เฉพาะคนไข้นัด/Walk-in" + doctor selection —
  // so opening Mini shows the same waiting-queue set the main page has filtered to.
  const [visitFilter, setVisitFilter] = useState<'all' | 'appt' | 'walkin'>(
    () => (localStorage.getItem('qc_visit_filter') as 'all' | 'appt' | 'walkin') || 'all'
  )
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('qc_selected_doctors') || '[]') } catch { return [] }
  })
  // Browser popups cannot be truly hidden (a platform anti-abuse limit, not a bug we can
  // code around), and the Document Picture-in-Picture lock needs one to stay open as its anchor —
  // so the always-on-top lock is Electron-only. Browser mode starts unlocked and never offers it.
  const [locked, setLocked] = useState(() => navigator.userAgent.includes('Electron') || window.location.hash.includes('electron=1'))
  const [listView, setListView] = useState<'' | 'waiting' | 'done' | 'skip'>('')
  const [confirmEnabled, setConfirmEnabled] = useState(() => localStorage.getItem('qc_confirm') === 'true')
  const [pendingCall, setPendingCall] = useState<{ vn: string; queueNo: string } | null>(null)
  // true = running inside the actual native Electron Mini BrowserWindow.
  // Checked via the user agent (Electron's Chromium always includes "Electron/") rather than
  // relying solely on the ?electron=1 URL flag — that flag can survive a reload/redirect
  // incorrectly and cause the real Mini window to loop back into the "opening…" placeholder
  // instead of showing the actual calling UI.
  const isElectronWindow = navigator.userAgent.includes('Electron') || window.location.hash.includes('electron=1')
  const [electronOpened, setElectronOpened] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const lastCalledVnRef = useRef<string | null>(null)
  const currentSpNameRef = useRef<string>('')
  const selectedDisplayIdRef = useRef<string>('')
  const callNextBtnRef = useRef<HTMLButtonElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const keepFocusRef = useRef(false)
  const keepFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const selectedDisplay = displayConfigs.find(d => d.id === selectedDisplayId)
  const displayChannels: string[] = selectedDisplay?.channels || []
  const currentSpName = selectedChannel || displayChannels[0] || ''

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t) }, [])

  const loadDisplays = useCallback(async () => {
    try {
      const data = await getDisplayConfigs()
      setDisplayConfigs(data)
      // Always read fresh from localStorage (main page writes here on every change)
      const activeDisplay = localStorage.getItem('qc_active_display') || ''
      const activeSp = localStorage.getItem('qc_active_sp') || ''
      setSelectedDisplayId(
        activeDisplay && data.find(d => d.id === activeDisplay)
          ? activeDisplay
          : (data[0]?.id || '')
      )
      setSelectedChannel(activeSp)
    } catch {}
  }, [])

  const loadStaging = useCallback(() => { getQueueStaging().then(setStaging).catch(() => {}) }, [])
  useEffect(() => {
    loadStaging()
    const t = setInterval(loadStaging, 15000)
    return () => clearInterval(t)
  }, [loadStaging])

  const loadQueues = useCallback(async () => {
    try {
      const [res, calls] = await Promise.all([getQueueList(mode), getCallsToday(mode)])
      if (res.success) {
        const rows = res.data as QueueRow[]
        setQueues(rows)
        const sp = currentSpNameRef.current
        const did = selectedDisplayIdRef.current
        if (sp && did) {
          // r.status is already accurate per-slot (server keys call status by vn+queue_slot),
          // so no need to cross-reference the calls array here.
          const waiting = rows
            .filter(r => r.status === 'waiting')
            .slice(0, 5)
            .map(r => ({ no: String(r.queue_slot || r.queue_no || ''), name: r.queue_name || '' }))
          if (waiting.length) prewarmTTS(waiting, sp, did)
        }
        setCurrentCalled(prev => {
          if (prev) return prev
          // จำกัดเฉพาะแถวที่กำลังเรียกโดยช่องบริการของเครื่องนี้ ไม่เอาของช่องอื่นมาแสดง
          const callingRows = rows.filter(r => r.status === 'calling' && r.service_point === currentSpNameRef.current)
          if (!callingRows.length) return null
          // A VN can have multiple opd_qs_slot rows (Queue_Prefix) each with their own call
          // entry — match by queue_slot too when the row has one, not vn alone.
          const findCall = (r: QueueRow) => calls.find((c: { vn: string; queueNo?: string; calledAt?: string }) =>
            c.vn === r.vn && (!r.queue_slot || !c.queueNo || c.queueNo === r.queue_slot)
          )
          const latest = callingRows.reduce((best, r) => {
            const t = findCall(r)?.calledAt || ''
            const bestT = findCall(best)?.calledAt || ''
            return t > bestT ? r : best
          })
          if (!lastCalledVnRef.current) lastCalledVnRef.current = latest.vn
          return { queueNo: String(latest.queue_slot || latest.queue_no || ''), servicePoint: latest.service_point || '' }
        })
      }
    } catch {}
    finally { setLoading(false) }
  }, [mode])

  useEffect(() => {
    currentSpNameRef.current = currentSpName
    selectedDisplayIdRef.current = selectedDisplayId
  }, [currentSpName, selectedDisplayId])

  // Lock:
  // - Electron window: fullscreen, on top of the OS-level alwaysOnTop the window already has.
  // - Browser popup: move the panel into a Document Picture-in-Picture window — a real
  //   always-on-top floating window that never falls behind other apps and never goes fullscreen.
  // Always-on-top lock is Electron-only — plain browser mode has no way to float a window above
  // every other app without leaving a second (Document Picture-in-Picture) window behind, which
  // was explicitly ruled out. The lock button itself is hidden for non-Electron, so this should
  // never fire there, but the guard stays as a safety net.
  const handleLockToggle = async () => {
    if (!isElectronWindow) return
    if (!locked) {
      try {
        await document.documentElement.requestFullscreen()
        setLocked(true)
      } catch (e) {
        flash(false, `ล็อกเต็มจอไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch {}
      setLocked(false)
    }
  }

  // Sync lock state when user exits Electron fullscreen via Esc
  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setLocked(false) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Shrink to a small floating icon so the Mini window stops covering the screen.
  // - Real Electron window: shrinks the actual OS window via IPC (already alwaysOnTop natively).
  // - Browser: shrink the actual popup window via resizeTo/moveTo (only works because it was
  //   opened via window.open from the NavBar "Mini" button — browsers allow a script-opened
  //   window to resize/move itself). No second window is ever opened for this.
  const ICON_INNER = 90
  const handleMinimizeToIcon = async () => {
    setMinimized(true)
    if (isElectronWindow) {
      if (document.fullscreenElement) { try { await document.exitFullscreen() } catch {} }
      window.electronAPI?.minimizeMiniWindow?.()
    } else {
      try {
        popupBoundsRef.current = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }
        const chromeW = window.outerWidth - window.innerWidth
        const chromeH = window.outerHeight - window.innerHeight
        const w = ICON_INNER + chromeW, h = ICON_INNER + chromeH
        window.resizeTo(w, h)
        window.moveTo(
          Math.max(0, window.screen.availWidth - w - 16),
          Math.max(0, window.screen.availHeight - h - 16)
        )
      } catch {}
    }
  }
  const handleRestoreFromIcon = async () => {
    setMinimized(false)
    if (isElectronWindow) {
      window.electronAPI?.restoreMiniWindow?.()
    } else {
      try {
        const b = popupBoundsRef.current
        if (b) { window.resizeTo(b.w, b.h); window.moveTo(b.x, b.y) }
        popupBoundsRef.current = null
      } catch {}
    }
  }

  // Auto-open as locked Electron window when loaded in browser (not ?electron=1)
  useEffect(() => {
    if (isElectronWindow) return
    fetch('/api/open-mini')
      .then(r => r.json())
      .then(d => { if (d.success) setElectronOpened(true) })
      .catch(() => {})
  }, [])

  useEffect(() => { loadDisplays() }, [loadDisplays])
  useEffect(() => { loadQueues() }, [loadQueues])
  useEffect(() => { const t = setInterval(loadQueues, 15000); return () => clearInterval(t) }, [loadQueues])

  useEffect(() => {
    const off = onQueueCalled(data => {
      // อัปเดตกล่อง "กำลังให้บริการ" เฉพาะคิวที่เรียกจากช่องบริการของเครื่องนี้ ไม่ให้ช่องอื่นมาทับ
      if (data.servicePoint === currentSpNameRef.current) {
        setCurrentCalled(data)
        setQueues(prev => {
          const row = prev.find(q => String(q.queue_slot || q.queue_no || '') === String(data.queueNo))
          if (row) lastCalledVnRef.current = row.vn
          return prev
        })
      }
      loadQueues()
    })
    return off
  }, [loadQueues])

  useEffect(() => {
    if (!selectedDisplayId) { setQdFilterDepts([]); return }
    getDisplayQDConfig(selectedDisplayId).then(cfg => {
      const depts = cfg?.filterDepts
      setQdFilterDepts(Array.isArray(depts) ? (depts as string[]) : [])
    })
  }, [selectedDisplayId])


  // Sync display/channel/mode/dept changes from main page in real-time
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'qc_mode' && e.newValue) setMode(e.newValue as QueueMode)
      if (e.key === 'qc_active_display') setSelectedDisplayId(e.newValue || '')
      if (e.key === 'qc_staging_at') loadStaging()
      if (e.key === 'qc_active_sp') setSelectedChannel(e.newValue || '')
      if (e.key === 'qc_filter_depts') {
        try {
          const depts: string[] = JSON.parse(e.newValue || '[]')
          setSelectedDept(depts.length === 1 ? depts[0] : '')
        } catch {}
      }
      if (e.key === 'qc_visit_filter') setVisitFilter((e.newValue as 'all' | 'appt' | 'walkin') || 'all')
      if (e.key === 'qc_selected_doctors') {
        try { setSelectedDoctors(JSON.parse(e.newValue || '[]')) } catch {}
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3000)
  }

  // A queue parked on the selected display's board calls into its channel; anything else uses the selected ช่องบริการ.
  // Reads the cached board (kept fresh by the main page's storage signal and a periodic reload) so the call isn't delayed by a round trip.
  const servicePointFor = (vn: string): string => {
    const q = queues.find(r => (r.queue_slot || r.vn) === vn)
    if (!q || !selectedDisplayId) return currentSpName
    const key = q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn
    const board = staging[selectedDisplayId] || {}
    return Object.keys(board).find(ch => (board[ch] || []).includes(key)) || currentSpName
  }

  const executeCall = async (vn: string, queueNo?: string) => {
    window.focus()
    // Schedule focus retries after call — using moveBy(0,0) which Edge allows for popups
    // Covers the ~3s window when display audio starts playing and Edge might push mini behind.
    // Only nudges when focus was actually lost — doing it unconditionally every time made the
    // window visibly jump/flicker on every single call, even when it never lost focus at all.
    keepFocusRef.current = true
    if (keepFocusTimerRef.current) clearTimeout(keepFocusTimerRef.current)
    keepFocusTimerRef.current = setTimeout(() => { keepFocusRef.current = false }, 8000)
    ;[500, 1500, 2500, 3500, 4500, 5500].forEach(t =>
      setTimeout(() => {
        if (!keepFocusRef.current) return
        if (document.hasFocus()) return
        try { window.focus() } catch {}
        try { window.moveBy(0, 0) } catch {}
      }, t)
    )
    setCallingId(vn)
    try {
      const sp = servicePointFor(vn)
      const res = await callQueue(vn, sp, mode, selectedDisplayId || undefined)
      if (res.success) {
        lastCalledVnRef.current = vn
        const calledNo = res.queueNo || queueNo || vn
        setCurrentCalled({ queueNo: calledNo, servicePoint: sp })
        flash(true, `เรียก ${calledNo} สำเร็จ`)
        window.focus()
        loadQueues()
      } else {
        flash(false, res.message || 'ไม่สำเร็จ')
      }
    } catch { flash(false, 'เกิดข้อผิดพลาด') }
    finally { setCallingId(null) }
  }

  const doCall = (vn: string, queueNo?: string) => {
    if (confirmEnabled) { setPendingCall({ vn, queueNo: queueNo || vn }); return }
    executeCall(vn, queueNo)
  }

  const handleConfirm = async () => {
    if (!pendingCall) return
    const { vn, queueNo } = pendingCall
    setPendingCall(null)
    await executeCall(vn, queueNo)
  }

  const handleCallNext = () => {
    // byDeptFilter: specific dept → filter that dept; '' (ทุกห้อง) → filter by display's qdFilterDepts.
    const next = [...queues]
      .filter(q => q.status === 'waiting' && byDeptFilter(q))
      .sort((a, b) => {
        // Queue_Prefix/Queue_Prefix_Room: sort by queue_slot (prefix, then numeric suffix) —
        // matches the order shown on the main queue-call page for the same ห้องตรวจ filter.
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
        // Sort by oqueue (queue_no) ascending — matches ovst.oqueue order requested by user.
        const an = parseInt(String(a.queue_no || a.queue_slot || ''), 10)
        const bn = parseInt(String(b.queue_no || b.queue_slot || ''), 10)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        if (!isNaN(an)) return -1
        if (!isNaN(bn)) return 1
        return 0
      })[0]
    // queue_slot is unique per opd_qs_slot row — a VN can have multiple rows (one per
    // doctor/service point), so calling by bare VN could match a different doctor's slot.
    if (next) doCall(next.queue_slot || next.vn, String(next.queue_slot || next.queue_no || ''))
  }

  const handleRecall = () => {
    if (!currentCalled) return
    const callingRow = queues.find(q =>
      String(q.queue_slot || q.queue_no || '') === String(currentCalled.queueNo)
    )
    const identifier = (callingRow ? (callingRow.queue_slot || callingRow.vn) : null) ?? lastCalledVnRef.current ?? String(currentCalled.queueNo)
    doCall(identifier, String(currentCalled.queueNo))
  }

  const handleNoShow = async () => {
    const cur = queues.find(q => q.status === 'calling' && byDeptFilter(q))
    if (!cur) return
    try { await updateQueueStatus(cur.vn, 'skip', { queueSlot: cur.queue_slot }); setCurrentCalled(null); loadQueues() } catch {}
  }

  const handleManualCall = async (e: React.FormEvent) => {
    e.preventDefault()
    const val = manualVal.trim()
    if (!val) return
    setManualLoading(true)
    try {
      // When a specific ห้องตรวจ is filtered, resolve against ONLY the filtered rows first — a VN
      // can have multiple opd_qs_slot records (one per doctor), so calling by bare VN/HN could
      // match a different doctor's slot than the one currently filtered.
      let callVal = val
      if (selectedDept) {
        const match = queues.find(q =>
          byDeptFilter(q) &&
          (String(q.vn) === val || String(q.hn || '') === val ||
           String(q.queue_no ?? '') === val || String(q.queue_slot || '') === val)
        )
        if (!match) {
          flash(false, 'ไม่พบคิวนี้ในห้องตรวจที่กรองไว้')
          setManualLoading(false)
          return
        }
        callVal = match.queue_slot || match.vn
      }
      const res = await callQueue(callVal, currentSpName, mode, selectedDisplayId || undefined)
      if (res.success) {
        setCurrentCalled({ queueNo: res.queueNo || val, servicePoint: currentSpName })
        setManualVal('')
        flash(true, `เรียกคิว ${res.queueNo || val} สำเร็จ`)
        loadQueues()
      } else { flash(false, res.message || 'ไม่พบคิว') }
    } catch { flash(false, 'เกิดข้อผิดพลาด') }
    finally { setManualLoading(false); manualRef.current?.focus() }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (pendingCall) {
        if (e.key === 'Enter' || e.key === 'F1') { e.preventDefault(); handleConfirm() }
        if (e.key === 'Escape') { e.preventDefault(); setPendingCall(null) }
        return
      }
      if (e.key === 'F2') { e.preventDefault(); window.focus(); handleCallNext() }
      if (e.key === 'F3') { e.preventDefault(); window.focus(); handleRecall() }
      if (e.key === 'F4') { e.preventDefault(); handleNoShow() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  // Same "ห้องตรวจ" grouping key as the main queue-call page: Queue_Prefix (slot) groups by the
  // queue-slot's assigned doctor/category (opd_qs_slot.doctor_code) instead of kskdepartment.
  const roomKeyOf = (q: QueueRow) => mode === 'slot' ? (q.slot_doctor_name || '') : (q.department || '')
  const deptOptions = Array.from(new Set(queues.map(roomKeyOf).filter(Boolean))).sort()
  const byDeptFilter = (q: QueueRow) => {
    const matchDept = !selectedDept || roomKeyOf(q) === selectedDept
    const matchVisit = visitFilter === 'all' || q.visit_type === visitFilter
    const matchDoctor = visitFilter !== 'appt' || selectedDoctors.length === 0 || (!!q.doctor_name && selectedDoctors.includes(q.doctor_name))
    return matchDept && matchVisit && matchDoctor
  }
  const waiting = queues.filter(q => q.status === 'waiting' && byDeptFilter(q)).length
  const hasCalling = queues.some(q => q.status === 'calling' && byDeptFilter(q))
  const listQueues = listView ? queues.filter(q => q.status === listView && byDeptFilter(q)) : []
  const listLabel: Record<string, string> = { waiting: 'รอเรียก', done: 'เรียกแล้ว', skip: 'ไม่มา' }

  const renderOutput = (node: JSX.Element) => node

  // Show redirect page when Electron window was opened successfully
  if (electronOpened) {
    return renderOutput(
      <div className="qm-bg" style={{ alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 52 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0D47A1' }}>เปิดหน้าต่าง Mini แล้ว</div>
        <div style={{ fontSize: 13, color: '#546E7A' }}>ปิดหน้าต่างนี้ได้</div>
        <button style={{ marginTop: 8, padding: '8px 20px', borderRadius: 10, border: 'none', background: '#1565C0', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          onClick={() => window.close()}>ปิด</button>
      </div>
    )
  }

  // Minimized: shrink to a small floating icon — click once to bring the calling panel back
  if (minimized) {
    return renderOutput(
      <div className="qm-bubble-wrap" onClick={handleRestoreFromIcon} title="เปิดหน้าเรียกคิว">
        <div className="qm-bubble-face">
          {waiting > 0 && <span className="qm-bubble-badge">{waiting}</span>}
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M8 12h8M8 8h5M8 16h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )
  }

  return renderOutput(
    <div className="qm-bg">
      <header className="qm-header">
        <div className="qm-header-left">
          <span className="qm-logo">Q</span>
          <span className="qm-title">เรียกคิว</span>
          <button
            className={`qm-mode-badge ${mode === 'opd' ? 'opd' : ''}`}
            onClick={() => { const n: QueueMode = mode === 'slot' ? 'opd' : 'slot'; setMode(n); localStorage.setItem('qc_mode', n); setQueues([]); setCurrentCalled(null) }}
            title={mode === 'slot' ? 'HOSxP Queue' : 'OPD Visit'}
          >{mode === 'slot' ? 'HQ' : 'OPD'}</button>
        </div>
        <div className="qm-header-right">
          <span className="qm-clock">{clock.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <button
            className="qm-minimize-btn"
            onClick={handleMinimizeToIcon}
            title="ย่อเป็นไอคอน — ลอยเล็กมุมจอ ไม่บังงานอื่น"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
          {isElectronWindow && (
            <button
              className={`qm-lock-btn${locked ? ' on' : ''}`}
              onClick={handleLockToggle}
              title={locked ? 'เต็มจอ (กด Esc เพื่อออก)' : 'ล็อกหน้าจอ — เปิดเต็มจอป้องกันย่อ'}
            >{locked ? '🔒' : '🔓'}</button>
          )}
        </div>
      </header>

      {/* Room/department selector */}
      <div className="qm-dept-bar">
        <span className="qm-dept-label">ห้องตรวจ</span>
        <select className="qm-dept-select" value={selectedDept} onChange={e => setSelectedDept(e.target.value)}>
          <option value="">ทุกห้อง ({queues.filter(q => q.status === 'waiting' && (visitFilter === 'all' || q.visit_type === visitFilter)).length})</option>
          {deptOptions.map(d => (
            <option key={d} value={d}>{d} ({queues.filter(q => q.status === 'waiting' && roomKeyOf(q) === d && (visitFilter === 'all' || q.visit_type === visitFilter)).length})</option>
          ))}
        </select>
      </div>

      {(visitFilter !== 'all' || selectedDoctors.length > 0) && (
        <div className="qm-inherited-filter">
          กรองตามหน้าหลัก: {visitFilter === 'appt' ? 'เฉพาะคนไข้นัด' : visitFilter === 'walkin' ? 'เฉพาะ Walk-in' : ''}
          {visitFilter === 'appt' && selectedDoctors.length > 0 && ` · ${selectedDoctors.join(', ')}`}
        </div>
      )}

      {/* Display & channel selectors */}
      <div className="qm-serve-card">
        <div className="qm-serve-card-top">
          <span className="qm-serve-label">กำลังให้บริการ</span>
          <div className="qm-serve-selectors">
            <select className="qm-serve-display-select" value={selectedDisplayId}
              onChange={e => { const id = e.target.value; setSelectedDisplayId(id); const disp = displayConfigs.find(d => d.id === id); const ch = disp?.channels?.[0] || ''; setSelectedChannel(ch) }}>
              {displayConfigs.length === 0
                ? <option value="">ไม่มีจอ</option>
                : displayConfigs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {displayChannels.length > 0 && (
              <select className="qm-serve-sp-select" value={selectedChannel || displayChannels[0]}
                onChange={e => setSelectedChannel(e.target.value)}>
                {displayChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            )}
          </div>
        </div>
        {currentCalled
          ? <div className="qm-serve-no">{currentCalled.queueNo}</div>
          : <div className="qm-serve-empty">—</div>}
      </div>

      {/* Action buttons OR list view */}
      {listView ? (
        <>
          <div className="qm-list-header">
            <span className="qm-list-title">{listLabel[listView]}</span>
            <button className="qm-back-btn" onClick={() => setListView('')}>✕ ปิด</button>
          </div>
          <div className="qm-list-wrap">
            {listQueues.length === 0
              ? <div className="qm-list-empty">ไม่มีรายการ</div>
              : listQueues.map(q => (
                <div key={q.vn} className={`qm-list-item qm-li-${q.status}`}>
                  <span className="qm-li-qno">{q.queue_slot || q.queue_no || '—'}</span>
                  <div className="qm-li-info">
                    <div className="qm-li-name">{q.queue_name || '—'}</div>
                    <div className="qm-li-meta">{q.department || ''}</div>
                  </div>
                  <button
                    className={`qm-li-call-btn${q.status !== 'waiting' ? ' recall' : ''}`}
                    disabled={!!callingId}
                    onClick={() => { doCall(q.queue_slot || q.vn, String(q.queue_slot || q.queue_no || '')); setListView('') }}
                  >{q.status === 'waiting' ? '▶' : '↻'}</button>
                </div>
              ))
            }
          </div>
        </>
      ) : (
        <>
          <div className="qm-actions">
            <button ref={callNextBtnRef} className="qm-btn qm-btn-next" onClick={handleCallNext}
              disabled={!!callingId || (!loading && !waiting)}>
              {loading || callingId ? <span className="qm-spinner" /> : <span>▶</span>}
              {loading ? 'กำลังโหลด...' : !waiting ? 'ไม่มีคิวรอ' : 'เรียกถัดไป'}
              <kbd className="qm-kbd">F2</kbd>
            </button>
            <div className="qm-actions-row2">
              <button className="qm-btn qm-btn-recall" onClick={handleRecall} disabled={!!callingId || !currentCalled}>
                <span>↻</span> เรียกซ้ำ <kbd className="qm-kbd">F3</kbd>
              </button>
              <button className="qm-btn qm-btn-noshow" onClick={handleNoShow} disabled={!!callingId || !hasCalling}>
                <span>✕</span> ไม่มา <kbd className="qm-kbd">F4</kbd>
              </button>
            </div>
          </div>
          <form className="qm-manual" onSubmit={handleManualCall}>
            <input ref={manualRef} className="qm-manual-input" type="text" placeholder="QN / HN / ยิงบาร์โค้ด..."
              value={manualVal} onChange={e => setManualVal(e.target.value)} disabled={manualLoading} autoFocus />
            <button className="qm-manual-btn" type="submit" disabled={manualLoading || !manualVal.trim()}>
              {manualLoading ? <span className="qm-spinner" /> : '📢'}
            </button>
          </form>
          <label className="qm-confirm-toggle">
            <div className={`qm-toggle-track${confirmEnabled ? ' on' : ''}`}>
              <input type="checkbox" checked={confirmEnabled} onChange={e => {
                setConfirmEnabled(e.target.checked)
                localStorage.setItem('qc_confirm', String(e.target.checked))
              }} style={{ display: 'none' }} />
              <div className="qm-toggle-thumb" />
            </div>
            <span>ยืนยันก่อนเรียกคิว</span>
          </label>
        </>
      )}

      {/* Confirm modal */}
      {pendingCall && (() => {
        const row = queues.find(q => q.vn === pendingCall.vn)
        return (
          <div className="qm-confirm-overlay" onClick={() => setPendingCall(null)}>
            <div className="qm-confirm-modal" onClick={e => e.stopPropagation()}>
              <div className="qm-confirm-no">{pendingCall.queueNo}</div>
              {row?.queue_name && <div className="qm-confirm-name">{row.queue_name}</div>}
              {row?.department && <div className="qm-confirm-dept">{row.department}</div>}
              <div className="qm-confirm-actions">
                <button className="qm-confirm-cancel" onClick={() => setPendingCall(null)}>
                  ยกเลิก <kbd className="qm-kbd">Esc</kbd>
                </button>
                <button className="qm-confirm-ok" onClick={handleConfirm} disabled={!!callingId}>
                  {callingId ? <span className="qm-spinner" /> : '📢'} ยืนยัน <kbd className="qm-kbd">Enter</kbd>
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Stats — clickable to open list view */}
      <div className="qm-stats">
        <div className={`qm-stat waiting${listView === 'waiting' ? ' qm-stat-on' : ''}`}
          onClick={() => setListView(v => v === 'waiting' ? '' : 'waiting')}>
          <span>{waiting}</span><label>รอเรียก</label>
        </div>
        <div className={`qm-stat done${listView === 'done' ? ' qm-stat-on' : ''}`}
          onClick={() => setListView(v => v === 'done' ? '' : 'done')}>
          <span>{queues.filter(q => q.status === 'done').length}</span><label>แล้ว</label>
        </div>
        <div className={`qm-stat skip${listView === 'skip' ? ' qm-stat-on' : ''}`}
          onClick={() => setListView(v => v === 'skip' ? '' : 'skip')}>
          <span>{queues.filter(q => q.status === 'skip').length}</span><label>ไม่มา</label>
        </div>
      </div>

      {msg && <div className={`qm-toast ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  )
}
