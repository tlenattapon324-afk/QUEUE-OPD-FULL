import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDisplayConfigs, createDisplayConfig, updateDisplayConfigItem,
  deleteDisplayConfig, openDisplay, getSystemFonts
} from '../lib/api'
import './DisplayConfigs.css'

const DEFAULT_FORM: Omit<DisplayConfigItem, 'id'> = {
  name: 'หน้าจอใหม่',
  bgColor: '#0A1929',
  textColor: '#FFFFFF',
  queueColor: '#00BCD4',
  font: 'Sarabun',
  fontSize: 120,
  title: 'ระบบคิวผู้ป่วยนอก',
  subTitle: 'OPD Queue System',
  showClock: true,
  queueBgColor: 'rgba(0,188,212,0.15)',
  showHistory: true,
  animationType: 'scale',
  soundEnabled: false,
  channels: []
}

export default function DisplayConfigsPage() {
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<DisplayConfigItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Omit<DisplayConfigItem, 'id'>>(DEFAULT_FORM)
  const [fonts, setFonts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyDisplayLink = async (cfg: DisplayConfigItem) => {
    try {
      const r = await fetch('/api/server-ip')
      const { ip, port } = await r.json()
      const url = `http://${ip}:${port}/#/display?id=${cfg.id}`
      await navigator.clipboard.writeText(url)
      setCopiedId(cfg.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {}
  }
  const [newChannel, setNewChannel] = useState('')

  const addChannel = () => {
    const ch = newChannel.trim()
    if (!ch || (form.channels || []).includes(ch)) return
    setF('channels', [...(form.channels || []), ch])
    setNewChannel('')
  }

  const removeChannel = (ch: string) =>
    setF('channels', (form.channels || []).filter(c => c !== ch))

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setConfigs(await getDisplayConfigs())
    setLoading(false)
  }

  const openAdd = async () => {
    setEditingId(null)
    setForm(DEFAULT_FORM)
    setShowModal(true)
    setSaveError('')
    setFonts(await getSystemFonts())
  }

  const openEdit = async (cfg: DisplayConfigItem) => {
    const { id, ...rest } = cfg
    setEditingId(id)
    setForm(rest)
    setShowModal(true)
    setSaveError('')
    setFonts(await getSystemFonts())
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      if (editingId) {
        await updateDisplayConfigItem(editingId, { id: editingId, ...form })
      } else {
        await createDisplayConfig(form)
      }
      setShowModal(false)
      load()
    } catch (e) {
      // Without this, a failed request (e.g. server unreachable) left the button spinning
      // forever — setSaving(false) below never ran because the throw skipped past it.
      setSaveError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteDisplayConfig(id)
    setDeleteId(null)
    load()
  }

  const setF = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const FONT_LIST = fonts.length > 0
    ? fonts
    : ['Sarabun', 'Prompt', 'Kanit', 'Tahoma', 'Arial', 'Angsana New', 'CordiaNew', 'TH SarabunPSK']

  return (
    <div className="dcfg-bg">
      <div className="dcfg-bg-circle c1" />
      <div className="dcfg-bg-circle c2" />

      <div className="dcfg-wrap">
        <header className="dcfg-header">
          <button className="btn btn-ghost dcfg-back" onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            กลับ
          </button>
          <div className="dcfg-header-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="#00BCD4" strokeWidth="2" />
              <path d="M8 20h8M12 18v2" stroke="#00BCD4" strokeWidth="2" strokeLinecap="round" />
              <path d="M7 11h2l1.5-4 2 7 1.5-3H17" stroke="#00BCD4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="dcfg-title">จัดการหน้าจอแสดงคิว</h1>
              <p className="dcfg-subtitle">ตั้งค่าและจัดการรูปแบบหน้าจอแสดงผล</p>
            </div>
          </div>
          <button className="btn btn-primary dcfg-add-btn" onClick={openAdd}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            เพิ่มหน้าจอใหม่
          </button>
        </header>

        {loading ? (
          <div className="dcfg-center"><div className="dcfg-loader" /></div>
        ) : configs.length === 0 ? (
          <div className="dcfg-empty animate-fade">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" opacity="0.3">
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 20h8M12 18v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p>ยังไม่มีหน้าจอที่บันทึกไว้</p>
            <button className="btn btn-primary" onClick={openAdd}>+ เพิ่มหน้าจอแรก</button>
          </div>
        ) : (
          <div className="dcfg-grid">
            {configs.map((cfg, i) => (
              <div key={cfg.id} className="dcfg-card card animate-fade" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="dcfg-preview" style={{ background: cfg.bgColor }}>
                  <span className="dcfg-preview-num" style={{ color: cfg.queueColor, fontSize: 40 }}>A001</span>
                  <span className="dcfg-preview-title" style={{ color: cfg.textColor + '99' }}>{cfg.title}</span>
                </div>
                <div className="dcfg-card-body">
                  <div className="dcfg-card-info">
                    <span className="dcfg-card-name">{cfg.name}</span>
                    <span className="dcfg-card-meta">{cfg.font} · {cfg.fontSize}px · {cfg.animationType || 'scale'}</span>
                    {(cfg.channels?.length ?? 0) > 0 && (
                      <span className="dcfg-card-channels">
                        📺 {cfg.channels!.length} ช่อง: {cfg.channels!.join(', ')}
                      </span>
                    )}
                    <div className="dcfg-swatches">
                      <span className="dcfg-swatch" style={{ background: cfg.bgColor }} title="พื้นหลัง" />
                      <span className="dcfg-swatch" style={{ background: cfg.textColor }} title="ข้อความ" />
                      <span className="dcfg-swatch" style={{ background: cfg.queueColor }} title="เลขคิว" />
                    </div>
                  </div>
                  <div className="dcfg-card-actions">
                    <button
                      className={`btn dcfg-btn-copy${copiedId === cfg.id ? ' copied' : ''}`}
                      onClick={() => copyDisplayLink(cfg)}
                      title="คัดลอกลิ้งหน้าจอนี้">
                      {copiedId === cfg.id ? '✓ คัดลอกแล้ว' : '🔗 ลิ้งค์'}
                    </button>
                    <button className="btn btn-primary dcfg-btn-open" onClick={() => openDisplay(cfg)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 20h8M12 18v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      เปิดหน้าจอ
                    </button>
                    <button className="btn btn-accent dcfg-btn-edit" onClick={() => openEdit(cfg)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      แก้ไข
                    </button>
                    <button className="btn btn-danger dcfg-btn-del" onClick={() => setDeleteId(cfg.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <polyline points="3,6 5,6 21,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
                {deleteId === cfg.id && (
                  <div className="dcfg-del-confirm">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="#EF5350" strokeWidth="2" />
                      <path d="M12 8v4M12 16h.01" stroke="#EF5350" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>ลบหน้าจอ <strong>{cfg.name}</strong> ?</span>
                    <div className="dcfg-del-btns">
                      <button className="btn btn-danger" onClick={() => handleDelete(cfg.id)}>ลบ</button>
                      <button className="btn btn-ghost" onClick={() => setDeleteId(null)}>ยกเลิก</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="dcfg-overlay">
          <div className="dcfg-modal card animate-scale">
            <div className="dcfg-modal-header">
              <h3>{editingId ? 'แก้ไขหน้าจอ' : 'เพิ่มหน้าจอใหม่'}</h3>
              <button className="btn btn-ghost dcfg-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="dcfg-modal-body">
              <div className="dcfg-field">
                <label>ชื่อหน้าจอ (ใช้อ้างอิง)</label>
                <input className="input" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="เช่น หน้าจอห้อง OPD 1" />
              </div>
              <div className="dcfg-field">
                <label>หัวข้อหลัก</label>
                <input className="input" value={form.title} onChange={e => setF('title', e.target.value)} />
              </div>
              <div className="dcfg-field">
                <label>หัวข้อย่อย</label>
                <input className="input" value={form.subTitle || ''} onChange={e => setF('subTitle', e.target.value)} />
              </div>

              <div className="dcfg-field-row">
                <div className="dcfg-field">
                  <label>สีพื้นหลัง</label>
                  <div className="dcfg-color-row">
                    <input type="color" value={form.bgColor} onChange={e => setF('bgColor', e.target.value)} />
                    <input className="input" value={form.bgColor} onChange={e => setF('bgColor', e.target.value)} />
                  </div>
                </div>
                <div className="dcfg-field">
                  <label>สีข้อความ</label>
                  <div className="dcfg-color-row">
                    <input type="color" value={form.textColor} onChange={e => setF('textColor', e.target.value)} />
                    <input className="input" value={form.textColor} onChange={e => setF('textColor', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="dcfg-field-row">
                <div className="dcfg-field">
                  <label>สีเลขคิว</label>
                  <div className="dcfg-color-row">
                    <input type="color" value={form.queueColor} onChange={e => setF('queueColor', e.target.value)} />
                    <input className="input" value={form.queueColor} onChange={e => setF('queueColor', e.target.value)} />
                  </div>
                </div>
                <div className="dcfg-field">
                  <label>ฟ้อนต์</label>
                  <select className="input" value={form.font} onChange={e => setF('font', e.target.value)}>
                    {FONT_LIST.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div className="dcfg-field">
                <label>ขนาดเลขคิว: <strong>{form.fontSize}px</strong></label>
                <input type="range" min="60" max="300" step="10" value={form.fontSize}
                  onChange={e => setF('fontSize', Number(e.target.value))} className="dcfg-slider" />
              </div>

              <div className="dcfg-field">
                <label>รูปแบบแอนิเมชัน</label>
                <div className="dcfg-radio-group">
                  {(['fade', 'slide', 'scale', 'bounce'] as const).map(a => (
                    <label key={a} className="dcfg-radio">
                      <input type="radio" name="anim" value={a}
                        checked={form.animationType === a}
                        onChange={() => setF('animationType', a)} />
                      {a}
                    </label>
                  ))}
                </div>
              </div>

              <div className="dcfg-toggles">
                <label className="dcfg-toggle-row">
                  <span>แสดงนาฬิกา</span>
                  <label className="qd-toggle">
                    <input type="checkbox" checked={form.showClock}
                      onChange={e => setF('showClock', e.target.checked)} />
                    <span className="toggle-track" />
                  </label>
                </label>
                <label className="dcfg-toggle-row">
                  <span>แสดงประวัติคิว</span>
                  <label className="qd-toggle">
                    <input type="checkbox" checked={form.showHistory !== false}
                      onChange={e => setF('showHistory', e.target.checked)} />
                    <span className="toggle-track" />
                  </label>
                </label>
                <label className="dcfg-toggle-row">
                  <span>เสียงแจ้งเตือน</span>
                  <label className="qd-toggle">
                    <input type="checkbox" checked={!!form.soundEnabled}
                      onChange={e => setF('soundEnabled', e.target.checked)} />
                    <span className="toggle-track" />
                  </label>
                </label>
              </div>

              {/* ── ช่องบริการ ── */}
              <div className="dcfg-field">
                <label>ช่องบริการของหน้าจอนี้</label>
                <div className="dcfg-channel-add">
                  <input className="input" placeholder="ชื่อช่อง เช่น ห้อง 1 หรือ ช่องอายุรกรรม 1"
                    value={newChannel}
                    onChange={e => setNewChannel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addChannel()} />
                  <button className="btn btn-accent" onClick={addChannel} type="button">+ เพิ่ม</button>
                </div>
                {(form.channels || []).length > 0 ? (
                  <div className="dcfg-channel-list">
                    {(form.channels || []).map((ch, idx) => (
                      <span key={ch} className="dcfg-channel-tag">
                        <span className="dcfg-channel-num">{idx + 1}</span>
                        {ch}
                        <button onClick={() => removeChannel(ch)} title="ลบ">✕</button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="dcfg-channel-empty">ยังไม่มีช่อง — หน้าจอนี้จะแสดงช่องทั้งหมดในระบบ</p>
                )}
              </div>

              <div className="dcfg-preview-live" style={{ background: form.bgColor }}>
                <span style={{ color: form.queueColor, fontSize: Math.min(form.fontSize * 0.28, 64), fontWeight: 800, fontFamily: `'${form.font}', sans-serif` }}>A001</span>
                <span style={{ color: form.textColor, fontSize: 13, fontFamily: `'${form.font}', sans-serif` }}>{form.title}</span>
              </div>
            </div>

            {saveError && <div className="alert alert-error animate-fade" style={{ margin: '0 20px' }}>✗ {saveError}</div>}

            <div className="dcfg-modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="spinner" /> กำลังบันทึก...</> : <>💾 บันทึก</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
