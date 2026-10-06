// Queue OPD — Express + WebSocket server (Browser mode)
'use strict'

// Polyfill for Node.js < 19: msedge-tts requires globalThis.crypto (Web Crypto API)
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto
}

const http = require('http')
const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const mysql = require('mysql2/promise')
const { Client: PgClient } = require('pg')
const md5 = require('md5')

const PORT = process.env.PORT || 3200
const DATA_DIR = process.env.QUEUE_DATA_DIR || path.join(__dirname, '..', 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'db-settings.json')
const DISPLAY_CONFIGS_FILE = path.join(DATA_DIR, 'display-configs.json')
const QUEUE_STAGING_FILE = path.join(DATA_DIR, 'queue-staging.json')
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache')

// Ensure data dirs exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(TTS_CACHE_DIR)) fs.mkdirSync(TTS_CACHE_DIR, { recursive: true })

// ─── Seed default configs on first run ───────────────────────────────────────

const DEFAULT_DISPLAY_CONFIGS = [
  {
    "id": "1780456207756",
    "name": "ซักประวัติตรวจโรคทั่วไป",
    "bgColor": "#bbdf07",
    "textColor": "#FFFFFF",
    "queueColor": "#00BCD4",
    "font": "Sarabun",
    "fontSize": 120,
    "title": "ระบบคิวผู้ป่วยนอก-ตรวจโรคทั่วไป",
    "subTitle": "GP",
    "showClock": true,
    "queueBgColor": "rgba(0,188,212,0.15)",
    "showHistory": true,
    "animationType": "scale",
    "soundEnabled": true,
    "channels": ["1", "2"]
  }
]

const DEFAULT_QD_CONFIG = {
  "title": "ระบบคิวผู้ป่วยนอก",
  "headerBg": "#061332",
  "headerTextColor": "#faf9f9",
  "showClock": true,
  "clockColor": "#fb1909",
  "soundEnabled": true,
  "colSpHeader": "ช่องบริการ",
  "colQueueHeader": "หมายเลขที่เรียกเข้าบริการ",
  "tableHeaderBg": "#2f90c1",
  "tableHeaderColor": "#ffffff",
  "spColumnBg": "#f8f9fa",
  "spColumnColor": "#0f0f48",
  "spHeaderBg": "#1b92c5",
  "spHeaderColor": "#ffffff",
  "showNoShowPanel": true,
  "noShowItemHeight": 120,
  "queueBg": "#ffffff",
  "queueColor": "#102565",
  "spDisplayNames": {},
  "spFontSize": 14,
  "spColumnWidth": 300,
  "spColumnVisible": true,
  "borderColor": "#07c3e9",
  "borderWidth": 2,
  "footerHeight": 62,
  "rightPanelBg": "#1a0000",
  "rightPanelHeaderBg": "#7f0000",
  "rightPanelHeaderColor": "#ffffff",
  "rightPanelLabel": "เรียกแล้วไม่มา",
  "rightPanelQueueColor": "#ff6b6b",
  "rightPanelWidth": 310,
  "rightPanelFontSize": 5.5,
  "rightPanelMaxItems": 12,
  "font": "Arial",
  "fontSize": 14.5,
  "animationType": "scale",
  "showFooter": true,
  "marqueeText": "ยินดีต้อนรับ  กรุณานั่งรอเรียกหมายเลขคิว",
  "footerBg": "#1596c1",
  "footerTextColor": "#ffffff",
  "footerFontSize": 31,
  "footerScrollSpeed": 60,
  "hiddenSPs": [],
  "displayStation": "",
  "filterDepts": [],
  "numColumns": 1,
  "spColumns": {},
  "spRows": {},
  "displayConfigId": "1780456207756",
  "displayConfigName": "ซักประวัติตรวจโรคทั่วไป",
  "displayChannels": ["1", "2"],
  "ttsEnabled": true,
  "ttsSource": "server",
  "ttsPrefix1": "ขอเชิญคิว",
  "ttsMiddle": "ที่ช่องบริการ",
  "ttsSuffix": "ค่ะ",
  "ttsVoiceName": "Microsoft เปรมวดี Online (Natural) - Thai (Thailand)",
  "ttsServerVoiceName": "th-TH-PremwadeeNeural",
  "ttsRate": 0.7,
  "ttsPitch": 0.9,
  "ttsVolume": 0.8,
  "ttsShowName": false,
  "maskLastName": false
}

const QD_DEFAULT_FILE_SEED = path.join(DATA_DIR, 'qd-default-config.json')
const QD_DISPLAY_CONFIG_SEED = path.join(DATA_DIR, 'qd-config-1780456207756.json')
if (!fs.existsSync(DISPLAY_CONFIGS_FILE))
  fs.writeFileSync(DISPLAY_CONFIGS_FILE, JSON.stringify(DEFAULT_DISPLAY_CONFIGS, null, 2), 'utf-8')
if (!fs.existsSync(QD_DEFAULT_FILE_SEED))
  fs.writeFileSync(QD_DEFAULT_FILE_SEED, JSON.stringify(DEFAULT_QD_CONFIG, null, 2), 'utf-8')
if (!fs.existsSync(QD_DISPLAY_CONFIG_SEED))
  fs.writeFileSync(QD_DISPLAY_CONFIG_SEED, JSON.stringify(DEFAULT_QD_CONFIG, null, 2), 'utf-8')

// ─── TTS queue-number formatter ───────────────────────────────────────────────
// "MA001" → "M A 1"  (spell prefix letters, strip leading zeros)
// "GP-001" → "G P 1"
// "001"    → "1"
// "1"      → "1"  (plain number, no change)
function formatQueueNoForTTS(queueNo) {
  if (!queueNo) return queueNo
  const s = String(queueNo)
  const match = s.match(/^([A-Za-z\-]*)(\d+)$/)
  if (!match) return s
  const prefix  = match[1].replace(/-/g, '')          // strip dashes, keep letters
  const digits  = match[2].split('').join(' ')         // "001" → "0 0 1" (อ่านทุก digit รวม leading zero)
  const spelled = prefix.split('').join(' ')           // "MA" → "M A"
  return [spelled, digits].filter(Boolean).join(' ')
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  } catch {}
  return null
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8')
}

// ─── Display configs helpers ──────────────────────────────────────────────────

function loadDisplayConfigs() {
  try {
    if (fs.existsSync(DISPLAY_CONFIGS_FILE)) return JSON.parse(fs.readFileSync(DISPLAY_CONFIGS_FILE, 'utf-8'))
  } catch {}
  return []
}

function saveDisplayConfigs(configs) {
  fs.writeFileSync(DISPLAY_CONFIGS_FILE, JSON.stringify(configs, null, 2), 'utf-8')
}

// ─── Queue staging helpers ────────────────────────────────────────────────────
// { [displayId]: { [channel]: string[] (queue keys) } } — a queue key is vn::queue_slot

function loadQueueStaging() {
  try {
    if (fs.existsSync(QUEUE_STAGING_FILE)) return JSON.parse(fs.readFileSync(QUEUE_STAGING_FILE, 'utf-8'))
  } catch {}
  return {}
}

function saveQueueStaging(staging) {
  fs.writeFileSync(QUEUE_STAGING_FILE, JSON.stringify(staging, null, 2), 'utf-8')
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

let _mysqlPool = null
let _poolSettings = null

function getMysqlPool(settings) {
  const key = `${settings.host}:${settings.port}:${settings.database}:${settings.username}`
  if (_mysqlPool && _poolSettings === key) return _mysqlPool
  if (_mysqlPool) { _mysqlPool.end().catch(() => {}) }
  _mysqlPool = mysql.createPool({
    host: settings.host, port: settings.port,
    database: settings.database, user: settings.username,
    password: settings.password,
    waitForConnections: true, connectionLimit: 5, queueLimit: 0,
    connectTimeout: 5000
  })
  _poolSettings = key
  return _mysqlPool
}

async function queryDB(settings, sql, sqlPg, params) {
  if (!settings) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ')
  if (settings.type === 'mysql') {
    const pool = getMysqlPool(settings)
    const [rows] = await pool.execute(sql, params)
    return rows
  }
  const client = new PgClient({
    host: settings.host, port: settings.port,
    database: settings.database, user: settings.username,
    password: settings.password, connectionTimeoutMillis: 5000
  })
  await client.connect()
  try {
    const res = await client.query(sqlPg, params)
    return res.rows
  } finally {
    await client.end()
  }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// Serve built frontend (supports env override for packaged Electron app)
const RENDERER_DIR = process.env.RENDERER_DIR || path.join(__dirname, '..', 'out', 'renderer')

// index.html is served dynamically (not by express.static) so the current API token can be
// stamped into it as window.__API_TOKEN__ on every load — that's how the browser UI ends up
// carrying the token on its /api/* calls (see src/lib/api.ts) without the user ever seeing it.
function serveIndexWithToken(req, res) {
  const indexFile = path.join(RENDERER_DIR, 'index.html')
  if (!fs.existsSync(indexFile)) return res.status(404).send('Build the renderer first: npm run build')
  try {
    const token = loadSettings()?.apiToken || ''
    const html = fs.readFileSync(indexFile, 'utf-8')
      .replace('<head>', `<head><script>window.__API_TOKEN__=${JSON.stringify(token)}<\/script>`)
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.sendFile(indexFile)
  }
}

if (fs.existsSync(RENDERER_DIR)) {
  app.get(['/', '/index.html'], serveIndexWithToken)
  // index: false — index.html must go through serveIndexWithToken above, not be auto-served here
  app.use(express.static(RENDERER_DIR, { index: false }))
}

// Serve TTS audio cache
app.use('/tts-audio', express.static(TTS_CACHE_DIR))

// ─── API token gate ────────────────────────────────────────────────────────────
// Protects every /api/* route from being called directly (e.g. a URL copied out of devtools and
// replayed in Postman) once a token has been generated on the connection-settings screen. Until
// then (settings.apiToken unset — the default/fresh-install state) this is a no-op, so it can
// never lock an unconfigured install out of its own setup screens. The browser UI never has to
// know this exists: the token rides along automatically via the window.fetch patch in
// src/lib/api.ts, fed by the value serveIndexWithToken stamps into the page above.
function requireApiToken(req, res, next) {
  const configuredToken = loadSettings()?.apiToken
  if (!configuredToken) return next()
  const provided = req.get('X-API-Token') || req.query.token
  if (provided === configuredToken) return next()
  res.status(401).json({ success: false, message: 'Unauthorized: missing or invalid API token' })
}
app.use('/api', requireApiToken)


// ─── Server-side TTS (Microsoft Edge Neural + SAPI fallback) ─────────────────

const { exec } = require('child_process')
const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')

// Edge Neural TTS voices (requires internet, Microsoft Edge TTS service)
const EDGE_VOICES = [
  // ── Thai ──────────────────────────────────────────────────────────────────
  { name: 'th-TH-PremwadeeNeural',        label: '🇹🇭 เปรมวดี (ไทย หญิง) — Neural' },
  { name: 'th-TH-AcharaNeural',           label: '🇹🇭 อาจารา (ไทย หญิง) — Neural' },
  { name: 'th-TH-NiwatNeural',            label: '🇹🇭 นิวัตร (ไทย ชาย) — Neural' },
  // ── English (Female) ──────────────────────────────────────────────────────
  { name: 'en-US-JennyNeural',            label: '🇺🇸 Jenny (อังกฤษ หญิง) — Neural' },
  { name: 'en-US-AriaNeural',             label: '🇺🇸 Aria (อังกฤษ หญิง) — Neural' },
  { name: 'en-US-MichelleNeural',         label: '🇺🇸 Michelle (อังกฤษ หญิง) — Neural' },
  { name: 'en-GB-SoniaNeural',            label: '🇬🇧 Sonia (อังกฤษ UK หญิง) — Neural' },
  // ── English (Male) ────────────────────────────────────────────────────────
  { name: 'en-US-GuyNeural',              label: '🇺🇸 Guy (อังกฤษ ชาย) — Neural' },
]

const GOOGLE_VOICES = [
  { name: 'th-TH-Google', label: '🇹🇭 Google TTS (ไทย)' },
]

function cleanTTSCache(exceptFile) {
  try {
    const now = Date.now()
    fs.readdirSync(TTS_CACHE_DIR).forEach(f => {
      if (f === exceptFile) return
      try {
        if (now - fs.statSync(path.join(TTS_CACHE_DIR, f)).mtimeMs > 8 * 60 * 60 * 1000)
          fs.unlinkSync(path.join(TTS_CACHE_DIR, f))
      } catch {}
    })
  } catch {}
}

// Dedup map: prevents concurrent calls with same key from writing to the same file simultaneously
const _edgeTtsInProgress = new Map()
const _googleTtsInProgress = new Map()

// Google Translate TTS — fast HTTP GET, no SDK needed, cache key matches Edge TTS format
async function generateGoogleTTS(text, rate) {
  const crypto = require('crypto')
  const https = require('https')
  // Use voice name in key so it's compatible with the unified prewarm cache check
  const cacheKey = crypto.createHash('md5').update(`th-TH-Google_${String(rate ?? 1)}_${text}`).digest('hex')
  const filename = `tts_${cacheKey}.mp3`
  const filepath = path.join(TTS_CACHE_DIR, filename)

  if (fs.existsSync(filepath)) {
    console.log(`[GoogleTTS] cache hit → ${filename}`)
    return `/tts-audio/${filename}`
  }
  if (_googleTtsInProgress.has(cacheKey)) return _googleTtsInProgress.get(cacheKey)

  const promise = (async () => {
    const speed = Math.min(1.0, Math.max(0.1, parseFloat(rate) || 1))
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=th&client=tw-ob&ttsspeed=${speed}`
    console.log(`[GoogleTTS] speed=${speed} text="${text.slice(0, 50)}"`)
    await new Promise((resolve, reject) => {
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/'
      }
      const doGet = (target) => {
        https.get(target, { headers: reqHeaders }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            return doGet(res.headers.location)
          }
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`Google TTS HTTP ${res.statusCode}`))
          }
          const ws = fs.createWriteStream(filepath)
          res.pipe(ws)
          ws.on('finish', () => { console.log(`[GoogleTTS] OK → ${filename}`); resolve() })
          ws.on('error', reject)
          res.on('error', reject)
        }).on('error', reject)
      }
      doGet(url)
    })
    cleanTTSCache(filename)
    return `/tts-audio/${filename}`
  })()

  _googleTtsInProgress.set(cacheKey, promise)
  promise.finally(() => _googleTtsInProgress.delete(cacheKey))
  return promise
}

// Edge Neural TTS generation (content-based cache: same text+voice+rate → instant return)
async function generateEdgeTTS(text, voiceName, rate) {
  const voice = voiceName || 'th-TH-AcharaNeural'
  const cacheKey = require('crypto').createHash('md5').update(`${voice}_${String(rate)}_${text}`).digest('hex')
  const filename = `tts_${cacheKey}.mp3`
  const filepath = path.join(TTS_CACHE_DIR, filename)

  if (fs.existsSync(filepath)) {
    console.log(`[EdgeTTS] cache hit → ${filename}`)
    return `/tts-audio/${filename}`
  }

  // Reuse in-progress promise for same text+voice+rate — prevents concurrent writes to the same file
  if (_edgeTtsInProgress.has(cacheKey)) return _edgeTtsInProgress.get(cacheKey)

  const promise = (async () => {
    console.log(`[EdgeTTS] voice=${voice} rate=${rate} text="${text.slice(0, 40)}"`)
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const prosody = new ProsodyOptions()
    prosody.rate = Number(rate)
    const { audioStream } = tts.toStream(text, prosody)

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filepath)
      audioStream.pipe(ws)
      ws.on('finish', () => { console.log(`[EdgeTTS] OK → ${filename}`); resolve() })
      ws.on('error', (e) => { console.error('[EdgeTTS] write error:', e.message); reject(e) })
      audioStream.on('error', (e) => { console.error('[EdgeTTS] stream error:', e.message); reject(e) })
    })
    cleanTTSCache(filename)
    return `/tts-audio/${filename}`
  })()

  _edgeTtsInProgress.set(cacheKey, promise)
  promise.finally(() => _edgeTtsInProgress.delete(cacheKey))
  return promise
}

// SAPI fallback (Windows built-in voices) — content-based cache to avoid regenerating same text
// Concurrent generation of the same text is deduplicated via _sapiInProgress map
const _sapiInProgress = new Map()
function generateSAPITTS(text, voiceName, rate) {
  const cacheKey = require('crypto').createHash('md5').update(`sapi_${voiceName}_${String(rate)}_${text}`).digest('hex')
  const filename = `tts_sapi_${cacheKey}.wav`
  const filepath = path.join(TTS_CACHE_DIR, filename)
  if (fs.existsSync(filepath)) return Promise.resolve(`/tts-audio/${filename}`)
  // Deduplicate concurrent requests for the same text+voice — reuse in-progress Promise
  if (_sapiInProgress.has(cacheKey)) return _sapiInProgress.get(cacheKey)
  const promise = new Promise((resolve, reject) => {
    const sapiRate = Math.max(-10, Math.min(10, Math.round((Number(rate) - 1) * 7)))
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      // try/catch: if voice not installed, fall back to system default rather than throwing
      voiceName ? `try { $s.SelectVoice('${voiceName.replace(/'/g, "''")}') } catch { }` : '',
      `$s.Rate = ${sapiRate}`,
      `$s.SetOutputToWaveFile('${filepath.replace(/\\/g, '\\\\')}')`,
      `$s.Speak('${text.replace(/'/g, "''")}')`,
      '$s.Dispose()'
    ].filter(Boolean).join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 15000 },
      (err) => {
        if (err || !fs.existsSync(filepath) || fs.statSync(filepath).size < 512) {
          return reject(err || new Error('WAV not created or empty'))
        }
        cleanTTSCache(filename)
        resolve(`/tts-audio/${filename}`)
      }
    )
  })
  _sapiInProgress.set(cacheKey, promise)
  promise.finally(() => _sapiInProgress.delete(cacheKey))
  return promise
}

// HOST audio — plays WAV files sequentially on the Windows machine via System.Media.SoundPlayer (offline, reliable)
// Only enabled when Microsoft Pattara (Thai) voice is actually accessible via System.Speech on this machine.
// If Pattara is not installed, HOST audio stays silent — prevents English fallback voice from playing.
const _hostAudioQueue = []
let _hostAudioBusy = false
let _hostAudioEnabled = false

exec(
  `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -eq 'Microsoft Pattara' } | Measure-Object | Select-Object -ExpandProperty Count"`,
  { timeout: 8000 },
  (err, stdout) => {
    _hostAudioEnabled = !err && parseInt(stdout.trim()) > 0
    console.log(`[HOST audio] Microsoft Pattara ${_hostAudioEnabled ? 'found — host playback enabled' : 'not found — host playback disabled'}`)
  }
)

function drainHostAudio() {
  if (_hostAudioQueue.length === 0) { _hostAudioBusy = false; return }
  _hostAudioBusy = true
  const wavFilePath = _hostAudioQueue.shift()
  if (!fs.existsSync(wavFilePath)) { drainHostAudio(); return }
  const escaped = wavFilePath.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const script = `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  console.log('[HOST audio] playing:', path.basename(wavFilePath))
  exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: 30000 },
    () => drainHostAudio()
  )
}

function playAudioOnHost(wavFilePath) {
  if (!wavFilePath || !fs.existsSync(wavFilePath)) return
  _hostAudioQueue.push(wavFilePath)
  if (!_hostAudioBusy) drainHostAudio()
}

// Limit concurrent Edge TTS connections — Microsoft rate-limits after too many simultaneous WebSocket connections
let _edgeTtsActive = 0
const EDGE_TTS_MAX_CONCURRENT = 2

// Sequential prewarm queue — processes tasks one at a time, yields when main calls are active
const _prewarmTasks = []
let _prewarmDraining = false

async function drainPrewarmQueue() {
  if (_prewarmDraining) return
  _prewarmDraining = true
  try {
    while (_prewarmTasks.length > 0) {
      const task = _prewarmTasks[0]
      // Skip if already cached
      const cacheKey = require('crypto').createHash('md5').update(`${task.voice}_${String(task.rate)}_${task.text}`).digest('hex')
      if (fs.existsSync(path.join(TTS_CACHE_DIR, `tts_${cacheKey}.mp3`))) {
        _prewarmTasks.shift()
        continue
      }
      // Yield when main call is generating Edge TTS
      if (_edgeTtsActive >= EDGE_TTS_MAX_CONCURRENT) {
        await new Promise(r => setTimeout(r, 300))
        continue
      }
      _prewarmTasks.shift()
      try {
        if (GOOGLE_VOICES.some(v => v.name === task.voice)) {
          await generateGoogleTTS(task.text, task.rate)
        } else {
          await generateEdgeTTS(task.text, task.voice, task.rate)
        }
        console.log(`[prewarm] ${task.label}`)
      } catch {}
      await new Promise(r => setTimeout(r, 150))
    }
  } finally {
    _prewarmDraining = false
    if (_prewarmTasks.length > 0) drainPrewarmQueue()
  }
}

function enqueuePrewarm(text, voice, rate, label, priority = false) {
  const existingIdx = _prewarmTasks.findIndex(t => t.text === text && t.voice === voice)
  if (existingIdx !== -1) {
    // Already queued — if priority, move to front so it runs immediately
    if (priority && existingIdx > 0) {
      const [task] = _prewarmTasks.splice(existingIdx, 1)
      _prewarmTasks.unshift(task)
    }
    return
  }
  const task = { text, voice, rate: rate ?? 1, label: label || '' }
  if (priority) {
    _prewarmTasks.unshift(task) // jump to front — post-call prewarm runs before server background tasks
  } else {
    _prewarmTasks.push(task)
  }
  drainPrewarmQueue()
}

// Main TTS generator — routes to Google, Edge, or SAPI based on configured voice.
async function generateServerTTS(text, voiceName, rate) {
  const crypto = require('crypto')
  // Google TTS — fast direct HTTP, no timeout complexity needed
  if (GOOGLE_VOICES.some(v => v.name === voiceName)) {
    const googlePromise = generateGoogleTTS(text, rate)
    try {
      return await Promise.race([
        googlePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Google TTS timeout')), 6000))
      ])
    } catch (e) {
      throw Object.assign(e, { edgePromise: googlePromise })
    }
  }
  const isEdgeVoice = EDGE_VOICES.some(v => v.name === voiceName) || !voiceName
  if (isEdgeVoice) {
    const edgeVoice = voiceName || 'th-TH-AcharaNeural'
    // Fast path: Edge cache hit — return correct configured voice with no network call
    const edgeKey = crypto.createHash('md5').update(`${edgeVoice}_${String(rate)}_${text}`).digest('hex')
    if (fs.existsSync(path.join(TTS_CACHE_DIR, `tts_${edgeKey}.mp3`)))
      return `/tts-audio/tts_${edgeKey}.mp3`

    // No Edge cache — start SAPI as parallel fallback ONLY when Pattara is confirmed installed.
    // If Pattara is missing, SAPI falls through to Windows system-default voice (often English),
    // which is worse than letting the browser's 4s fallback fire with the configured Thai voice.
    const sapiPromise = _hostAudioEnabled
      ? generateSAPITTS(text, 'Microsoft Pattara', rate).catch(() => null)
      : null

    // Wait briefly for a concurrency slot instead of dropping the request outright — calling
    // two queues to different channels back-to-back (or a post-call prewarm still running)
    // can easily occupy both Edge slots; without this wait, a call landing at that exact
    // moment used to throw immediately with no SAPI available (host audio off) and no
    // edgePromise to retry from, so its announcement was silently lost.
    const waitStart = Date.now()
    while (_edgeTtsActive >= EDGE_TTS_MAX_CONCURRENT && Date.now() - waitStart < 6000) {
      await new Promise(r => setTimeout(r, 150))
    }

    if (_edgeTtsActive < EDGE_TTS_MAX_CONCURRENT) {
      _edgeTtsActive++
      const edgePromise = generateEdgeTTS(text, edgeVoice, rate)
      try {
        return await Promise.race([
          edgePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Edge TTS timeout')), 6000))
        ])
      } catch (e) {
        // edgePromise still runs in background — caller can listen to it for late broadcast
        console.warn('[TTS] Edge failed/timeout, using SAPI:', e.message)
        throw Object.assign(e, { edgePromise })
      } finally {
        _edgeTtsActive--
      }
    }
    console.warn('[TTS] Edge still at capacity after waiting, using SAPI directly')
    if (sapiPromise) {
      const sapiUrl = await sapiPromise
      if (sapiUrl) return sapiUrl
    }
    throw new Error('TTS generation failed: Edge unavailable, no valid SAPI fallback')
  }
  return generateSAPITTS(text, voiceName, rate)
}

// Test Edge TTS connectivity — open in browser: /api/tts/test
app.get('/api/tts/test', async (req, res) => {
  const voice = req.query.voice || 'th-TH-PremwadeeNeural'
  const text = req.query.text || 'ทดสอบเสียงเปรมวดี'
  try {
    const url = await generateEdgeTTS(String(text), String(voice), 0.8)
    res.json({ success: true, url, voice, text })
  } catch (e) {
    res.json({ success: false, error: e.message, voice, text })
  }
})

// Pre-warm TTS cache for upcoming queues — respond immediately, generate in background
// Accepts servicePoints (array) to prewarm for all visible channels on the display
app.post('/api/tts/prewarm', (req, res) => {
  res.json({ success: true })
  const { queues = [], servicePoints, servicePoint, displayConfigId = '' } = req.body || {}
  // support both legacy single servicePoint and new array servicePoints
  const spList = Array.isArray(servicePoints) ? servicePoints.slice(0, 5)
    : servicePoints ? [String(servicePoints)]
    : servicePoint ? [String(servicePoint)]
    : ['']
  try {
    const qdFile = displayConfigId ? qdConfigFile(displayConfigId) : QD_DEFAULT_FILE
    const qdCfg = fs.existsSync(qdFile)
      ? JSON.parse(fs.readFileSync(qdFile, 'utf-8'))
      : (fs.existsSync(QD_DEFAULT_FILE) ? JSON.parse(fs.readFileSync(QD_DEFAULT_FILE, 'utf-8')) : null)
    if (!qdCfg || !qdCfg.ttsEnabled || qdCfg.ttsSource !== 'server') return
    const voiceName = qdCfg.ttsServerVoiceName || qdCfg.ttsVoiceName || ''
    const isNetworkVoice = EDGE_VOICES.some(v => v.name === voiceName) || GOOGLE_VOICES.some(v => v.name === voiceName) || !voiceName
    const edgeVoice = isNetworkVoice ? (voiceName || 'th-TH-AcharaNeural') : null
    for (const sp of spList) {
      for (const q of queues.slice(0, 3)) {
        const text = (qdCfg.ttsShowName === true) && q.name
          ? [qdCfg.ttsPrefix1, q.name, qdCfg.ttsMiddle, String(sp), qdCfg.ttsSuffix].filter(Boolean).join(' ')
          : [qdCfg.ttsPrefix1, formatQueueNoForTTS(q.no), qdCfg.ttsMiddle, String(sp), qdCfg.ttsSuffix].filter(Boolean).join(' ')
        if (edgeVoice) {
          enqueuePrewarm(text, edgeVoice, qdCfg.ttsRate ?? 1, `client sp=${sp} q=${q.no}`)
        } else {
          generateSAPITTS(text, 'Microsoft Pattara', qdCfg.ttsRate ?? 1).catch(() => {})
        }
      }
    }
  } catch {}
})

// Preview TTS — generate audio and return URL for immediate playback
app.post('/api/tts/preview', async (req, res) => {
  try {
    const { text = 'ทดสอบเสียง ขอเชิญลำดับ A001 ที่ช่อง 1 ค่ะ', voiceName = '', rate = 1 } = req.body || {}
    const audioUrl = await generateServerTTS(text, voiceName, rate)
    res.json({ success: true, audioUrl })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// Return combined voice list: Edge Neural + SAPI
app.get('/api/tts/voices', (req, res) => {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: 10000 },
    (err, stdout) => {
      const sapiVoices = err ? [] : stdout.split('\n').map(v => v.trim()).filter(Boolean)
      // Edge voices first (Thai Neural), then SAPI voices
      const googleList = GOOGLE_VOICES.map(v => v.name)
      const edgeList = EDGE_VOICES.map(v => v.name)
      const combined = [...googleList, ...edgeList, ...sapiVoices.filter(v => !edgeList.includes(v) && !googleList.includes(v))]
      res.json(combined)
    }
  )
})

// ─── API: Settings ────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(loadSettings())
})

app.post('/api/settings', (req, res) => {
  saveSettings(req.body)
  res.json({ success: true })
})

// ─── API: DB Test ─────────────────────────────────────────────────────────────

app.post('/api/db/test', async (req, res) => {
  try {
    const s = req.body
    if (s.type === 'mysql') {
      const conn = await mysql.createConnection({
        host: s.host, port: s.port, database: s.database,
        user: s.username, password: s.password, connectTimeout: 5000
      })
      await conn.ping()
      await conn.end()
    } else {
      const client = new PgClient({
        host: s.host, port: s.port, database: s.database,
        user: s.username, password: s.password, connectionTimeoutMillis: 5000
      })
      await client.connect()
      await client.end()
    }
    res.json({ success: true, message: 'เชื่อมต่อสำเร็จ' })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// ─── API: DB Table — queue_opd_qs_slot ────────────────────────────────────────

const QUEUE_OPD_QS_SLOT_TABLE = 'queue_opd_qs_slot'

// No AUTO_INCREMENT/SERIAL — matches the real table, whose id column is a plain
// PK filled manually as MAX(id)+1 by recordQueueOpdQsSlotCall() below.
const CREATE_QUEUE_OPD_QS_SLOT_MYSQL = `
CREATE TABLE queue_opd_qs_slot (
  queue_opd_qs_slot_id INT(11) NOT NULL,
  queue_schedule_date DATE,
  queue_doctor_code VARCHAR(20),
  queue_queue_slot_number VARCHAR(50),
  queue_start_time TIME,
  queue_finish_time TIME,
  queue_time_second TIME,
  queue_slot_key VARCHAR(200),
  queue_vn VARCHAR(12),
  queue_call_status CHAR(1),
  queue_call_datetime DATETIME,
  queue_call_no INT(11),
  queue_opd_qs_room_id INT(11),
  queue_call_opd_qs_room_id INT(11),
  PRIMARY KEY (queue_opd_qs_slot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8`

const CREATE_QUEUE_OPD_QS_SLOT_PG = `
CREATE TABLE queue_opd_qs_slot (
  queue_opd_qs_slot_id INTEGER PRIMARY KEY,
  queue_schedule_date DATE,
  queue_doctor_code VARCHAR(20),
  queue_queue_slot_number VARCHAR(50),
  queue_start_time TIME,
  queue_finish_time TIME,
  queue_time_second TIME,
  queue_slot_key VARCHAR(200),
  queue_vn VARCHAR(12),
  queue_call_status CHAR(1),
  queue_call_datetime TIMESTAMP,
  queue_call_no INTEGER,
  queue_opd_qs_room_id INTEGER,
  queue_call_opd_qs_room_id INTEGER
)`

async function queueOpdQsSlotExists(s) {
  if (s.type === 'mysql') {
    const conn = await mysql.createConnection({
      host: s.host, port: s.port, database: s.database,
      user: s.username, password: s.password, connectTimeout: 5000
    })
    try {
      const [rows] = await conn.query(
        'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [s.database, QUEUE_OPD_QS_SLOT_TABLE]
      )
      return rows[0].cnt > 0
    } finally {
      await conn.end()
    }
  } else {
    const client = new PgClient({
      host: s.host, port: s.port, database: s.database,
      user: s.username, password: s.password, connectionTimeoutMillis: 5000
    })
    await client.connect()
    try {
      const result = await client.query(
        'SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = $1',
        [QUEUE_OPD_QS_SLOT_TABLE]
      )
      return Number(result.rows[0].cnt) > 0
    } finally {
      await client.end()
    }
  }
}

app.post('/api/db/table/queue-opd-qs-slot/check', async (req, res) => {
  try {
    const exists = await queueOpdQsSlotExists(req.body)
    res.json({ success: true, exists })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

app.post('/api/db/table/queue-opd-qs-slot/create', async (req, res) => {
  try {
    const s = req.body
    if (await queueOpdQsSlotExists(s)) {
      return res.json({ success: false, exists: true, message: 'ตาราง queue_opd_qs_slot มีอยู่แล้ว' })
    }
    if (s.type === 'mysql') {
      const conn = await mysql.createConnection({
        host: s.host, port: s.port, database: s.database,
        user: s.username, password: s.password, connectTimeout: 5000
      })
      try {
        await conn.query(CREATE_QUEUE_OPD_QS_SLOT_MYSQL)
      } finally {
        await conn.end()
      }
    } else {
      const client = new PgClient({
        host: s.host, port: s.port, database: s.database,
        user: s.username, password: s.password, connectionTimeoutMillis: 5000
      })
      await client.connect()
      try {
        await client.query(CREATE_QUEUE_OPD_QS_SLOT_PG)
      } finally {
        await client.end()
      }
    }
    res.json({ success: true, exists: true, message: 'สร้างตาราง queue_opd_qs_slot สำเร็จ' })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// ─── queue_opd_qs_slot — log each call (insert one row per call) ──────────────

function pad2(n) { return String(n).padStart(2, '0') }
function formatTimeHMS(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` }
function formatDateTimeSQL(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${formatTimeHMS(d)}`
}

// queue_time_second is a TIME column — format the elapsed seconds as ชม:นาที:วินาที.
// MySQL's TIME supports negative values (-838:59:59..838:59:59); Postgres's does not,
// so a negative diff is clamped to 00:00:00 there.
function formatDurationHHMMSS(totalSeconds, allowNegative) {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return null
  const negative = totalSeconds < 0
  const abs = Math.round(Math.abs(totalSeconds))
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  const hms = `${pad2(h)}:${pad2(m)}:${pad2(s)}`
  return negative && allowNegative ? `-${hms}` : (negative ? '00:00:00' : hms)
}

const QUEUE_OPD_QS_SLOT_SOURCE_MYSQL = `
SELECT os.schedule_date, os.doctor_code, os.queue_slot_number, os.start_time, os.slot_key, os.vn, os.opd_qs_room_id,
       TIME_TO_SEC(?) - TIME_TO_SEC(ov.vsttime) AS diff_seconds
FROM opd_qs_slot os
LEFT JOIN ovst ov ON ov.vn = os.vn
WHERE os.vn = ? AND os.queue_slot_number = ?
LIMIT 1`

const QUEUE_OPD_QS_SLOT_SOURCE_PG = `
SELECT os.schedule_date, os.doctor_code, os.queue_slot_number, os.start_time, os.slot_key, os.vn, os.opd_qs_room_id,
       EXTRACT(EPOCH FROM ($1::time - ov.vsttime::time)) AS diff_seconds
FROM opd_qs_slot os
LEFT JOIN ovst ov ON ov.vn = os.vn
WHERE os.vn = $2 AND os.queue_slot_number = $3
LIMIT 1`

const QUEUE_OPD_QS_SLOT_INSERT_MYSQL = `
INSERT INTO queue_opd_qs_slot
  (queue_opd_qs_slot_id, queue_schedule_date, queue_doctor_code, queue_queue_slot_number, queue_start_time,
   queue_finish_time, queue_time_second, queue_slot_key, queue_vn, queue_call_status, queue_call_datetime, queue_call_no, queue_opd_qs_room_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y', ?, ?, ?)`

const QUEUE_OPD_QS_SLOT_INSERT_PG = `
INSERT INTO queue_opd_qs_slot
  (queue_opd_qs_slot_id, queue_schedule_date, queue_doctor_code, queue_queue_slot_number, queue_start_time,
   queue_finish_time, queue_time_second, queue_slot_key, queue_vn, queue_call_status, queue_call_datetime, queue_call_no, queue_opd_qs_room_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Y', $10, $11, $12)`

// queue_opd_qs_slot_id has no AUTO_INCREMENT on the real table — next id is MAX(id)+1,
// computed under a row lock (FOR UPDATE) in the same transaction as the insert to avoid
// two concurrent calls picking the same id. queue_call_no counts how many times this same
// vn+queue_slot_number has already been logged (re-calls), so it reads 1, 2, 3... in order.
async function recordQueueOpdQsSlotCall(settings, vn, queueSlotNumber) {
  if (!vn || !queueSlotNumber) return
  const now = new Date()
  const finishTime = formatTimeHMS(now)
  const callDatetime = formatDateTimeSQL(now)
  try {
    if (settings.type === 'mysql') {
      const pool = getMysqlPool(settings)
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [rows] = await conn.query(QUEUE_OPD_QS_SLOT_SOURCE_MYSQL, [finishTime, vn, queueSlotNumber])
        const src = rows[0]
        if (!src) { await conn.rollback(); return }
        const [idRows] = await conn.query('SELECT COALESCE(MAX(queue_opd_qs_slot_id), 0) + 1 AS next_id FROM queue_opd_qs_slot FOR UPDATE')
        const [cntRows] = await conn.query(
          'SELECT COUNT(*) AS cnt FROM queue_opd_qs_slot WHERE queue_vn = ? AND queue_queue_slot_number = ?',
          [vn, queueSlotNumber]
        )
        const callNo = cntRows[0].cnt + 1
        await conn.query(QUEUE_OPD_QS_SLOT_INSERT_MYSQL, [
          idRows[0].next_id, src.schedule_date, src.doctor_code, src.queue_slot_number, src.start_time,
          finishTime, formatDurationHHMMSS(src.diff_seconds, true), src.slot_key, src.vn, callDatetime, callNo, src.opd_qs_room_id
        ])
        await conn.commit()
      } catch (err) {
        await conn.rollback().catch(() => {})
        throw err
      } finally {
        conn.release()
      }
    } else {
      const client = new PgClient({
        host: settings.host, port: settings.port, database: settings.database,
        user: settings.username, password: settings.password, connectionTimeoutMillis: 5000
      })
      await client.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(QUEUE_OPD_QS_SLOT_SOURCE_PG, [finishTime, vn, queueSlotNumber])
        const src = result.rows[0]
        if (!src) { await client.query('ROLLBACK'); return }
        // Aggregates can't take FOR UPDATE directly in Postgres — lock the raw rows in a subquery first.
        const idResult = await client.query(
          'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM (SELECT queue_opd_qs_slot_id AS id FROM queue_opd_qs_slot FOR UPDATE) t'
        )
        const cntResult = await client.query(
          'SELECT COUNT(*) AS cnt FROM queue_opd_qs_slot WHERE queue_vn = $1 AND queue_queue_slot_number = $2',
          [vn, queueSlotNumber]
        )
        const callNo = Number(cntResult.rows[0].cnt) + 1
        await client.query(QUEUE_OPD_QS_SLOT_INSERT_PG, [
          idResult.rows[0].next_id, src.schedule_date, src.doctor_code, src.queue_slot_number, src.start_time,
          finishTime, formatDurationHHMMSS(Number(src.diff_seconds), false), src.slot_key, src.vn, callDatetime, callNo, src.opd_qs_room_id
        ])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        await client.end()
      }
    }
  } catch (err) {
    console.error('[queue_opd_qs_slot] record failed:', err.message)
  }
}

// ─── API: Auth ────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' })

  const hashed = md5(password).toLowerCase()

  try {
    const rows = await queryDB(
      settings,
      'SELECT officer_login_name, officer_login_password_md5 FROM officer WHERE officer_login_name = ? LIMIT 1',
      'SELECT officer_login_name, officer_login_password_md5 FROM officer WHERE officer_login_name = $1 LIMIT 1',
      [username]
    )
    if (!rows || rows.length === 0) return res.json({ success: false, message: 'ไม่พบชื่อผู้ใช้งาน' })
    const row = rows[0]
    if ((row.officer_login_password_md5 || '').toLowerCase() === hashed) {
      return res.json({ success: true, username: row.officer_login_name })
    }
    res.json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// officer → officer_group_list → officer_group → officer_group_task_access: standard HOSxP
// permission model — an officer belongs to one or more groups, each group is granted access to
// a set of task ids. Used to gate the connection-settings screen to officer_task_id '77'.
const OFFICER_TASK_ACCESS_SQL_MYSQL = `
SELECT l.officer_id
FROM officer_group_task_access t
LEFT OUTER JOIN officer_group g ON g.officer_group_id = t.officer_group_id
LEFT OUTER JOIN officer_group_list l ON l.officer_group_id = g.officer_group_id
LEFT OUTER JOIN officer o ON o.officer_id = l.officer_id
WHERE o.officer_login_name = ? AND t.officer_task_id = ?
LIMIT 1`

const OFFICER_TASK_ACCESS_SQL_PG = `
SELECT l.officer_id
FROM officer_group_task_access t
LEFT OUTER JOIN officer_group g ON g.officer_group_id = t.officer_group_id
LEFT OUTER JOIN officer_group_list l ON l.officer_group_id = g.officer_group_id
LEFT OUTER JOIN officer o ON o.officer_id = l.officer_id
WHERE o.officer_login_name = $1 AND t.officer_task_id = $2
LIMIT 1`

app.post('/api/auth/task-access', async (req, res) => {
  const { username, taskId } = req.body
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, hasAccess: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' })
  if (!username || !taskId) return res.json({ success: false, hasAccess: false, message: 'ข้อมูลไม่ครบถ้วน' })

  try {
    const rows = await queryDB(
      settings,
      OFFICER_TASK_ACCESS_SQL_MYSQL,
      OFFICER_TASK_ACCESS_SQL_PG,
      [username, String(taskId)]
    )
    res.json({ success: true, hasAccess: !!(rows && rows.length > 0) })
  } catch (e) {
    res.json({ success: false, hasAccess: false, message: e.message })
  }
})

// ─── Queue status (today's calls, file-based) ─────────────────────────────────

const QUEUE_CALLS_FILE = path.join(DATA_DIR, 'queue-calls-today.json')
const SP_FILE = path.join(DATA_DIR, 'service-points.json')

function loadServicePoints() {
  try {
    if (fs.existsSync(SP_FILE)) {
      const data = JSON.parse(fs.readFileSync(SP_FILE, 'utf-8'))
      if (Array.isArray(data) && data.length > 0) return data
    }
  } catch {}
  return ['1','2','3','4','5','6'].map(n => ({ id: n, name: `ช่อง ${n}` }))
}
function saveServicePoints(data) {
  fs.writeFileSync(SP_FILE, JSON.stringify(data, null, 2))
}

function getTodayCalls() {
  const today = new Date().toISOString().split('T')[0]
  try {
    if (fs.existsSync(QUEUE_CALLS_FILE)) {
      const d = JSON.parse(fs.readFileSync(QUEUE_CALLS_FILE, 'utf-8'))
      if (d.date === today) return d.calls
    }
  } catch {}
  return {}
}

function saveTodayCalls(calls) {
  const today = new Date().toISOString().split('T')[0]
  fs.writeFileSync(QUEUE_CALLS_FILE, JSON.stringify({ date: today, calls }, null, 2))
}

// A single VN can have multiple opd_qs_slot rows (one per doctor/service point, Queue_Prefix
// mode) — keying call-status purely by VN made calling ONE of them mark ALL of them as
// "calling"/done/skip. Key by vn+queueSlot when a slot number is available (Queue_Prefix),
// falling back to plain vn for modes that only ever have one row per VN.
function callsKey(vn, queueSlot) {
  return queueSlot ? `${vn}::${queueSlot}` : String(vn)
}
function getCallFor(calls, vn, queueSlot) {
  return calls[callsKey(vn, queueSlot)]
}

// ─── HOSxP queue SQL (Slot mode — opd_qs_slot) ───────────────────────────────

const HOSXP_SQL_MYSQL = `
SELECT ov.vstdate, ov.vsttime,
    oq.opd_qs_room_name AS queue_type,
    os.queue_slot_number AS queue_slot,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    d2.name AS slot_doctor_name,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.main_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.main_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.main_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM opd_qs_slot os
LEFT OUTER JOIN doctor d2 ON d2.code = os.doctor_code
LEFT JOIN ovst ov ON ov.vn = os.vn
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
LEFT JOIN opd_qs_room oq ON oq.opd_qs_room_id = os.opd_qs_room_id
WHERE ov.vstdate = ? AND ov.vn IS NOT NULL
ORDER BY k.department, os.queue_slot_number`

const HOSXP_SQL_PG = `
SELECT ov.vstdate, ov.vsttime,
    oq.opd_qs_room_name AS queue_type,
    os.queue_slot_number AS queue_slot,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    d2.name AS slot_doctor_name,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.main_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.main_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.main_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM opd_qs_slot os
LEFT OUTER JOIN doctor d2 ON d2.code = os.doctor_code
LEFT JOIN ovst ov ON ov.vn = os.vn
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
LEFT JOIN opd_qs_room oq ON oq.opd_qs_room_id = os.opd_qs_room_id
WHERE ov.vstdate = $1 AND ov.vn IS NOT NULL
ORDER BY k.department, os.queue_slot_number`

// ─── HOSxP Queue + cur_dep (slot_cur mode) ────────────────────────────────────

const SLOT_CUR_SQL_MYSQL = `
SELECT ov.vstdate, ov.vsttime,
    oq.opd_qs_room_name AS queue_type,
    os.queue_slot_number AS queue_slot,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.cur_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.cur_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.cur_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM opd_qs_slot os
LEFT JOIN ovst ov ON ov.vn = os.vn
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.cur_dep
LEFT JOIN opd_qs_room oq ON oq.opd_qs_room_id = os.opd_qs_room_id
WHERE os.schedule_date = ? AND ov.vn IS NOT NULL
ORDER BY k.department, os.queue_slot_number`

const SLOT_CUR_SQL_PG = `
SELECT ov.vstdate, ov.vsttime,
    oq.opd_qs_room_name AS queue_type,
    os.queue_slot_number AS queue_slot,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.cur_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.cur_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.cur_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM opd_qs_slot os
LEFT JOIN ovst ov ON ov.vn = os.vn
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.cur_dep
LEFT JOIN opd_qs_room oq ON oq.opd_qs_room_id = os.opd_qs_room_id
WHERE os.schedule_date = $1 AND ov.vn IS NOT NULL
ORDER BY k.department, os.queue_slot_number`

// ─── OPD Visit SQL (OPD mode — ovst) ─────────────────────────────────────────

const OPD_SQL_MYSQL = `
SELECT ov.vstdate, ov.vsttime,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.main_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.main_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.main_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM ovst ov
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
WHERE ov.vstdate = ?
ORDER BY k.department, (ov.oqueue + 0), ov.oqueue`

const OPD_SQL_PG = `
SELECT ov.vstdate, ov.vsttime,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.main_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.main_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.main_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM ovst ov
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.main_dep
WHERE ov.vstdate = $1
ORDER BY k.department, (CASE WHEN ov.oqueue::text ~ '^[0-9]+$' THEN ov.oqueue::text::bigint ELSE 0 END), ov.oqueue`

// ─── Current Department SQL (cur_dep mode — ห้องตรวจปัจจุบัน) ────────────────

const CUR_DEP_SQL_MYSQL = `
SELECT ov.vstdate, ov.vsttime,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.cur_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.cur_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.cur_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM ovst ov
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.cur_dep
WHERE ov.vstdate = ?
ORDER BY k.department, ov.oqueue`

const CUR_DEP_SQL_PG = `
SELECT ov.vstdate, ov.vsttime,
    ov.oqueue AS queue_no,
    ov.vn,
    ov.hn,
    CONCAT(pt.fname, ' ', pt.lname) AS queue_name,
    p.name AS insurance,
    k.department,
    CASE
        WHEN EXISTS (SELECT 1 FROM oapp oa WHERE oa.hn = ov.hn AND oa.nextdate = ov.vstdate AND oa.depcode = ov.cur_dep)
        THEN 'appt' ELSE 'walkin'
    END AS visit_type,
    (SELECT d.name FROM oapp oa2 LEFT JOIN doctor d ON d.code = oa2.doctor WHERE oa2.hn = ov.hn AND oa2.nextdate = ov.vstdate AND oa2.depcode = ov.cur_dep LIMIT 1) AS doctor_name,
    (SELECT c.name FROM oapp oa3 LEFT JOIN clinic c ON c.clinic = oa3.clinic WHERE oa3.hn = ov.hn AND oa3.nextdate = ov.vstdate AND oa3.depcode = ov.cur_dep LIMIT 1) AS clinic_name,
    ist.name AS ist_name,
    ost.name AS ost_name
FROM ovst ov
LEFT JOIN patient pt ON pt.hn = ov.hn
LEFT JOIN pttype p ON p.pttype = ov.pttype
LEFT JOIN ovstist ist ON ist.ovstist = ov.ovstist
LEFT JOIN ovstost ost ON ost.ovstost = ov.ovstost
LEFT JOIN kskdepartment k ON k.depcode = ov.cur_dep
WHERE ov.vstdate = $1
ORDER BY k.department, ov.oqueue`

function getSQLByMode(mode) {
  if (mode === 'opd')      return { mysql: OPD_SQL_MYSQL,      pg: OPD_SQL_PG }
  if (mode === 'cur_dep')  return { mysql: CUR_DEP_SQL_MYSQL,  pg: CUR_DEP_SQL_PG }
  if (mode === 'slot_cur') return { mysql: SLOT_CUR_SQL_MYSQL, pg: SLOT_CUR_SQL_PG }
  return { mysql: HOSXP_SQL_MYSQL, pg: HOSXP_SQL_PG }
}

function getTodayDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toLocalDateStr(val) {
  if (!val) return null
  const d = new Date(val)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Lab / X-ray status SQL (loaded separately after queue list) ─────────────

const LAB_XRAY_SQL_MYSQL = `
SELECT ov.vn,
    (SELECT MAX(lab_receive) FROM lab_head WHERE vn = ov.vn) AS lab_receive,
    (SELECT MAX(confirm_report) FROM lab_head WHERE vn = ov.vn) AS confirm_report,
    (SELECT MAX(confirm) FROM xray_report WHERE vn = ov.vn) AS xray_confirm,
    (SELECT MAX(confirm_radiology) FROM xray_report WHERE vn = ov.vn) AS xray_confirm_radiology
FROM ovst ov
WHERE ov.vstdate = ?`

const LAB_XRAY_SQL_PG = `
SELECT ov.vn,
    (SELECT MAX(lab_receive) FROM lab_head WHERE vn = ov.vn) AS lab_receive,
    (SELECT MAX(confirm_report) FROM lab_head WHERE vn = ov.vn) AS confirm_report,
    (SELECT MAX(confirm) FROM xray_report WHERE vn = ov.vn) AS xray_confirm,
    (SELECT MAX(confirm_radiology) FROM xray_report WHERE vn = ov.vn) AS xray_confirm_radiology
FROM ovst ov
WHERE ov.vstdate = $1`

// ─── Appointment doctors (for the "แสดงเฉพาะคนไข้นัด" filter's doctor list) ───
// One row per department+doctor pair, so the client can filter it down to whichever
// department(s) are currently selected without a round-trip per department change.
// Matched directly off oapp's own nextdate/depcode (the scheduled appointment date and
// department) — not via visit_vn — so a doctor shows up here as soon as they have an
// appointment booked for today, whether or not that patient has checked in yet.

const APPT_DOCTORS_SQL_MYSQL = `
SELECT DISTINCT k.department AS department, d.name AS doctor_name
FROM oapp oa
LEFT JOIN doctor d ON d.code = oa.doctor
LEFT JOIN kskdepartment k ON k.depcode = oa.depcode
WHERE oa.nextdate = ? AND d.name IS NOT NULL
ORDER BY k.department, d.name`

const APPT_DOCTORS_SQL_PG = `
SELECT DISTINCT k.department AS department, d.name AS doctor_name
FROM oapp oa
LEFT JOIN doctor d ON d.code = oa.doctor
LEFT JOIN kskdepartment k ON k.depcode = oa.depcode
WHERE oa.nextdate = $1 AND d.name IS NOT NULL
ORDER BY k.department, d.name`

app.get('/api/queue/appointment-doctors', async (req, res) => {
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, data: [] })
  try {
    const today = getTodayDate()
    const rows = await queryDB(settings, APPT_DOCTORS_SQL_MYSQL, APPT_DOCTORS_SQL_PG, [today])
    res.json({ success: true, data: rows })
  } catch (err) {
    res.json({ success: false, data: [], message: err.message })
  }
})

// ─── API: Queue ───────────────────────────────────────────────────────────────

app.get('/api/queue/list', async (req, res) => {
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, data: [] })
  try {
    const mode = ['opd', 'cur_dep', 'slot_cur'].includes(req.query.mode) ? req.query.mode : 'slot'
    const { mysql, pg } = getSQLByMode(mode)
    const today = getTodayDate()
    const rows = await queryDB(settings, mysql, pg, [today])
    const calls = getTodayCalls()
    const data = rows.map(r => {
      const call = getCallFor(calls, r.vn, r.queue_slot)
      // cur_dep / slot_cur modes: only show status from calls made via the same mode
      const isCurMode = mode === 'cur_dep' || mode === 'slot_cur'
      const effectiveStatus = (isCurMode && call && call.mode !== mode)
        ? 'waiting'
        : (call?.status || 'waiting')
      const effectiveSP = (isCurMode && call && call.mode !== mode)
        ? ''
        : (call?.servicePoint || '')
      return {
        ...r,
        vstdate: toLocalDateStr(r.vstdate),
        queue_slot: r.queue_slot != null ? String(r.queue_slot) : null,
        queue_no: r.queue_no != null ? String(r.queue_no) : '',
        status: effectiveStatus,
        service_point: effectiveSP
      }
    })
    res.json({ success: true, data })
  } catch (e) {
    res.json({ success: false, data: [], message: e.message })
  }
})

// Lab & X-ray status — separate slow endpoint, loaded in background after queue list
app.get('/api/queue/lab-xray', async (req, res) => {
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, data: {} })
  try {
    const today = getTodayDate()
    const rows = await queryDB(settings, LAB_XRAY_SQL_MYSQL, LAB_XRAY_SQL_PG, [today])
    // Return as { vn: { lab_receive, confirm_report, xray_confirm, xray_confirm_radiology } }
    const data = {}
    for (const r of rows) {
      if (r.lab_receive || r.confirm_report || r.xray_confirm || r.xray_confirm_radiology) {
        data[r.vn] = {
          lab_receive: r.lab_receive || null,
          confirm_report: r.confirm_report || null,
          xray_confirm: r.xray_confirm || null,
          xray_confirm_radiology: r.xray_confirm_radiology || null,
        }
      }
    }
    res.json({ success: true, data })
  } catch (e) {
    res.json({ success: false, data: {}, message: e.message })
  }
})

app.post('/api/queue/call', async (req, res) => {
  const { identifier, servicePoint, mode, displayConfigId } = req.body
  const settings = loadSettings()
  if (!settings) return res.json({ success: false, message: 'ไม่มีการตั้งค่า' })
  try {
    const qMode = ['opd', 'cur_dep', 'slot_cur'].includes(mode) ? mode : 'slot'
    const { mysql, pg } = getSQLByMode(qMode)
    const today = getTodayDate()
    const rows = await queryDB(settings, mysql, pg, [today])
    const id = String(identifier).trim()
    const found = rows.find(r =>
      String(r.vn) === id ||
      String(r.queue_no || '') === id ||
      String(r.queue_slot || '') === id ||
      String(r.hn || '') === id
    )
    if (!found) return res.json({ success: false, message: `ไม่พบคิว: ${identifier}` })

    const displayNo = found.queue_slot || (found.queue_no != null ? String(found.queue_no) : '')
    const calls = getTodayCalls()
    const department = found.department || ''
    calls[callsKey(found.vn, found.queue_slot)] = {
      vn: found.vn,
      status: 'calling',
      servicePoint: String(servicePoint),
      calledAt: new Date().toLocaleTimeString('th-TH'),
      queueNo: displayNo,
      mode: qMode,
      department
    }
    saveTodayCalls(calls)

    const queueName = found.queue_name || ''

    // Respond and broadcast queue number immediately — don't wait for TTS
    broadcast({ type: 'queue:called', data: { queueNo: displayNo, servicePoint: String(servicePoint), audioUrl: null, displayConfigId: displayConfigId || null, queueName, department } })
    res.json({ success: true, queueNo: displayNo, queueSlot: found.queue_slot })

    // Log this call into queue_opd_qs_slot (Slot modes only) — fire-and-forget
    if (qMode === 'slot' || qMode === 'slot_cur') {
      recordQueueOpdQsSlotCall(settings, found.vn, found.queue_slot).catch(() => {})
    }

    // Generate TTS async in background, broadcast audio when ready
    try {
      const qdFile = displayConfigId ? qdConfigFile(displayConfigId) : QD_DEFAULT_FILE
      const qdCfg = fs.existsSync(qdFile)
        ? JSON.parse(fs.readFileSync(qdFile, 'utf-8'))
        : (fs.existsSync(QD_DEFAULT_FILE) ? JSON.parse(fs.readFileSync(QD_DEFAULT_FILE, 'utf-8')) : null)
      if (qdCfg && qdCfg.ttsEnabled && qdCfg.ttsSource === 'server') {
        // เมื่อเปิดประกาศชื่อ: อ่านชื่อเต็ม (fname + lname) ตามที่ตั้งค่าในจอแสดงผล
        const ttsName = queueName || ''
        const text = (qdCfg.ttsShowName === true) && ttsName
          ? [qdCfg.ttsPrefix1, ttsName, qdCfg.ttsMiddle, String(servicePoint), qdCfg.ttsSuffix].filter(Boolean).join(' ')
          : [qdCfg.ttsPrefix1, formatQueueNoForTTS(displayNo), qdCfg.ttsMiddle, String(servicePoint), qdCfg.ttsSuffix].filter(Boolean).join(' ')
        const voiceName = qdCfg.ttsServerVoiceName || qdCfg.ttsVoiceName || ''
        // HOST audio — only when Pattara installed AND configured voice is SAPI (not Google/Edge)
        // Google/Edge TTS already broadcasts to display via WebSocket — playing Pattara on top creates double audio
        const isNetworkTtsVoice = EDGE_VOICES.some(v => v.name === voiceName) || GOOGLE_VOICES.some(v => v.name === voiceName) || !voiceName
        if (_hostAudioEnabled && !isNetworkTtsVoice) {
          generateSAPITTS(text, 'Microsoft Pattara', qdCfg.ttsRate ?? 1)
            .then(audioUrl => playAudioOnHost(path.join(TTS_CACHE_DIR, path.basename(audioUrl))))
            .catch(() => {})
        }
        const doBroadcastAndPrewarm = (audioUrl) => {
          broadcast({ type: 'queue:audio', data: { audioUrl, displayConfigId: displayConfigId || null, department, servicePoint: String(servicePoint), queueNo: displayNo } })
          try {
            const isNetworkVoice = EDGE_VOICES.some(v => v.name === voiceName) || GOOGLE_VOICES.some(v => v.name === voiceName) || !voiceName
            const prewarmEdgeVoice = isNetworkVoice ? (voiceName || 'th-TH-AcharaNeural') : null
            if (prewarmEdgeVoice) {
              const currentCalls = getTodayCalls()
              const waitingNext = rows
                .filter(r => {
                  if (r.vn === found.vn) return false
                  const c = getCallFor(currentCalls, r.vn, r.queue_slot)
                  return !c || c.status === 'waiting'
                })
                .slice(0, 3)
              const allSPs = loadServicePoints().map(sp => sp.id)
              // Iterate in REVERSE so unshift produces correct order at queue front.
              // Each unshift inserts at [0], so the last-inserted item ends up first.
              // Reverse order: last inserted = waitingNext[0] × allSPs[0] = next queue, first SP → position 0 ✓
              for (let ni = waitingNext.length - 1; ni >= 0; ni--) {
                const next = waitingNext[ni]
                const nextNo = next.queue_slot || (next.queue_no != null ? String(next.queue_no) : '')
                const nextName = next.queue_name || ''
                for (let si = allSPs.length - 1; si >= 0; si--) {
                  const sp = allSPs[si]
                  const nextText = (qdCfg.ttsShowName === true) && nextName
                    ? [qdCfg.ttsPrefix1, nextName, qdCfg.ttsMiddle, String(sp), qdCfg.ttsSuffix].filter(Boolean).join(' ')
                    : [qdCfg.ttsPrefix1, formatQueueNoForTTS(nextNo), qdCfg.ttsMiddle, String(sp), qdCfg.ttsSuffix].filter(Boolean).join(' ')
                  enqueuePrewarm(nextText, prewarmEdgeVoice, qdCfg.ttsRate ?? 1, `post-call sp=${sp} q=${nextNo}`, true)
                }
              }
            }
          } catch {}
        }
        generateServerTTS(text, voiceName, qdCfg.ttsRate ?? 1)
          .then(audioUrl => doBroadcastAndPrewarm(audioUrl))
          .catch(err => {
            // Edge timed out (4.5s) but background promise may still resolve.
            // If it does within 1s more, broadcast late — display's 5.5s fallback hasn't fired yet.
            console.warn('[TTS] server TTS failed:', err.message)
            const bgPromise = err.edgePromise
            if (bgPromise) {
              bgPromise.catch(() => {}) // suppress late unhandled rejection
              Promise.race([bgPromise, new Promise((_, r) => setTimeout(() => r(), 2500))])
                .then(audioUrl => { if (audioUrl) { console.log('[TTS] late broadcast'); doBroadcastAndPrewarm(audioUrl) } })
                .catch(() => {})
            }
          })
      }
    } catch (ttsErr) {
      console.error('[TTS config]', ttsErr.message)
    }
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// Returns queue entries filtered by status and optionally by mode
app.get('/api/queue/calls-today', (req, res) => {
  const calls = getTodayCalls()
  const modeFilter = req.query.mode || null
  const result = Object.entries(calls)
    .filter(([, v]) => {
      if (!v.calledAt) return false
      if (modeFilter === 'cur_dep') return v.mode === 'cur_dep'
      if (modeFilter === 'slot_cur') return v.mode === 'slot_cur'
      if (modeFilter) return !v.mode || (v.mode !== 'cur_dep' && v.mode !== 'slot_cur')
      return true
    })
    .map(([key, v]) => ({ vn: v.vn || key, ...v }))
  res.json(result)
})

app.post('/api/queue/status', (req, res) => {
  // Update status manually (done / skip / waiting / noshow)
  const { vn, status, queueNo, queueSlot, servicePoint } = req.body
  if (!vn || !status) return res.json({ success: false })
  const calls = getTodayCalls()
  const key = callsKey(vn, queueSlot)
  const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const existing = calls[key] || {}
  calls[key] = {
    ...existing,
    vn,
    status,
    // Fill in missing fields so display can show the entry
    calledAt: existing.calledAt || now,
    ...(queueNo && !existing.queueNo ? { queueNo } : {}),
    ...(servicePoint && !existing.servicePoint ? { servicePoint } : {}),
  }
  saveTodayCalls(calls)
  broadcast({ type: 'queue:status', data: { vn, status, ...calls[key] } })
  res.json({ success: true })
})

// ─── API: Display config broadcast ───────────────────────────────────────────

app.post('/api/display/config', (req, res) => {
  broadcast({ type: 'display:config', data: req.body })
  res.json({ success: true })
})

// ─── API: Clear display queues ────────────────────────────────────────────────

app.post('/api/display/clear', (req, res) => {
  const { displayConfigId } = req.body
  broadcast({ type: 'queue:clear', data: { displayConfigId: displayConfigId || null } })
  res.json({ success: true })
})

// ─── QD default config (persisted system default) ────────────────────────────

const QD_DEFAULT_FILE = path.join(DATA_DIR, 'qd-default-config.json')

app.get('/api/display/qd-default', (req, res) => {
  try {
    if (fs.existsSync(QD_DEFAULT_FILE))
      return res.json(JSON.parse(fs.readFileSync(QD_DEFAULT_FILE, 'utf-8')))
  } catch {}
  res.json(null)
})

app.post('/api/display/qd-default', (req, res) => {
  try {
    fs.writeFileSync(QD_DEFAULT_FILE, JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// ─── Per-display QD config (isolated per display ID) ─────────────────────────

function qdConfigFile(id) {
  return path.join(DATA_DIR, `qd-config-${id}.json`)
}

app.get('/api/display/qd-config/:id', (req, res) => {
  try {
    const f = qdConfigFile(req.params.id)
    if (fs.existsSync(f)) return res.json(JSON.parse(fs.readFileSync(f, 'utf-8')))
    // Fall back to global default if no per-display config yet
    if (fs.existsSync(QD_DEFAULT_FILE))
      return res.json(JSON.parse(fs.readFileSync(QD_DEFAULT_FILE, 'utf-8')))
  } catch {}
  res.json(null)
})

app.post('/api/display/qd-config/:id', (req, res) => {
  try {
    fs.writeFileSync(qdConfigFile(req.params.id), JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ success: true })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// ─── API: Display configs CRUD ────────────────────────────────────────────────

app.get('/api/display/configs', (req, res) => {
  res.json(loadDisplayConfigs())
})

app.get('/api/display/configs/:id', (req, res) => {
  const cfg = loadDisplayConfigs().find(c => c.id === req.params.id)
  if (!cfg) return res.status(404).json({ error: 'Not found' })
  res.json(cfg)
})

app.post('/api/display/configs', (req, res) => {
  const configs = loadDisplayConfigs()
  const item = { ...req.body, id: Date.now().toString() }
  configs.push(item)
  saveDisplayConfigs(configs)
  res.json({ success: true, data: item })
})

app.put('/api/display/configs/:id', (req, res) => {
  const configs = loadDisplayConfigs()
  const idx = configs.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.json({ success: false, message: 'ไม่พบข้อมูล' })
  configs[idx] = { ...req.body, id: req.params.id }
  saveDisplayConfigs(configs)
  res.json({ success: true })
})

app.delete('/api/display/configs/:id', (req, res) => {
  const configs = loadDisplayConfigs().filter(c => c.id !== req.params.id)
  saveDisplayConfigs(configs)
  res.json({ success: true })
})

// ─── API: Queue staging board ─────────────────────────────────────────────────

app.get('/api/queue-staging', (req, res) => {
  res.json(loadQueueStaging())
})

// Moves queues into one channel of a display (or out of the board when channel is null).
// A queue sits in at most one channel per display, so it's removed from the others first.
app.post('/api/queue-staging/move', (req, res) => {
  const { displayId, channel, keys } = req.body || {}
  if (!displayId || !Array.isArray(keys)) return res.status(400).json({ success: false, message: 'invalid request' })
  const staging = loadQueueStaging()
  const board = staging[displayId] || {}
  for (const ch of Object.keys(board)) {
    board[ch] = board[ch].filter(k => !keys.includes(k))
  }
  if (channel) {
    board[channel] = [...(board[channel] || []), ...keys.filter(k => !(board[channel] || []).includes(k))]
  }
  staging[displayId] = board
  saveQueueStaging(staging)
  res.json({ success: true })
})

// ─── API: System fonts ────────────────────────────────────────────────────────

app.get('/api/system/fonts', (req, res) => {
  const { exec } = require('child_process')
  exec(
    `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null; [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }"`,
    { timeout: 10000 },
    (err, stdout) => {
      if (err) {
        return res.json(['Arial', 'Tahoma', 'Sarabun', 'Prompt', 'Kanit', 'Angsana New', 'CordiaNew', 'TH SarabunPSK'])
      }
      const fonts = stdout.split('\n').map(f => f.trim()).filter(Boolean)
      res.json(fonts)
    }
  )
})

// ─── Service Points CRUD ──────────────────────────────────────────────────────

app.get('/api/service-points', (req, res) => {
  res.json(loadServicePoints())
})

app.post('/api/service-points', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.json({ success: false, message: 'กรุณาระบุชื่อช่องบริการ' })
  const data = loadServicePoints()
  const id = Date.now().toString()
  data.push({ id, name: name.trim() })
  saveServicePoints(data)
  res.json({ success: true, data: { id, name: name.trim() } })
})

app.put('/api/service-points/:id', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.json({ success: false, message: 'กรุณาระบุชื่อ' })
  const data = loadServicePoints()
  const idx = data.findIndex(sp => sp.id === req.params.id)
  if (idx === -1) return res.json({ success: false, message: 'ไม่พบช่องบริการ' })
  data[idx].name = name.trim()
  saveServicePoints(data)
  res.json({ success: true })
})

app.delete('/api/service-points/:id', (req, res) => {
  const data = loadServicePoints().filter(sp => sp.id !== req.params.id)
  saveServicePoints(data)
  res.json({ success: true })
})

// ─── Shortcut: download .url file ────────────────────────────────────────────
app.get('/api/shortcut/download', (req, res) => {
  try {
    const { name, url } = req.query
    if (!name || !url) return res.status(400).send('name and url required')
    const filename = `${name}.url`
    const content = `[InternetShortcut]\r\nURL=${url}\r\n`
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.send(content)
  } catch (e) {
    res.status(500).send(e.message)
  }
})

// ─── Shortcut: บันทึก .url ลง Desktop ของ HOST ──────────────────────────────
app.post('/api/shortcut/desktop', (req, res) => {
  try {
    const { name, url } = req.body
    if (!name || !url) return res.json({ success: false, message: 'name and url required' })
    const os = require('os')
    const desktop = path.join(os.homedir(), 'Desktop')
    const filename = `${name}.url`
    const content = `[InternetShortcut]\r\nURL=${url}\r\n`
    fs.writeFileSync(path.join(desktop, filename), content, 'utf-8')
    res.json({ success: true, filename })
  } catch (e) {
    res.json({ success: false, message: e.message })
  }
})

// ─── Server IP ───────────────────────────────────────────────────────────────
app.get('/api/server-ip', (req, res) => {
  const os = require('os')
  const nets = os.networkInterfaces()
  let ip = null
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) { ip = addr.address; break }
    }
    if (ip) break
  }
  res.json({ ip: ip || 'localhost', port: PORT })
})

app.get('/api/open-mini', (req, res) => {
  // global.openMiniWindow() opens a native BrowserWindow on THIS machine's own desktop — it can
  // never appear on a different device's screen. A client on another PC/tablet reaching this
  // server over the network (not localhost) would otherwise get told "opened" while the actual
  // window pops up, invisible, back on the server machine. Only try it for local requests; every
  // other client just renders the Mini UI directly in its own tab (the normal fallback below).
  const ip = req.ip || req.socket.remoteAddress || ''
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  if (isLocal && typeof global.openMiniWindow === 'function') {
    global.openMiniWindow()
    res.json({ success: true })
  } else {
    res.json({ success: false, message: isLocal ? 'browser-mode' : 'remote-client' })
  }
})

// Fallback: serve index.html for SPA routing (Express 4 & 5 compatible)
app.use((req, res) => serveIndexWithToken(req, res))

// ─── WebSocket ────────────────────────────────────────────────────────────────

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const clients = new Set()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('error', () => clients.delete(ws))
})

function broadcast(data) {
  const msg = JSON.stringify(data)
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg)
    }
  }
}

// ─── Midnight reset ───────────────────────────────────────────────────────────

function scheduleMidnightReset() {
  const now = new Date()
  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 0)
  const delay = nextMidnight - now

  setTimeout(() => {
    try {
      saveTodayCalls({})
      console.log(`[Midnight Reset] ${new Date().toLocaleString('th-TH')} — cleared queue-calls-today.json`)
    } catch (e) {
      console.error('[Midnight Reset] Error:', e.message)
    }
    scheduleMidnightReset()
  }, delay)

  console.log(`[Midnight Reset] Scheduled in ${Math.round(delay / 1000)}s (${nextMidnight.toLocaleString('th-TH')})`)
}

// ─── Start ────────────────────────────────────────────────────────────────────

function startServer() {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} ถูกใช้งานอยู่แล้ว กรุณาปิดโปรแกรมอื่นหรือเปลี่ยน PORT\n`)
    } else {
      console.error('Server error:', e.message)
    }
    process.exit(1)
  })

  server.listen(PORT, () => {
    console.log(`\n  Queue OPD Server`)
    console.log(`  ─────────────────────────────────`)
    console.log(`  ➜  Local:   http://localhost:${PORT}`)
    console.log(`  ─────────────────────────────────\n`)
    scheduleMidnightReset()
  })

  return server
}

// Server-side background prewarm — runs on startup and every 15s
// Generates Edge TTS for top 5 waiting queues × all service points using EACH display's TTS config.
// Prewarms per-display configs so actual calls always hit the cache (no delay from Edge round-trip).
async function runServerSidePrewarm() {
  try {
    // Prefer per-display configs over the default — per-display configs have the actual text templates
    // used by live calls. Default config may differ and would generate audio that's never played.
    const dataDir = path.dirname(QD_DEFAULT_FILE)
    const perDisplayFiles = []
    try {
      fs.readdirSync(dataDir)
        .filter(f => f.startsWith('qd-config-') && f.endsWith('.json'))
        .forEach(f => perDisplayFiles.push(path.join(dataDir, f)))
    } catch {}
    const configFiles = perDisplayFiles.length > 0 ? perDisplayFiles : [QD_DEFAULT_FILE]

    // Build unique TTS configs (deduplicate by text template + voice)
    const seenKeys = new Set()
    const configs = []
    for (const file of configFiles) {
      try {
        const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null
        if (!cfg || !cfg.ttsEnabled || cfg.ttsSource !== 'server') continue
        const voiceName = cfg.ttsServerVoiceName || cfg.ttsVoiceName || ''
        const isNetworkVoice = EDGE_VOICES.some(v => v.name === voiceName) || GOOGLE_VOICES.some(v => v.name === voiceName) || !voiceName
        if (!isNetworkVoice) continue // skip SAPI-only configs
        const key = `${voiceName}|${cfg.ttsRate ?? 1}|${cfg.ttsPrefix1}|${cfg.ttsMiddle}|${cfg.ttsSuffix}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        configs.push({ cfg, edgeVoice: voiceName || 'th-TH-AcharaNeural', rate: cfg.ttsRate ?? 1 })
      } catch {}
    }
    if (configs.length === 0) return

    const settings = loadSettings()
    if (!settings) return
    const { mysql, pg } = getSQLByMode('slot')
    const today = getTodayDate()
    const rows = await queryDB(settings, mysql, pg, [today])
    const currentCalls = getTodayCalls()
    const waiting = rows
      .filter(r => {
        const c = getCallFor(currentCalls, r.vn, r.queue_slot)
        return !c || c.status === 'waiting'
      })
      .slice(0, 5)
    if (waiting.length === 0) return
    const allSPs = loadServicePoints().map(sp => sp.id)

    // Interleave: cover each queue×SP for ALL configs before moving to next queue.
    // This ensures every upcoming call is cached regardless of which display config is active.
    for (const q of waiting) {
      const qNo = q.queue_slot || (q.queue_no != null ? String(q.queue_no) : '')
      const qName = q.queue_name || ''
      for (const sp of allSPs) {
        for (const { cfg, edgeVoice, rate } of configs) {
          const text = (cfg.ttsShowName === true) && qName
            ? [cfg.ttsPrefix1, qName, cfg.ttsMiddle, String(sp), cfg.ttsSuffix].filter(Boolean).join(' ')
            : [cfg.ttsPrefix1, formatQueueNoForTTS(qNo), cfg.ttsMiddle, String(sp), cfg.ttsSuffix].filter(Boolean).join(' ')
          enqueuePrewarm(text, edgeVoice, rate, `server sp=${sp} q=${qNo}`)
        }
      }
    }
  } catch {} // DB might not be connected yet on startup — silently skip
}

// Initial prewarm 5s after startup (gives DB time to connect), then every 15s
setTimeout(() => runServerSidePrewarm(), 5000)
setInterval(() => runServerSidePrewarm(), 15000)

if (require.main === module) {
  startServer()
  // Auto-open browser only in standalone (non-Electron) mode
  const open = { win32: 'start', darwin: 'open', linux: 'xdg-open' }[process.platform] || 'start'
  exec(`${open} http://localhost:${PORT}`)
}

module.exports = { startServer }
