'use strict'
/**
 * Pre-generate TTS audio files matching THIS deployment's actual display configs
 * (data/qd-config-*.json + qd-default-config.json), so the installer ships a cache
 * that can actually be hit at runtime instead of a generic one that never matches.
 * Output goes to build/tts-cache/ which is bundled into the installer.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
if (!globalThis.crypto) globalThis.crypto = require('crypto').webcrypto // msedge-tts needs Web Crypto
const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')

const DATA_DIR = path.join(__dirname, '..', 'data')
const OUT_DIR = path.join(__dirname, '..', 'build', 'tts-cache')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

// Mirrors server/index.js formatQueueNoForTTS exactly — must stay in sync.
function formatQueueNoForTTS(queueNo) {
  if (!queueNo) return queueNo
  const s = String(queueNo)
  const match = s.match(/^([A-Za-z\-]*)(\d+)$/)
  if (!match) return s
  const prefix = match[1].replace(/-/g, '')
  const digits = match[2].split('').join(' ')
  const spelled = prefix.split('').join(' ')
  return [spelled, digits].filter(Boolean).join(' ')
}

// Mirrors server/index.js's EDGE_VOICES/GOOGLE_VOICES lists — must stay in sync.
const EDGE_VOICE_NAMES = new Set([
  'th-TH-PremwadeeNeural', 'th-TH-AcharaNeural', 'th-TH-NiwatNeural',
  'en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-MichelleNeural', 'en-GB-SoniaNeural', 'en-US-GuyNeural'
])

// SAPI voices are host-local (no network call) — can't be pre-baked here; they warm up
// at runtime via the existing SAPI generation path in server/index.js.
function voiceKind(voiceName) {
  if (/google/i.test(voiceName || '')) return 'google'
  if (EDGE_VOICE_NAMES.has(voiceName)) return 'edge'
  return 'sapi'
}

function cacheKey(voice, rate, text) {
  return crypto.createHash('md5').update(`${voice}_${String(rate)}_${text}`).digest('hex')
}

function loadQdConfigs() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /^qd-(config-.+|default-config)\.json$/.test(f))
  const configs = []
  for (const f of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'))
      if (cfg.ttsEnabled && cfg.ttsSource === 'server') configs.push(cfg)
    } catch {}
  }
  return configs
}

// Real service-point / channel labels actually in use across configs, plus a safe fallback range.
function channelsFor(cfg) {
  const ch = Array.isArray(cfg.displayChannels) && cfg.displayChannels.length ? cfg.displayChannels : ['1', '2', '3', '4']
  return [...new Set(ch.map(String))]
}

// Observed real queue-number prefixes in this deployment (DA/DC/NA/OA/GP) plus plain numeric slots.
const QUEUE_PREFIXES = ['DA', 'DC', 'NA', 'OA', 'GP', '']
const QUEUE_NUMBER_MAX = 30

function buildQueueNumbers() {
  const nums = []
  for (const prefix of QUEUE_PREFIXES) {
    for (let i = 1; i <= QUEUE_NUMBER_MAX; i++) {
      nums.push(`${prefix}${String(i).padStart(3, '0')}`)
    }
  }
  return nums
}

function fetchGoogleTTS(text, rate, destPath) {
  return new Promise((resolve, reject) => {
    const speed = Math.min(1.0, Math.max(0.1, parseFloat(rate) || 1))
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=th&client=tw-ob&ttsspeed=${speed}`
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return fetchGoogleTTS(text, rate, destPath).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const ws = fs.createWriteStream(destPath)
      res.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function fetchEdgeTTS(text, voiceName, rate, destPath) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  const prosody = new ProsodyOptions()
  prosody.rate = Number(rate)
  const { audioStream } = tts.toStream(text, prosody)
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath)
    audioStream.pipe(ws)
    ws.on('finish', resolve)
    ws.on('error', reject)
    audioStream.on('error', reject)
  })
}

async function run() {
  const configs = loadQdConfigs()
  if (configs.length === 0) {
    console.warn('[prebuild-tts] No server-TTS display configs found in data/ — nothing to do.')
    return
  }

  const queueNumbers = buildQueueNumbers()
  const jobs = new Map() // cacheKey -> { kind, voice, rate, text }
  let sapiConfigsSkipped = 0

  for (const cfg of configs) {
    const voice = cfg.ttsServerVoiceName || cfg.ttsVoiceName || ''
    const kind = voiceKind(voice)
    if (kind === 'sapi') { sapiConfigsSkipped++; continue } // host-local, warms up at runtime instead
    const rate = cfg.ttsRate ?? 1
    for (const q of queueNumbers) {
      for (const ch of channelsFor(cfg)) {
        const text = [cfg.ttsPrefix1, formatQueueNoForTTS(q), cfg.ttsMiddle, ch, cfg.ttsSuffix].filter(Boolean).join(' ')
        const key = cacheKey(voice, rate, text)
        if (!jobs.has(key)) jobs.set(key, { kind, voice, rate, text })
      }
    }
  }

  const all = [...jobs.values()]
  let done = 0, skipped = 0, errors = 0
  console.log(`[prebuild-tts] ${configs.length} server-TTS config(s) found (${sapiConfigsSkipped} SAPI skipped). Generating up to ${all.length} matching TTS files...`)

  for (const { kind, voice, rate, text } of all) {
    const key = cacheKey(voice, rate, text)
    const dest = path.join(OUT_DIR, `tts_${key}.mp3`)
    if (fs.existsSync(dest)) { skipped++; continue }
    try {
      if (kind === 'google') await fetchGoogleTTS(text, rate, dest)
      else await fetchEdgeTTS(text, voice, rate, dest)
      done++
      if (done % 50 === 0) console.log(`  [${done}/${all.length - skipped}] generated`)
      await new Promise(r => setTimeout(r, kind === 'google' ? 80 : 150))
    } catch (e) {
      errors++
      console.warn(`  WARN: ${text.slice(0, 40)} -> ${e.message}`)
    }
  }
  console.log(`[prebuild-tts] Done: ${done} new, ${skipped} cached, ${errors} errors`)
  console.log(`[prebuild-tts] Output: ${OUT_DIR}`)
}

run().catch(e => { console.error(e); process.exit(1) })
