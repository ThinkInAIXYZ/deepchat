import { session, WebContentsView, type CookiesSetDetails, type Session } from 'electron'

export const YO_BROWSER_PARTITION = 'persist:yo-browser'

let cachedSession: Session | null = null

function buildYoBrowserUserAgent(): string {
  const chromeVersion = process.versions.chrome ?? '0.0.0.0'
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
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

type DevToolsCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number | null
  httpOnly: boolean
  secure: boolean
  session: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: unknown
  partitionKeyOpaque?: boolean
}

function toElectronCookie(cookie: DevToolsCookie): CookiesSetDetails {
  const path = cookie.path || '/'
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${path}`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite:
      cookie.sameSite === 'Strict'
        ? 'strict'
        : cookie.sameSite === 'Lax'
          ? 'lax'
          : cookie.sameSite === 'None'
            ? 'no_restriction'
            : 'unspecified',
    ...(cookie.session || cookie.expires === null || cookie.expires < 0
      ? {}
      : { expirationDate: cookie.expires })
  }
}

export async function getYoBrowserUnpartitionedCookies(): Promise<CookiesSetDetails[]> {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      session: getYoBrowserSession()
    }
  })
  const debugSession = view.webContents.debugger

  try {
    debugSession.attach('1.3')
    const response = (await debugSession.sendCommand('Storage.getCookies')) as {
      cookies?: DevToolsCookie[]
    }
    return (response.cookies ?? [])
      .filter((cookie) => !cookie.partitionKey && !cookie.partitionKeyOpaque)
      .map(toElectronCookie)
  } finally {
    if (debugSession.isAttached()) debugSession.detach()
    view.webContents.close()
  }
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
