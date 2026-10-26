import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getQueueList, callQueue, updateQueueStatus, getServicePoints, getDisplayConfigs, getCallsToday, type CallEntry } from '../lib/api'
import './QueueHistory.css'

type HistoryMode = 'slot' | 'opd' | 'cur_dep' | 'slot_cur'

const MODE_LABELS: Record<HistoryMode, string> = {
  slot: 'คิวซักประวัติ',
  slot_cur: 'คิวห้องตรวจ',
  opd: 'QN ทั่วไป',
  cur_dep: 'QN ห้องตรวจ',
}
const MODE_GROUP: Record<HistoryMode, 'prefix' | 'opd'> = {
  slot: 'prefix', slot_cur: 'prefix',
  opd: 'opd', cur_dep: 'opd',
}

export default function QueueHistoryPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<HistoryMode>(() => (localStorage.getItem('qh_mode') as HistoryMode) || 'slot')
  const [queues, setQueues] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [servicePoints, setServicePoints] = useState<ServicePoint[]>([])
  const [servicePoint, setServicePoint] = useState(sessionStorage.getItem('lastSP') || '')
  // Which display's TTS voice/settings to use when recalling — shares the same localStorage key
  // the main queue-call page keeps live-synced, so picking a display here (or there) carries over.
  const [displayConfigs, setDisplayConfigs] = useState<DisplayConfigItem[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState(() => localStorage.getItem('qc_active_display') || '')
  // Default to showing ALL departments — history should show everything by default,
  // not silently inherit the call page's single-dept filter (which can hide all data
  // if the done/skip records belong to a different department than what's filtered there)
  const [filterDept, setFilterDept] = useState<string>('')
  const [callTimeMap, setCallTimeMap] = useState<Record<string, string>>({})
  const [actionId, setActionId] = useState<string | null>(null)
  const [clock, setClock] = useState(new Date())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showCleared, setShowCleared] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, calls] = await Promise.all([getQueueList(mode), getCallsToday(mode)])
      if (res.success) setQueues(res.data)
      const map: Record<string, string> = {}
      calls.forEach((c: CallEntry) => {
        if (!c.vn || !c.calledAt) return
        map[c.vn] = c.calledAt
        if (c.queueNo) map[`${c.vn}::${c.queueNo}`] = c.calledAt
      })
      setCallTimeMap(prev => ({ ...prev, ...map }))
    } catch {}
    setLoading(false)
  }, [mode])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    getServicePoints().then(sps => {
      setServicePoints(sps)
      setServicePoint(prev => {
        if (prev && sps.some(s => s.name === prev || s.id === prev)) return prev
        return sps[0]?.name || ''
      })
    })
  }, [])

  useEffect(() => { getDisplayConfigs().then(setDisplayConfigs) }, [])

  // Live-sync with the main queue-call page — matches the pattern it already uses for Mini.
  useEffect(() => {
    try { localStorage.setItem('qc_active_display', selectedDisplayId) } catch {}
  }, [selectedDisplayId])
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'qc_active_display') setSelectedDisplayId(e.newValue || '')
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const selectedDisplay = displayConfigs.find(d => d.id === selectedDisplayId)
  const displayChannels = selectedDisplay?.channels || []
  const useDisplayChannels = selectedDisplayId !== '' && displayChannels.length > 0

  // When a display with its own channels is picked, "ช่องที่ใช้เรียกซ้ำ" should offer THAT
  // display's channels instead of the global service-point list — keeps the value consistent
  // with the channel names actually announced on this display. Falls back to the first global
  // service point again if the display is cleared (or its channels no longer include the
  // currently selected value).
  useEffect(() => {
    if (useDisplayChannels) {
      setServicePoint(prev => (prev && displayChannels.includes(prev)) ? prev : displayChannels[0])
    } else {
      setServicePoint(prev => (prev && servicePoints.some(s => s.name === prev)) ? prev : (servicePoints[0]?.name || ''))
    }
  }, [useDisplayChannels, displayChannels, servicePoints])

  const deptOptions = Array.from(new Set(queues.map(q => q.department).filter(Boolean))).sort()
  const doneQueues    = queues.filter(q => q.status === 'done'    && (!filterDept || q.department === filterDept))
  const skipQueues    = queues.filter(q => q.status === 'skip'    && (!filterDept || q.department === filterDept))
  const clearedQueues = queues.filter(q => q.status === 'cleared' && (!filterDept || q.department === filterDept))

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3000)
  }

  // ── Recall ────────────────────────────────────────────────────────────────
  const handleRecall = async (q: QueueItem) => {
    setActionId(q.vn)
    try {
      // queue_slot is unique per opd_qs_slot row — a VN can have multiple rows (one per
      // doctor/service point), so calling by bare VN could recall a different doctor's slot.
      // Without a displayConfigId the server falls back to the global default qd-config for
      // TTS, which can use a different voice than the display this queue actually belongs to.
      const res = await callQueue(q.queue_slot || q.vn, servicePoint, mode, selectedDisplayId || undefined)
      if (res.success) {
        const calledAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        setCallTimeMap(prev => ({
          ...prev,
          [q.vn]: calledAt,
          ...(q.queue_slot ? { [`${q.vn}::${q.queue_slot}`]: calledAt } : {})
        }))
        flash(true, `เรียกซ้ำ ${res.queueNo || q.queue_slot || q.queue_no} สำเร็จ`)
        load()
      } else {
        flash(false, res.message || 'ไม่สำเร็จ')
      }
    } catch {
      flash(false, 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setActionId(null)
    }
  }

  // ── Return to waiting ─────────────────────────────────────────────────────
  const handleReturn = async (q: QueueItem) => {
    setActionId(q.vn + '_r')
    try {
      await updateQueueStatus(q.vn, 'waiting', { queueSlot: q.queue_slot })
      flash(true, `คืนคิว ${q.queue_slot || q.queue_no} สำเร็จ`)
      load()
    } catch {
      flash(false, 'เกิดข้อผิดพลาด')
    } finally {
      setActionId(null)
    }
  }

  const handleReturnGroup = async (group: QueueItem[], label: string, key: string) => {
    if (group.length === 0) return
    setActionId(key)
    try {
      await Promise.all(group.map(q => updateQueueStatus(q.vn, 'waiting', { queueSlot: q.queue_slot })))
      flash(true, `คืนคิว${label} ${group.length} รายการ สำเร็จ`)
      load()
    } catch {
      flash(false, 'เกิดข้อผิดพลาด')
    } finally {
      setActionId(null)
    }
  }

  // ── Clear (skip → cleared) ────────────────────────────────────────────────
  const handleClear = async (q: QueueItem) => {
    setActionId(q.vn + '_c')
    try {
      await updateQueueStatus(q.vn, 'cleared', { queueSlot: q.queue_slot })
      flash(true, `เคลียร์คิว ${q.queue_slot || q.queue_no} ออกจากหน้าจอแล้ว`)
      load()
    } catch {
      flash(false, 'เกิดข้อผิดพลาด')
    } finally {
      setActionId(null)
    }
  }

  const handleClearAll = async () => {
    if (skipQueues.length === 0) return
    setActionId('__clear__')
    try {
      await Promise.all(skipQueues.map(q => updateQueueStatus(q.vn, 'cleared', { queueSlot: q.queue_slot })))
      flash(true, `เคลียร์ทั้งหมด ${skipQueues.length} รายการ สำเร็จ`)
      load()
    } catch {
      flash(false, 'เกิดข้อผิดพลาด')
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="qh-bg">
      <header className="qh-topbar">
        <button className="qh-back-btn" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/main')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          กลับ
        </button>

        <div className="qh-title-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#0D47A1" strokeWidth="2" />
            <path d="M12 6v6l4 2" stroke="#0D47A1" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <h1 className="qh-title">ประวัติการเรียกคิว</h1>
          <div className="qh-mode-switch">
            <div className="qh-mode-group qh-group-prefix">
              {(['slot', 'slot_cur'] as HistoryMode[]).map(m => (
                <button key={m}
                  className={`qh-mode-btn prefix${mode === m ? ' active' : ''}`}
                  onClick={() => { setMode(m); localStorage.setItem('qh_mode', m); setQueues([]) }}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="qh-mode-sep" />
            <div className="qh-mode-group qh-group-opd">
              {(['opd', 'cur_dep'] as HistoryMode[]).map(m => (
                <button key={m}
                  className={`qh-mode-btn opd${mode === m ? ' active' : ''}`}
                  onClick={() => { setMode(m); localStorage.setItem('qh_mode', m); setQueues([]) }}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="qh-topbar-right">
          <div className="qh-dept-wrap">
            <span className="qh-dept-label">แผนก</span>
            <select className="qh-dept-select" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="">ทุกแผนก</option>
              {deptOptions.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
          </div>
          <div className="qh-sp-wrap">
            <span className="qh-sp-label">จอแสดงคิว:</span>
            <select className="qh-sp-select" value={selectedDisplayId}
              onChange={e => setSelectedDisplayId(e.target.value)}>
              <option value="">— ค่าเริ่มต้นระบบ —</option>
              {displayConfigs.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="qh-sp-wrap">
            <span className="qh-sp-label">ช่องที่ใช้เรียกซ้ำ:</span>
            <select className="qh-sp-select" value={servicePoint}
              onChange={e => { setServicePoint(e.target.value); sessionStorage.setItem('lastSP', e.target.value) }}>
              {useDisplayChannels
                ? displayChannels.map(ch => <option key={ch} value={ch}>{ch}</option>)
                : servicePoints.map(sp => (
                    <option key={sp.id} value={sp.name}>{sp.name}</option>
                  ))
              }
            </select>
          </div>
          <button className="qh-refresh-btn" onClick={load} disabled={loading} title="รีเฟรช">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className={loading ? 'qh-spin' : ''}>
              <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="qh-clock">
            {clock.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      {msg && <div className={`qh-toast ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="qh-body">

        {/* ── เรียกแล้วไม่มา + ประวัติที่เคลียร์ (toggle) ── */}
        <div className="qh-card">
          {showCleared ? (
            /* ── view: ประวัติที่เคลียร์แล้ว ── */
            <>
              <div className="qh-card-hd cleared">
                <span className="qh-dot" />
                <span>ประวัติที่เคลียร์แล้ว</span>
                <button className="qh-toggle-view-btn" onClick={() => setShowCleared(false)}>
                  ← เรียกไม่มา
                </button>
                <span className="qh-count">{clearedQueues.length}</span>
                <button
                  className="qh-return-all-btn"
                  onClick={() => handleReturnGroup(clearedQueues, 'ที่เคลียร์', '__retcleared__')}
                  disabled={!!actionId || clearedQueues.length === 0}
                >
                  {actionId === '__retcleared__' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>↩ คืนทั้งหมด</>}
                </button>
              </div>
              <div className="qh-list">
                {clearedQueues.length === 0 ? (
                  <div className="qh-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" opacity="0.25">
                      <circle cx="12" cy="12" r="10" stroke="#546E7A" strokeWidth="1.5" />
                      <path d="M12 8v4M12 16h.01" stroke="#546E7A" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    ยังไม่มีรายการที่เคลียร์
                  </div>
                ) : clearedQueues.map(q => (
                  <div key={q.vn} className="qh-item qh-item-cleared">
                    <div className="qh-item-qno cleared">{q.queue_slot ?? q.queue_no ?? '—'}</div>
                    <div className="qh-item-info">
                      <span className="qh-item-name">{q.queue_name || '—'}</span>
                      <span className="qh-item-meta">HN {q.hn || '—'} · {q.department || '—'}</span>
                    </div>
                    <div className="qh-item-calltime">
                      <span className="qh-calltime-label">เรียกเมื่อ</span>
                      <span className="qh-calltime-val">{callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn] ? `${callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn]} น.` : '—'}</span>
                    </div>
                    <div className="qh-item-btns">
                      <button className="qh-btn qh-btn-recall" onClick={() => handleRecall(q)} disabled={!!actionId}>
                        {actionId === q.vn ? <span className="qh-spin-dot" /> : <>📢 เรียกซ้ำ</>}
                      </button>
                      <button className="qh-btn qh-btn-return" onClick={() => handleReturn(q)} disabled={!!actionId}>
                        {actionId === q.vn + '_r' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>↩ คืนคิว</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* ── view: เรียกแล้วไม่มา ── */
            <>
              <div className="qh-card-hd skip">
                <span className="qh-dot" />
                <span>เรียกแล้วไม่มา</span>
                <button
                  className="qh-toggle-view-btn history"
                  onClick={() => setShowCleared(true)}
                  title="ดูประวัติที่เคลียร์แล้ว"
                >
                  📋 ประวัติ {clearedQueues.length > 0 && <span className="qh-toggle-badge">{clearedQueues.length}</span>}
                </button>
                <span className="qh-count">{skipQueues.length}</span>
                <button
                  className="qh-return-all-btn skip"
                  onClick={() => handleReturnGroup(skipQueues, 'ไม่มา', '__skip__')}
                  disabled={!!actionId || skipQueues.length === 0}
                >
                  {actionId === '__skip__' ? <span className="qh-spin-dot" /> : <>↩ คืนทั้งหมด</>}
                </button>
                <button
                  className="qh-return-all-btn clear-all"
                  onClick={handleClearAll}
                  disabled={!!actionId || skipQueues.length === 0}
                >
                  {actionId === '__clear__' ? <span className="qh-spin-dot" /> : <>🗑 เคลียร์ทั้งหมด</>}
                </button>
              </div>
              <div className="qh-list">
                {skipQueues.length === 0 ? (
                  <div className="qh-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" opacity="0.25">
                      <circle cx="12" cy="12" r="10" stroke="#C62828" strokeWidth="1.5" />
                      <path d="M15 9l-6 6M9 9l6 6" stroke="#C62828" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    ไม่มีคิวที่ไม่มา
                  </div>
                ) : skipQueues.map(q => (
                  <div key={q.vn} className="qh-item qh-item-skip">
                    <div className="qh-item-qno skip">{q.queue_slot ?? q.queue_no ?? '—'}</div>
                    <div className="qh-item-info">
                      <span className="qh-item-name">{q.queue_name || '—'}</span>
                      <span className="qh-item-meta">HN {q.hn || '—'} · {q.department || '—'}</span>
                    </div>
                    <div className="qh-item-calltime">
                      <span className="qh-calltime-label">เรียกเมื่อ</span>
                      <span className="qh-calltime-val">{callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn] ? `${callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn]} น.` : '—'}</span>
                    </div>
                    <div className="qh-item-btns">
                      <button className="qh-btn qh-btn-recall" onClick={() => handleRecall(q)} disabled={!!actionId}>
                        {actionId === q.vn ? <span className="qh-spin-dot" /> : <>📢 เรียกซ้ำ</>}
                      </button>
                      <button className="qh-btn qh-btn-clear" onClick={() => handleClear(q)} disabled={!!actionId} title="เคลียร์ออกจากหน้าจอ">
                        {actionId === q.vn + '_c' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>🗑 เคลียร์</>}
                      </button>
                      <button className="qh-btn qh-btn-return" onClick={() => handleReturn(q)} disabled={!!actionId}>
                        {actionId === q.vn + '_r' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>↩ คืนคิว</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── ประวัติการเรียกคิว (done) ── */}
        <div className="qh-card">
          <div className="qh-card-hd done">
            <span className="qh-dot" />
            <span>ประวัติการเรียกคิว</span>
            <span className="qh-count">{doneQueues.length}</span>
            <button
              className="qh-return-all-btn"
              onClick={() => handleReturnGroup(doneQueues, 'ประวัติ', '__done__')}
              disabled={!!actionId || doneQueues.length === 0}
            >
              {actionId === '__done__' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>↩ คืนคิวทั้งหมด</>}
            </button>
          </div>
          <div className="qh-list">
            {doneQueues.length === 0 ? (
              <div className="qh-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" opacity="0.25">
                  <circle cx="12" cy="12" r="10" stroke="#2E7D32" strokeWidth="1.5" />
                  <path d="M8 12l3 3 5-5" stroke="#2E7D32" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ยังไม่มีคิวที่บริการแล้ว
              </div>
            ) : doneQueues.map(q => (
              <div key={q.vn} className="qh-item qh-item-done">
                <div className="qh-item-qno">{q.queue_slot ?? q.queue_no ?? '—'}</div>
                <div className="qh-item-info">
                  <span className="qh-item-name">{q.queue_name || '—'}</span>
                  <span className="qh-item-meta">HN {q.hn || '—'} · {q.department || '—'}</span>
                </div>
                <div className="qh-item-calltime">
                  <span className="qh-calltime-label">เรียกเมื่อ</span>
                  <span className="qh-calltime-val">{callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn] ? `${callTimeMap[q.queue_slot ? `${q.vn}::${q.queue_slot}` : q.vn]} น.` : '—'}</span>
                </div>
                <div className="qh-item-btns">
                  <div className="qh-badge done">✓ เสร็จแล้ว</div>
                  <button
                    className="qh-btn qh-btn-return"
                    onClick={() => handleReturn(q)}
                    disabled={!!actionId}
                  >
                    {actionId === q.vn + '_r' ? <span className="qh-spin-dot qh-spin-dot-dark" /> : <>↩ คืนคิว</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
