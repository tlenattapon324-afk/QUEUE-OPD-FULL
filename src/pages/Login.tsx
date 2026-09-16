import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadSettings, login } from '../lib/api'
import { retrieveBmsSession } from '../services/bmsSession'
import { handleUrlSession, getSessionCookie, setSessionCookie, removeSessionCookie } from '../utils/sessionStorage'
import './Login.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasSettings, setHasSettings] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const passRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  // BMS session (alternate login — see BMS-SESSION-SPECIFICATION.md)
  const [bmsChecking, setBmsChecking] = useState(false)
  const [showBmsInput, setShowBmsInput] = useState(false)
  const [bmsSessionId, setBmsSessionId] = useState('')
  const [bmsError, setBmsError] = useState('')

  useEffect(() => {
    loadSettings().then(s => setHasSettings(!!s))
  }, [])

  const enterWithBmsSession = async (sessionId: string) => {
    setBmsChecking(true)
    setBmsError('')
    try {
      const data = await retrieveBmsSession(sessionId)
      if (data.MessageCode === 200) {
        setSessionCookie(sessionId)
        sessionStorage.setItem('officer', data.result?.user_info?.name || 'BMS User')
        navigate('/queue-call')
        return
      }
      if (data.MessageCode === 500) {
        removeSessionCookie()
        setBmsError('BMS Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
      } else {
        setBmsError(data.Message || 'BMS Session ไม่ถูกต้อง')
      }
    } catch {
      setBmsError('เกิดข้อผิดพลาดในการเชื่อมต่อ BMS Session')
    } finally {
      setBmsChecking(false)
    }
  }

  // Auto-login: a bms-session-id arriving via URL (fresh link from HOSxP) or a cookie left
  // over from a previous 7-day session skips the username/password form entirely.
  useEffect(() => {
    const sessionId = handleUrlSession() || getSessionCookie()
    if (sessionId) enterWithBmsSession(sessionId)
  }, [])

  const handleBmsConnect = () => {
    if (!bmsSessionId.trim() || bmsChecking) return
    enterWithBmsSession(bmsSessionId.trim())
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) { setError('กรุณากรอก username และ password'); return }
    setLoading(true)
    setError('')
    const res = await login(username, password)
    setLoading(false)
    if (res.success) {
      sessionStorage.setItem('officer', res.username || username)
      navigate('/queue-call')
    } else {
      setError(res.message || 'เข้าสู่ระบบไม่สำเร็จ')
    }
  }

  return (
    <div className="login-bg">
      <div className="bg-circle c1" />
      <div className="bg-circle c2" />
      <div className="bg-circle c3" />

      <div className="login-wrapper animate-fade">
        <div className="login-header">
          <div className="login-icon">
            <svg width="38" height="38" viewBox="0 0 48 48" fill="none">
              <path d="M10 14h28M10 24h28M10 34h18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <circle cx="38" cy="34" r="7" fill="#93C5FD" />
              <path d="M35 34l2.2 2.5 4.5-5" stroke="#1e3a5f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="login-title">QUEUE OPD</h1>
          <p className="login-subtitle">ระบบจัดการคิวผู้ป่วยนอก</p>
        </div>

        {bmsChecking && !showBmsInput ? (
          <div className="login-card card animate-scale" style={{ textAlign: 'center', padding: '48px 32px' }}>
            <span className="spinner" style={{ borderColor: 'rgba(37,99,235,0.25)', borderTopColor: '#2563EB' }} />
            <p style={{ marginTop: 14, color: '#1e3a5f', fontWeight: 600 }}>กำลังตรวจสอบ BMS Session...</p>
          </div>
        ) : (
        <div className="login-card card animate-scale">
          <h2 className="login-card-title">เข้าสู่ระบบ</h2>

          {!hasSettings && (
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              กรุณาตั้งค่าการเชื่อมต่อฐานข้อมูลก่อนเข้าใช้งาน
            </div>
          )}

          {error && (
            <div className="alert alert-error animate-fade" style={{ marginBottom: 16 }}>
              <span>⚠ {error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label">ชื่อผู้ใช้งาน</label>
              <div className="input-wrap">
                <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input className="input input-icon-left" type="text" placeholder="กรอก username"
                  value={username} onChange={e => setUsername(e.target.value)}
                  autoFocus autoComplete="off" name="qopd-user"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); passRef.current?.focus() } }} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">รหัสผ่าน</label>
              <div className="input-wrap">
                <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input className="input input-icon-left" type={showPass ? 'text' : 'password'}
                  placeholder="กรอก password" value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password" name="qopd-pass" ref={passRef}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitRef.current?.click() } }} />
                <button type="button" className="pass-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary login-btn" ref={submitRef} disabled={loading || !hasSettings}>
              {loading ? <><span className="spinner" /> กำลังตรวจสอบ...</> : <><span>🔑</span> เข้าสู่ระบบ</>}
            </button>
          </form>

          <div className="login-divider"><span>หรือ</span></div>

          <button className="btn btn-ghost settings-btn" onClick={() => navigate('/settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            ตั้งค่าการเชื่อมต่อฐานข้อมูล
          </button>

          {!showBmsInput ? (
            <button className="btn btn-ghost settings-btn" style={{ marginTop: 10 }} onClick={() => { setShowBmsInput(true); setBmsError('') }}>
              <span>🛡️</span> เข้าสู่ระบบด้วย BMS Session
            </button>
          ) : (
            <div className="form-group" style={{ marginTop: 14 }}>
              <label className="form-label">BMS Session ID</label>
              <div className="input-wrap">
                <input className="input" type="text" placeholder="วาง Session ID ที่นี่"
                  value={bmsSessionId} onChange={e => { setBmsSessionId(e.target.value); setBmsError('') }}
                  autoComplete="off"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleBmsConnect() } }} />
              </div>
              {bmsError && (
                <div className="alert alert-error animate-fade" style={{ marginTop: 8 }}>⚠ {bmsError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-ghost settings-btn" style={{ flex: 1, width: 'auto' }} onClick={() => { setShowBmsInput(false); setBmsSessionId(''); setBmsError('') }}>
                  ยกเลิก
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleBmsConnect} disabled={bmsChecking || !bmsSessionId.trim()}>
                  {bmsChecking ? <><span className="spinner" /> กำลังเชื่อมต่อ...</> : <>เชื่อมต่อ</>}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        <p className="login-footer">Queue OPD v1.0 &copy; 2026 BMS</p>
      </div>
    </div>
  )
}
