import { app, Tray, Menu, nativeImage, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import type { Rectangle } from 'electron'
import type { Server } from 'http'

const PORT = process.env.PORT || 3200
let tray: Tray | null = null
let httpServer: Server | null = null
let miniWin: BrowserWindow | null = null
let miniNormalBounds: Rectangle | null = null

const MINI_DEFAULT_SIZE = { width: 320, height: 580 }
const MINI_ICON_SIZE = 80
const MINI_ICON_MARGIN = 20

function openMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.restore()
    miniWin.focus()
    return
  }
  miniWin = new BrowserWindow({
    width: MINI_DEFAULT_SIZE.width,
    height: MINI_DEFAULT_SIZE.height,
    alwaysOnTop: true,
    minimizable: true,
    resizable: true,
    title: 'เรียกคิว Mini',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js')
    }
  })
  miniWin.loadURL(`http://localhost:${PORT}/#/queue-mini?electron=1`)
  // ป้องกันย่อตัวเอง: restore ทันทีเมื่อ minimize
  miniWin.on('minimize', () => { miniWin?.restore() })
  miniWin.on('closed', () => { miniWin = null; miniNormalBounds = null })
}

// Shrink the Mini window down to a small always-on-top icon parked in a screen corner, so it
// no longer covers the work the user is doing in other apps. Restoring puts it back exactly
// where/how big it was (the user may have resized/moved it before shrinking).
function shrinkMiniWindow() {
  if (!miniWin || miniWin.isDestroyed()) return
  miniNormalBounds = miniWin.getBounds()
  const { workArea } = screen.getDisplayMatching(miniNormalBounds)
  miniWin.setResizable(true)
  miniWin.setBounds({
    x: workArea.x + workArea.width - MINI_ICON_SIZE - MINI_ICON_MARGIN,
    y: workArea.y + workArea.height - MINI_ICON_SIZE - MINI_ICON_MARGIN,
    width: MINI_ICON_SIZE,
    height: MINI_ICON_SIZE
  })
  miniWin.setResizable(false)
}

function restoreMiniWindow() {
  if (!miniWin || miniWin.isDestroyed()) return
  miniWin.setResizable(true)
  miniWin.setBounds(miniNormalBounds || { x: 0, y: 0, ...MINI_DEFAULT_SIZE })
  miniNormalBounds = null
  miniWin.focus()
}

ipcMain.handle('mini:minimize', () => shrinkMiniWindow())
ipcMain.handle('mini:restore', () => restoreMiniWindow())

// Expose to Express server (runs in same process)
;(global as Record<string, unknown>).openMiniWindow = openMiniWindow

// Single instance — second launch just opens browser
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  shell.openExternal(`http://localhost:${PORT}`)
})

app.whenReady().then(() => {
  app.setAppUserModelId('Queue System OPD')

  // Writable data dir (survives reinstall)
  process.env.QUEUE_DATA_DIR = app.getPath('userData')

  if (app.isPackaged) {
    process.env.RENDERER_DIR = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'out',
      'renderer'
    )
  }

  const serverPath = app.isPackaged
    ? join(app.getAppPath(), 'server', 'index.js')
    : join(__dirname, '../../server/index.js')

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startServer } = require(serverPath) as { startServer: () => Server }
  httpServer = startServer()

  httpServer.once('listening', () => {
    shell.openExternal(`http://localhost:${PORT}`)
  })

  // System tray
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico')

  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Queue System OPD — กำลังทำงาน')

  const menu = Menu.buildFromTemplate([
    {
      label: 'เปิด Queue System OPD',
      click: () => shell.openExternal(`http://localhost:${PORT}`)
    },
    {
      label: 'เปิด Mini (ล็อกหน้าจอ)',
      click: () => openMiniWindow()
    },
    { type: 'separator' },
    {
      label: 'ออกจากโปรแกรม',
      click: () => {
        httpServer?.close()
        tray?.destroy()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => shell.openExternal(`http://localhost:${PORT}`))
})

// Keep running when all browser windows close
app.on('window-all-closed', () => { /* stay in tray */ })
