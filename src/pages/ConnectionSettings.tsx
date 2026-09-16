import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadSettings, saveSettings, testConnection, checkQueueOpdQsSlotTable, createQueueOpdQsSlotTable } from '../lib/api'
import './ConnectionSettings.css'

const DEFAULT: DbSettings = {
  type: 'mysql',
  host: '192.168.1.1',
  port: 3306,
  database: '',
  username: 'root',
  password: '',
  hospitalCode: '',
  apiToken: ''
}

export default function ConnectionSettingsPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<DbSettings>(DEFAULT)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [tableExists, setTableExists] = useState<boolean | null>(null)
  const [checkingTable, setCheckingTable] = useState(false)
  const [creatingTable, setCreatingTable] = useState(false)
  const [tableResult, setTableResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    loadSettings().then(s => { if (s) setForm(s) })
  }, [])

  const setField = <K extends keyof DbSettings>(key: K, val: DbSettings[K]) => {
    setForm(f => ({ ...f, [key]: val }))
    setTestResult(null)
    setSaved(false)
    setTableExists(null)
    setTableResult(null)
  }

  const handleTypeChange = (type: 'mysql' | 'postgresql') => {
    setForm(f => ({ ...f, type, port: type === 'mysql' ? 3306 : 5432 }))
    setTestResult(null)
    setTableExists(null)
    setTableResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTableExists(null)
    setTableResult(null)
    const res = await testConnection(form)
    setTesting(false)
    setTestResult(res)
    if (res.success) {
      setCheckingTable(true)
      const t = await checkQueueOpdQsSlotTable(form)
      setCheckingTable(false)
      if (t.success) setTableExists(!!t.exists)
    }
  }

  const handleCreateTable = async () => {
    setCreatingTable(true)
    setTableResult(null)
    const res = await createQueueOpdQsSlotTable(form)
    setCreatingTable(false)
    setTableResult({ success: res.success, message: res.message || '' })
    if (res.exists) setTableExists(true)
  }

  // Token = hospital code + 10 random digits, per-hospital so a token copied from one site's
  // Postman collection is useless against another site's server.
  const handleGenerateToken = () => {
    const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('')
    setField('apiToken', `${(form.hospitalCode || '').trim()}${digits}`)
  }

  // requireApiToken on the server starts enforcing the token the moment it's saved — this tab's
  // own next /api/* call would otherwise still be sending the OLD (or no) token from page load
  // and get rejected. Updating window.__API_TOKEN__ here keeps this tab working without a reload.
  const syncTokenToThisTab = () => { window.__API_TOKEN__ = form.apiToken || '' }

  const handleSave = async () => {
    setSaving(true)
    await saveSettings(form)
    syncTokenToThisTab()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSaveAndLogin = async () => {
    setSaving(true)
    await saveSettings(form)
    syncTokenToThisTab()
    setSaving(false)
    navigate('/login')
  }

  return (
    <div className="settings-bg">
      <div className="bg-circle c1" />
      <div className="bg-circle c2" />

      <div className="settings-container animate-fade">
        <div className="settings-header">
          <button className="btn btn-ghost back-btn" onClick={() => navigate(-1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            ย้อนกลับ
          </button>
          <div className="settings-title-wrap">
            <div className="settings-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="#00BCD4" strokeWidth="2" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#00BCD4" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="settings-title">ตั้งค่าการเชื่อมต่อ</h1>
              <p className="settings-subtitle">กำหนดค่าการเชื่อมต่อฐานข้อมูล</p>
            </div>
          </div>
        </div>

        <div className="settings-card card animate-scale">
          <div className="section-label">ประเภทฐานข้อมูล</div>
          <div className="db-type-toggle">
            <button className={`db-type-btn ${form.type === 'mysql' ? 'active' : ''}`} onClick={() => handleTypeChange('mysql')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="8" ry="3" stroke="#00758F" strokeWidth="2"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="#00758F" strokeWidth="2"/><line x1="4" y1="12" x2="20" y2="12" stroke="#00758F" strokeWidth="1.5"/></svg>
              MySQL
            </button>
            <button className={`db-type-btn ${form.type === 'postgresql' ? 'active' : ''}`} onClick={() => handleTypeChange('postgresql')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="8" rx="7" ry="5" stroke="#336791" strokeWidth="2"/><path d="M5 8v8c0 2.76 3.13 5 7 5s7-2.24 7-5V8" stroke="#336791" strokeWidth="2"/><line x1="5" y1="12" x2="19" y2="12" stroke="#336791" strokeWidth="1.5"/></svg>
              PostgreSQL
            </button>
          </div>

          <div className="settings-grid">
            <div className="form-group full">
              <label className="form-label">IP Server / Hostname</label>
              <input className="input" type="text" placeholder="เช่น 192.168.1.100 หรือ localhost"
                value={form.host} onChange={e => setField('host', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input className="input" type="number" placeholder={form.type === 'mysql' ? '3306' : '5432'}
                value={form.port} onChange={e => setField('port', Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label className="form-label">Database</label>
              <input className="input" type="text" placeholder="ชื่อฐานข้อมูล"
                value={form.database} onChange={e => setField('database', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="input" type="text" placeholder="ชื่อผู้ใช้ฐานข้อมูล"
                value={form.username} onChange={e => setField('username', e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="input" type="password" placeholder="รหัสผ่านฐานข้อมูล"
                value={form.password} onChange={e => setField('password', e.target.value)} autoComplete="off" />
            </div>
          </div>

          {testResult && (
            <div className={`alert ${testResult.success ? 'alert-success' : 'alert-error'} animate-fade`}>
              {testResult.success ? '✓ ' : '✗ '}{testResult.message}
            </div>
          )}
          {saved && <div className="alert alert-success animate-fade">✓ บันทึกการตั้งค่าเรียบร้อยแล้ว</div>}

          {testResult?.success && (
            <div className="table-check-section">
              <div className="section-label">ตาราง queue_opd_qs_slot</div>
              {checkingTable ? (
                <button className="btn btn-ghost" disabled><span className="spinner" /> กำลังตรวจสอบตาราง...</button>
              ) : tableExists === true ? (
                <button className="btn btn-muted" disabled>✓ มีตาราง queue_opd_qs_slot แล้ว</button>
              ) : tableExists === false ? (
                <button className="btn btn-warning" onClick={handleCreateTable} disabled={creatingTable}>
                  {creatingTable ? <><span className="spinner" /> กำลังสร้างตาราง...</> : <>➕ เพิ่มตาราง queue_opd_qs_slot</>}
                </button>
              ) : null}
              {tableResult && (
                <div className={`alert ${tableResult.success ? 'alert-success' : 'alert-error'} animate-fade`}>
                  {tableResult.success ? '✓ ' : '✗ '}{tableResult.message}
                </div>
              )}
            </div>
          )}

          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={handleTest} disabled={testing || !form.host || !form.database}>
              {testing ? <><span className="spinner" /> กำลังทดสอบ...</> : <>🔌 ทดสอบการเชื่อมต่อ</>}
            </button>
            <button className="btn btn-accent" onClick={handleSave} disabled={saving}>
              {saving ? <><span className="spinner" /> บันทึก...</> : <>💾 บันทึกการเชื่อมต่อ</>}
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/main')}>🏠 เปิดหน้าหลัก</button>
            <button className="btn btn-success save-login-btn" onClick={handleSaveAndLogin} disabled={saving}>
              {saving ? <><span className="spinner" /> กำลังบันทึก...</> : <>✅ บันทึกและกลับหน้า Login</>}
            </button>
          </div>
        </div>

        <div className="settings-card card animate-scale">
          <div className="section-label">API Token — ป้องกันการเรียก API ตรงจากภายนอก</div>
          <div className="settings-grid">
            <div className="form-group full">
              <label className="form-label">รหัสสถานพยาบาล</label>
              <input className="input" type="text" placeholder="เช่น 11163"
                value={form.hospitalCode || ''} onChange={e => setField('hospitalCode', e.target.value)} />
            </div>
          </div>
          <div className="form-group full">
            <label className="form-label">Token ({(form.hospitalCode || '').trim() || 'รหัสสถานพยาบาล'} + รหัสสุ่ม 10 หลัก)</label>
            <div className="token-row">
              <input className="input" type="text" placeholder="ยังไม่ได้สร้าง — กดปุ่ม 'สร้าง Token'"
                value={form.apiToken || ''} onChange={e => setField('apiToken', e.target.value)} readOnly />
              <button className="btn btn-accent" onClick={handleGenerateToken} disabled={!form.hospitalCode?.trim()}>
                🔑 สร้าง Token
              </button>
            </div>
          </div>
          <div className="alert alert-info">
            ℹ️ เมื่อบันทึก Token แล้ว ทุกคำขอไปยัง API ของระบบต้องแนบ Token นี้ (header <code>X-API-Token</code> หรือ query <code>?token=</code>) มิฉะนั้นจะถูกปฏิเสธ — หน้าจอที่ใช้งานผ่านแอปนี้ตามปกติจะแนบให้อัตโนมัติ ไม่ต้องทำอะไรเพิ่ม ส่วนใครที่ copy URL ไปยิงตรงผ่าน Postman/curl จะต้องใส่ Token เองก่อนจึงจะได้รับข้อมูล
          </div>
        </div>

        <div className="settings-info card">
          <p className="info-title">📋 หมายเหตุการเชื่อมต่อ</p>
          <ul className="info-list">
            <li>ข้อมูลการเชื่อมต่อจะถูกเก็บไว้ในไฟล์ <code>data/db-settings.json</code></li>
            <li>การ login จะใช้ตาราง <code>officer</code> ในฐานข้อมูลที่เชื่อมต่อ</li>
            <li>รหัสผ่านใน officer_login_password_md5 ต้องเป็น MD5 hash</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
