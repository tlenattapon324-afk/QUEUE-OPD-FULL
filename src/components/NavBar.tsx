import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getDisplayConfigs, openDisplay } from '../lib/api'
import './NavBar.css'



const NAV_LINKS = [
  {
    path: '/queue-call',
    label: 'เรียกคิว',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M8 12h8M8 8h5M8 16h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    path: '/app-settings',
    label: 'ตั้งค่าระบบ',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
]

const STATIC_PAGES = [
  { label: 'เรียกคิว (Staff)', path: '/#/queue-call', icon: '📢' },
  { label: 'ประวัติการเรียกคิว', path: '/#/queue-history', icon: '📋' },
]

function displaySearchFilter(configs: DisplayConfigItem[], search: string): DisplayConfigItem[] {
  const q = search.trim().toLowerCase()
  return q ? configs.filter(c => c.name.toLowerCase().includes(q)) : configs
}

export default function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const officer = sessionStorage.getItem('officer') || 'ผู้ใช้งาน'
  const [showLinks, setShowLinks] = useState(false)
  const [showDisplayNav, setShowDisplayNav] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [displayNavSearch, setDisplayNavSearch] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const linkRef = useRef<HTMLDivElement>(null)
  const displayNavRef = useRef<HTMLDivElement>(null)
  const displayNavSearchRef = useRef<HTMLInputElement>(null)
  const linkSearchRef = useRef<HTMLInputElement>(null)
  const [serverOrigin, setServerOrigin] = useState(window.location.origin)
  const [displayConfigs, setDisplayConfigs] = useState<DisplayConfigItem[]>([])

  useEffect(() => {
    fetch('/api/server-ip')
      .then(r => r.json())
      .then(({ ip, port }) => setServerOrigin(`http://${ip}:${port}`))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (showLinks || showDisplayNav) {
      getDisplayConfigs().then(setDisplayConfigs).catch(() => {})
    }
  }, [showLinks, showDisplayNav])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (displayNavRef.current && !displayNavRef.current.contains(e.target as Node))
        setShowDisplayNav(false)
    }
    if (showDisplayNav) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => displayNavSearchRef.current?.focus(), 60)
    } else {
      setDisplayNavSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showDisplayNav])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (linkRef.current && !linkRef.current.contains(e.target as Node))
        setShowLinks(false)
    }
    if (showLinks) {
      document.addEventListener('mousedown', handler)
      setTimeout(() => linkSearchRef.current?.focus(), 60)
    } else {
      setLinkSearch('')
    }
    return () => document.removeEventListener('mousedown', handler)
  }, [showLinks])

  const copyLink = (key: string, path: string) => {
    const url = serverOrigin + path
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key)
      setTimeout(() => { setCopiedKey(null); setShowLinks(false) }, 1800)
    })
  }

  const downloadShortcut = (name: string, path: string) => {
    const url = serverOrigin + path
    const a = document.createElement('a')
    // Anchor-click downloads bypass fetch() entirely, so the window.fetch token patch in
    // src/lib/api.ts never sees this request — the token has to be appended here directly.
    const token = window.__API_TOKEN__ ? `&token=${encodeURIComponent(window.__API_TOKEN__)}` : ''
    a.href = `/api/shortcut/download?name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}${token}`
    a.click()
  }

  const saveShortcut = async (key: string, name: string, path: string) => {
    const url = serverOrigin + path
    try {
      const res = await fetch('/api/shortcut/desktop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
      })
      const data = await res.json()
      if (data.success) {
        setSavedKey(key)
        setTimeout(() => setSavedKey(null), 2500)
      }
    } catch {}
  }

  const handleLogout = () => {
    sessionStorage.clear()
    navigate('/login')
  }

  const isDisplayActive = location.pathname.startsWith('/display-configs')

  return (
    <nav className="app-nav">
      <button className="app-nav-brand" onClick={() => navigate('/main')}>
        <div className="app-nav-brand-icon">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <span>QUEUE OPD</span>
      </button>

      <div className="app-nav-sep" />

      <div className="app-nav-links">
        {NAV_LINKS.map(link => {
          const active = location.pathname === link.path || location.pathname.startsWith(link.path + '/')
          return (
            <button
              key={link.path}
              className={`app-nav-link ${active ? 'active' : ''}`}
              onClick={() => navigate(link.path)}
            >
              {link.icon}
              {link.label}
              {active && <span className="app-nav-link-bar" />}
            </button>
          )
        })}

        {/* Display — dropdown list of all display configs */}
        <div className="app-nav-display-wrap" ref={displayNavRef}>
          <button
            className={`app-nav-link ${isDisplayActive || showDisplayNav ? 'active' : ''}`}
            onClick={() => setShowDisplayNav(v => !v)}
            title="เลือกจอแสดงคิว"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 20h8M12 18v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            หน้าจอแสดงคิว
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2, opacity: 0.6 }}>
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {(isDisplayActive || showDisplayNav) && <span className="app-nav-link-bar" />}
          </button>

          {showDisplayNav && (
            <div className="app-nav-display-menu">
              <div className="app-nav-display-header">เลือกจอแสดงคิว</div>

              <div className="app-nav-display-search-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="app-nav-display-search-icon">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  ref={displayNavSearchRef}
                  className="app-nav-display-search-input"
                  type="text"
                  placeholder="ค้นหาจอแสดงคิว..."
                  value={displayNavSearch}
                  onChange={e => setDisplayNavSearch(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                />
                {displayNavSearch && (
                  <button className="app-nav-display-search-clear" onClick={() => { setDisplayNavSearch(''); displayNavSearchRef.current?.focus() }}>✕</button>
                )}
              </div>

              <div className="app-nav-display-list-scroll">
                {(() => {
                  const filtered = displaySearchFilter(displayConfigs, displayNavSearch)
                  if (displayConfigs.length === 0) {
                    return (
                      <div className="app-nav-display-empty">
                        ยังไม่มีจอแสดงคิว —{' '}
                        <span className="app-nav-display-manage" onClick={() => { navigate('/display-configs'); setShowDisplayNav(false) }}>
                          สร้างใหม่
                        </span>
                      </div>
                    )
                  }
                  if (filtered.length === 0) {
                    return <div className="app-nav-display-empty">ไม่พบจอ "{displayNavSearch}"</div>
                  }
                  return filtered.map(cfg => (
                    <div key={cfg.id} className="app-nav-display-group">
                      {/* Display row — คลิกเปิดจอ */}
                      <div
                        className="app-nav-display-item app-nav-display-item-head"
                        onClick={() => { openDisplay(cfg); setShowDisplayNav(false) }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="app-nav-display-icon">
                          <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 20h8M12 18v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="app-nav-display-name">
                          {cfg.name}
                          {cfg.channels?.length ? <span className="app-nav-display-ch-count"> ({cfg.channels.length} ช่อง)</span> : null}
                        </span>
                      </div>
                    </div>
                  ))
                })()}
              </div>

              <div className="app-nav-display-divider" />
              <div
                className="app-nav-display-manage-row"
                onClick={() => { navigate('/display-configs'); setShowDisplayNav(false) }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                จัดการหน้าจอแสดงคิว
              </div>
            </div>
          )}
        </div>
        {/* Copy Link dropdown */}
        <div className="app-nav-copylink-wrap" ref={linkRef}>
          <button
            className={`app-nav-link${showLinks ? ' active' : ''}`}
            onClick={() => setShowLinks(v => !v)}
            title="คัดลอกลิ้งหน้าต่างๆ"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            ลิ้ง
            {showLinks && <span className="app-nav-link-bar" />}
          </button>

          {showLinks && (
            <div className="app-nav-copylink-menu">
              <div className="app-nav-display-search-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="app-nav-display-search-icon">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  ref={linkSearchRef}
                  className="app-nav-display-search-input"
                  type="text"
                  placeholder="ค้นหาลิ้ง..."
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                />
                {linkSearch && (
                  <button className="app-nav-display-search-clear" onClick={() => { setLinkSearch(''); linkSearchRef.current?.focus() }}>✕</button>
                )}
              </div>

              <div className="app-nav-copylink-list-scroll">
                {(() => {
                  const filteredDisplays = displaySearchFilter(displayConfigs, linkSearch)
                  const filteredStatic = STATIC_PAGES.filter(p =>
                    !linkSearch.trim() || p.label.toLowerCase().includes(linkSearch.trim().toLowerCase())
                  )
                  const nothingFound = filteredDisplays.length === 0 && filteredStatic.length === 0 && displayConfigs.length > 0

                  return (
                    <>
                      {/* ── จอแสดงคิว (dynamic) ── */}
                      {(displayConfigs.length === 0 || filteredDisplays.length > 0) && (
                        <div className="app-nav-copylink-header">🖥 จอแสดงคิว</div>
                      )}
                      {displayConfigs.length === 0 ? (
                        <div className="app-nav-copylink-item" style={{ opacity: 0.5, fontSize: 12 }}>
                          <span className="app-nav-copylink-icon">🖥</span>
                          <div className="app-nav-copylink-info">
                            <div className="app-nav-copylink-label">หน้าจอแสดงคิว (ทั่วไป)</div>
                            <div className="app-nav-copylink-url">{serverOrigin}/#/display</div>
                          </div>
                          <button className={`app-nav-copylink-btn${copiedKey === 'display' ? ' copied' : ''}`}
                            onClick={() => copyLink('display', '/#/display')}>
                            {copiedKey === 'display' ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                          </button>
                        </div>
                      ) : (
                        filteredDisplays.map(cfg => {
                          const path = `/#/display?id=${cfg.id}`
                          const key = `display-${cfg.id}`
                          const url = serverOrigin + path
                          return (
                            <div key={key} className="app-nav-copylink-item">
                              <span className="app-nav-copylink-icon">🖥</span>
                              <div className="app-nav-copylink-info">
                                <div className="app-nav-copylink-label">
                                  {cfg.name}
                                  {cfg.channels?.length ? <span style={{ color: '#00BCD4', marginLeft: 6, fontSize: 11 }}>({cfg.channels.length} ช่อง)</span> : ''}
                                </div>
                                <div className="app-nav-copylink-url">{url}</div>
                              </div>
                              <button className={`app-nav-copylink-btn${copiedKey === key ? ' copied' : ''}`}
                                onClick={() => copyLink(key, path)}>
                                {copiedKey === key ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                              </button>
                              <button className="app-nav-shortcut-btn"
                                onClick={() => downloadShortcut(cfg.name, path)}
                                title="ดาวน์โหลด Shortcut (.url)">
                                ⬇ .url
                              </button>
                            </div>
                          )
                        })
                      )}

                      {/* ── หน้าอื่นๆ ── */}
                      {filteredStatic.length > 0 && (
                        <div className="app-nav-copylink-header" style={{ marginTop: 6 }}>หน้าอื่นๆ</div>
                      )}
                      {filteredStatic.map(p => {
                        const url = serverOrigin + p.path
                        return (
                          <div key={p.path} className="app-nav-copylink-item">
                            <span className="app-nav-copylink-icon">{p.icon}</span>
                            <div className="app-nav-copylink-info">
                              <div className="app-nav-copylink-label">{p.label}</div>
                              <div className="app-nav-copylink-url">{url}</div>
                            </div>
                            <button className={`app-nav-copylink-btn${copiedKey === p.path ? ' copied' : ''}`}
                              onClick={() => copyLink(p.path, p.path)}>
                              {copiedKey === p.path ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                            </button>
                            <button className="app-nav-shortcut-btn"
                              onClick={() => downloadShortcut(p.label, p.path)}
                              title="ดาวน์โหลด Shortcut (.url)">
                              ⬇ .url
                            </button>
                          </div>
                        )
                      })}

                      {nothingFound && (
                        <div className="app-nav-display-empty">ไม่พบลิ้ง "{linkSearch}"</div>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        className="app-nav-mini-btn"
        onClick={() => {
          const w = 320, h = 580
          const popup = window.open(
            '/#/queue-mini', 'queue-mini',
            `width=${w},height=${h},left=${window.screen.width - w - 20},top=${Math.max(0, window.screen.height - h - 60)},resizable=yes,menubar=no,toolbar=no,location=no,status=no`
          )
          // Store reference so QueueCall page can refocus it after audio plays
          if (popup) (window as any).__miniWindow = popup
        }}
        title="เปิดหน้า Mini เรียกคิว"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Mini
      </button>

      <div className="app-nav-right">
        <div className="app-nav-user">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{officer}</span>
        </div>
        <button className="app-nav-logout" onClick={handleLogout}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          ออกจากระบบ
        </button>
      </div>
    </nav>
  )
}
