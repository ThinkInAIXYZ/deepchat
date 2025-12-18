import { session, type Session } from 'electron'

export const YO_BROWSER_PARTITION = 'persist:yo-browser'

let cachedSession: Session | null = null

function buildYoBrowserUserAgent(): string {
  if (process.platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }
  if (process.platform === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
}

function configureYoBrowserSession(target: Session): void {
  target.setPermissionRequestHandler((webContents, permission, callback) => {
    const requestedUrl = webContents.getURL?.() ?? ''
    console.warn(`[YoBrowser][Session] Denying permission '${permission}' for ${requestedUrl}`)
    callback(false)
  })

  const userAgent = buildYoBrowserUserAgent()
  target.setUserAgent(userAgent)
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      cancel: false,
      requestHeaders: {
        ...details.requestHeaders,
        'User-Agent': userAgent
      }
    })
  })
}

export function getYoBrowserSession(): Session {
  if (cachedSession) return cachedSession

  cachedSession = session.fromPartition(YO_BROWSER_PARTITION)
  configureYoBrowserSession(cachedSession)
  return cachedSession
}

export async function clearYoBrowserSessionData(): Promise<void> {
  const targetSession = getYoBrowserSession()
  await Promise.all([
    targetSession.clearCache(),
    targetSession.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'serviceworkers',
        'websql',
        'cachestorage'
      ]
    })
  ])
}
