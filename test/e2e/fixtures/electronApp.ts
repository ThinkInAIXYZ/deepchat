import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { arch, homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GUIDED_ONBOARDING_REQUIRED_STEP_IDS,
  GUIDED_ONBOARDING_STEP_IDS,
  GUIDED_ONBOARDING_VERSION
} from '../../../src/shared/guidedOnboarding'

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
const MAX_MAIN_LOG_ATTACHMENT_BYTES = 512 * 1024

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isMainAppWindow = async (page: Page): Promise<boolean> => {
  const url = page.url()
  if (
    url.startsWith('devtools://') ||
    url.includes('/settings/index.html') ||
    url.includes('/splash/index.html') ||
    url.includes('/floating/index.html') ||
    url.includes('/browser-overlay/index.html') ||
    url.includes('/plugin-settings/index.html')
  ) {
    return false
  }

  if (
    url.includes('/renderer/index.html') ||
    (url.includes('/renderer/') && url.endsWith('/index.html')) ||
    url.endsWith('/renderer/index.html')
  ) {
    return true
  }

  const title = await page.title().catch(() => '')
  return title === 'DeepChat' && !url.includes('/renderer/')
}

const waitForMainAppWindow = async (electronApp: ElectronApplication): Promise<Page> => {
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    for (const candidate of electronApp.windows()) {
      if (await isMainAppWindow(candidate)) {
        return candidate
      }
    }

    await delay(300)
  }

  throw new Error('Main chat window did not become available within 60 seconds.')
}

export type ElectronAppInstance = {
  electronApp: ElectronApplication
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
  pageErrors: string[]
): Promise<void> => {
  await testInfo.attach('renderer-console.log', {
    body: Buffer.from(consoleLogs.length > 0 ? consoleLogs.join('\n') : 'No renderer console logs'),
    contentType: 'text/plain'
  })

  await testInfo.attach('renderer-errors.log', {
    body: Buffer.from(pageErrors.length > 0 ? pageErrors.join('\n') : 'No renderer page errors'),
    contentType: 'text/plain'
  })

  await testInfo.attach('main-process.log', {
    body: Buffer.from(readMainProcessLogs()),
    contentType: 'text/plain'
  })
}

const getDefaultUserDataDir = (): string => {
  if (process.env.DEEPCHAT_E2E_USER_DATA_DIR) {
    return resolve(process.env.DEEPCHAT_E2E_USER_DATA_DIR)
  }

  if (process.platform === 'win32') {
    return resolve(process.env.APPDATA ?? resolve(homedir(), 'AppData', 'Roaming'), 'DeepChat')
  }

  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', 'DeepChat')
  }

  return resolve(process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config'), 'DeepChat')
}

const readTextFileTail = (filePath: string): string => {
  const content = readFileSync(filePath)
  const start = Math.max(0, content.length - MAX_MAIN_LOG_ATTACHMENT_BYTES)
  const prefix =
    start > 0
      ? `[truncated first ${start} bytes, showing last ${MAX_MAIN_LOG_ATTACHMENT_BYTES} bytes]\n`
      : ''

  return `${prefix}${content.subarray(start).toString('utf8')}`
}

const readMainProcessLogs = (): string => {
  const logDir = resolve(getDefaultUserDataDir(), 'logs')
  if (!existsSync(logDir)) {
    return `No main process log directory found at ${logDir}`
  }

  const files = readdirSync(logDir)
    .map((fileName) => resolve(logDir, fileName))
    .filter((filePath) => {
      try {
        return statSync(filePath).isFile()
      } catch {
        return false
      }
    })
    .sort()

  if (files.length === 0) {
    return `No main process log files found at ${logDir}`
  }

  return files.map((filePath) => `== ${filePath} ==\n${readTextFileTail(filePath)}`).join('\n\n')
}

const seedE2eUserDataDir = (userDataDir: string): void => {
  mkdirSync(userDataDir, { recursive: true })

  const appSettingsPath = join(userDataDir, 'app-settings.json')
  if (existsSync(appSettingsPath)) {
    return
  }

  const now = Date.now()
  const requiredStepIds = new Set<string>(GUIDED_ONBOARDING_REQUIRED_STEP_IDS)
  writeFileSync(
    appSettingsPath,
    JSON.stringify(
      {
        init_complete: true,
        guidedOnboardingState: {
          version: GUIDED_ONBOARDING_VERSION,
          status: 'completed',
          startedAt: now,
          completedAt: now,
          lastActiveAt: now,
          currentStepId: null,
          steps: GUIDED_ONBOARDING_STEP_IDS.map((id) => ({
            id,
            required: requiredStepIds.has(id),
            status: 'completed',
            startedAt: now,
            completedAt: now,
            skippedAt: null
          }))
        }
      },
      null,
      2
    ),
    'utf-8'
  )
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

export const test = base.extend<ElectronFixtures>({
  launchApp: async ({}, use, testInfo) => {
    ensureLaunchTargetExists()

    const consoleLogs: string[] = []
    const pageErrors: string[] = []
    const attachedPages = new WeakSet<Page>()
    const launchedApps = new Set<ElectronAppInstance>()
    let launchCount = 0
    const originalE2eUserDataDir = process.env.DEEPCHAT_E2E_USER_DATA_DIR
    const userDataDir =
      originalE2eUserDataDir ?? mkdtempSync(join(tmpdir(), 'deepchat-e2e-user-data-'))
    const ownsUserDataDir = !originalE2eUserDataDir
    seedE2eUserDataDir(userDataDir)
    process.env.DEEPCHAT_E2E_USER_DATA_DIR = userDataDir

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

      const electronApp = await electron.launch({
        ...(packaged
          ? {
              executablePath: resolvePackagedExecutable(),
              args: []
            }
          : {
              args: ['.']
            }),
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DEEPCHAT_E2E_USER_DATA_DIR: userDataDir
        },
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

      await attachDiagnostics(testInfo, consoleLogs, pageErrors)

      if (originalE2eUserDataDir === undefined) {
        delete process.env.DEEPCHAT_E2E_USER_DATA_DIR
      } else {
        process.env.DEEPCHAT_E2E_USER_DATA_DIR = originalE2eUserDataDir
      }

      if (ownsUserDataDir) {
        rmSync(userDataDir, { recursive: true, force: true })
      }
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
