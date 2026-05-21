import {
  _electron as electron,
  chromium,
  test as base,
  type Browser,
  type Page,
  type TestInfo
} from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { arch } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(FIXTURE_DIR, '..', '..', '..')
const BUILT_MAIN_ENTRY = resolve(REPO_ROOT, 'out', 'main', 'index.js')
const BUILT_RENDERER_ENTRY = resolve(REPO_ROOT, 'out', 'renderer', 'index.html')
const WINDOWS_PACKAGED_EXECUTABLE = resolve(
  REPO_ROOT,
  'dist',
  arch() === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked',
  'DeepChat.exe'
)

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type WindowSource = {
  windows: () => Page[]
  on: (event: 'window', listener: (page: Page) => void) => void
  close: () => Promise<void>
}

const isMainAppWindow = async (page: Page): Promise<boolean> => {
  const url = page.url()
  if (
    url.includes('/renderer/index.html') &&
    !url.includes('/settings/index.html') &&
    !url.includes('/splash/index.html') &&
    !url.startsWith('devtools://')
  ) {
    return true
  }

  const title = await page.title().catch(() => '')
  return title === 'DeepChat'
}

const describeWindows = async (windows: Page[]): Promise<string> => {
  if (windows.length === 0) {
    return 'none'
  }

  const snapshots = await Promise.all(
    windows.map(async (page, index) => {
      const title = await page.title().catch(() => '<title unavailable>')
      return `#${index + 1} title="${title}" url="${page.url()}"`
    })
  )
  return snapshots.join('; ')
}

const waitForMainAppWindow = async (electronApp: WindowSource): Promise<Page> => {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const candidate of electronApp.windows()) {
      if (await isMainAppWindow(candidate)) {
        return candidate
      }
    }

    await delay(300)
  }

  throw new Error(
    `Main chat window did not become available within 30 seconds. Open windows: ${await describeWindows(electronApp.windows())}`
  )
}

export type ElectronAppInstance = {
  electronApp: WindowSource
  page: Page
  consoleLogs: string[]
  pageErrors: string[]
  close: () => Promise<void>
}

type ElectronFixtures = {
  app: ElectronAppInstance
  launchApp: () => Promise<ElectronAppInstance>
}

const resolvePackagedExecutable = (): string => {
  if (process.env.DEEPCHAT_E2E_EXECUTABLE_PATH) {
    return resolve(process.env.DEEPCHAT_E2E_EXECUTABLE_PATH)
  }

  if (process.platform === 'win32') {
    return WINDOWS_PACKAGED_EXECUTABLE
  }

  throw new Error(
    'DEEPCHAT_E2E_APP_MODE=packaged requires DEEPCHAT_E2E_EXECUTABLE_PATH on this platform.'
  )
}

const attachDiagnostics = async (
  testInfo: TestInfo,
  consoleLogs: string[],
  pageErrors: string[],
  processLogs: string[]
): Promise<void> => {
  await testInfo.attach('renderer-console.log', {
    body: Buffer.from(consoleLogs.length > 0 ? consoleLogs.join('\n') : 'No renderer console logs'),
    contentType: 'text/plain'
  })

  await testInfo.attach('renderer-errors.log', {
    body: Buffer.from(pageErrors.length > 0 ? pageErrors.join('\n') : 'No renderer page errors'),
    contentType: 'text/plain'
  })

  await testInfo.attach('app-process.log', {
    body: Buffer.from(processLogs.length > 0 ? processLogs.join('\n') : 'No app process logs'),
    contentType: 'text/plain'
  })
}

const ensureLaunchTargetExists = (): void => {
  if (process.env.DEEPCHAT_E2E_APP_MODE === 'packaged') {
    const executablePath = resolvePackagedExecutable()
    if (!existsSync(executablePath)) {
      throw new Error(`Packaged app executable not found at ${executablePath}.`)
    }
    return
  }

  if (!existsSync(BUILT_MAIN_ENTRY)) {
    throw new Error(
      `Built app entry not found at ${BUILT_MAIN_ENTRY}. Run "pnpm run build" before "pnpm run e2e:smoke".`
    )
  }

  if (!existsSync(BUILT_RENDERER_ENTRY)) {
    throw new Error(
      `Built renderer entry not found at ${BUILT_RENDERER_ENTRY}. Run "pnpm run build" before "pnpm run e2e:smoke".`
    )
  }
}

const getFreePort = async (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolvePort(address.port)
          return
        }

        reject(new Error('Failed to allocate a local CDP port.'))
      })
    })
  })

const waitForCdp = async (
  port: number,
  child: ChildProcessWithoutNullStreams,
  processLogs: string[]
): Promise<void> => {
  const deadline = Date.now() + 120_000
  let lastError = ''

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged app exited before CDP became available. exitCode=${child.exitCode}. Logs:\n${processLogs.join('\n')}`
      )
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(300)
  }

  throw new Error(
    `Timed out waiting for packaged app CDP on port ${port}. Last error: ${lastError}`
  )
}

const terminateProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.killed) {
    return
  }

  await new Promise<void>((resolveTerminate) => {
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timeout)
      resolveTerminate()
    }
    timeout = setTimeout(finish, 5_000)
    timeout.unref()
    child.once('exit', finish)

    if (process.platform === 'win32' && child.pid) {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'])
      taskkill.once('close', () => {
        if (child.exitCode === null && !child.killed) {
          child.kill()
        }
      })
      return
    }

    child.kill()
  })
}

class CdpElectronApp implements WindowSource {
  private readonly browser: Browser
  private readonly child: ChildProcessWithoutNullStreams
  private closed = false

  constructor(browser: Browser, child: ChildProcessWithoutNullStreams) {
    this.browser = browser
    this.child = child
  }

  windows(): Page[] {
    return this.browser.contexts().flatMap((context) => context.pages())
  }

  on(event: 'window', listener: (page: Page) => void): void {
    if (event !== 'window') {
      return
    }

    for (const context of this.browser.contexts()) {
      context.on('page', listener)
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true
    await this.browser.close().catch(() => undefined)
    await terminateProcess(this.child)
  }
}

const launchPackagedAppWithCdp = async (
  processLogs: string[],
  currentLaunch: number
): Promise<WindowSource> => {
  const executablePath = resolvePackagedExecutable()
  const port = await getFreePort()
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    cwd: REPO_ROOT,
    env: process.env
  })

  child.stdout.on('data', (chunk) => {
    processLogs.push(`[process-${currentLaunch}][stdout] ${String(chunk).trimEnd()}`)
  })
  child.stderr.on('data', (chunk) => {
    processLogs.push(`[process-${currentLaunch}][stderr] ${String(chunk).trimEnd()}`)
  })
  child.on('error', (error) => {
    processLogs.push(`[process-${currentLaunch}][error] ${error.message}`)
  })
  child.on('exit', (exitCode, signal) => {
    processLogs.push(`[process-${currentLaunch}][exit] code=${exitCode} signal=${signal}`)
  })

  try {
    await waitForCdp(port, child, processLogs)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    return new CdpElectronApp(browser, child)
  } catch (error) {
    await terminateProcess(child)
    throw error
  }
}

export const test = base.extend<ElectronFixtures>({
  launchApp: async ({}, use, testInfo) => {
    ensureLaunchTargetExists()

    const consoleLogs: string[] = []
    const pageErrors: string[] = []
    const processLogs: string[] = []
    const attachedPages = new WeakSet<Page>()
    const launchedApps = new Set<ElectronAppInstance>()
    let launchCount = 0

    const attachPageListeners = (page: Page, label: string) => {
      if (attachedPages.has(page)) {
        return
      }

      attachedPages.add(page)

      page.on('console', (message) => {
        consoleLogs.push(`[${label}][console:${message.type()}] ${message.text()}`)
      })

      page.on('pageerror', (error) => {
        pageErrors.push(`[${label}][pageerror] ${error.message}`)
      })
    }

    const launchApp = async (): Promise<ElectronAppInstance> => {
      launchCount += 1
      const currentLaunch = launchCount
      const packaged = process.env.DEEPCHAT_E2E_APP_MODE === 'packaged'

      const electronApp: WindowSource = packaged
        ? await launchPackagedAppWithCdp(processLogs, currentLaunch)
        : await electron.launch({
            args: ['.'],
            cwd: REPO_ROOT,
            env: process.env,
            timeout: 120_000
          })

      let closed = false
      const app: ElectronAppInstance = {
        electronApp,
        page: undefined as unknown as Page,
        consoleLogs,
        pageErrors,
        close: async () => {
          if (closed) {
            return
          }

          closed = true
          launchedApps.delete(app)
          await electronApp.close().catch(() => undefined)
        }
      }

      launchedApps.add(app)

      electronApp.on('window', (page) => {
        attachPageListeners(page, `window-${currentLaunch}`)
      })

      try {
        const page = await waitForMainAppWindow(electronApp)
        attachPageListeners(page, `main-${currentLaunch}`)
        await page.waitForLoadState('domcontentloaded')
        app.page = page
        return app
      } catch (error) {
        await app.close()
        throw error
      }
    }

    try {
      await use(launchApp)
    } finally {
      const pendingApps = [...launchedApps].reverse()
      for (const app of pendingApps) {
        await app.close()
      }

      await attachDiagnostics(testInfo, consoleLogs, pageErrors, processLogs)
    }
  },

  app: async ({ launchApp }, use) => {
    const app = await launchApp()
    try {
      await use(app)
    } finally {
      await app.close()
    }
  }
})

export { expect } from '@playwright/test'
