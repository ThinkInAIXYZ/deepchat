import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@playwright/test'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(FIXTURE_DIR, '..', '..', '..')
const BUILT_MAIN_ENTRY = resolve(REPO_ROOT, 'out', 'main', 'index.js')

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

const waitForMainAppWindow = async (electronApp: ElectronApplication): Promise<Page> => {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const candidate of electronApp.windows()) {
      if (await isMainAppWindow(candidate)) {
        return candidate
      }
    }

    await delay(300)
  }

  throw new Error('Main chat window did not become available within 30 seconds.')
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
}

const ensureBuiltAppExists = (): void => {
  if (!existsSync(BUILT_MAIN_ENTRY)) {
    throw new Error(
      `Built app entry not found at ${BUILT_MAIN_ENTRY}. Run "pnpm run build" before "pnpm run e2e:smoke".`
    )
  }
}

export const test = base.extend<ElectronFixtures>({
  launchApp: async ({}, use, testInfo) => {
    ensureBuiltAppExists()

    const consoleLogs: string[] = []
    const pageErrors: string[] = []
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

      const electronApp = await electron.launch({
        args: ['.'],
        cwd: REPO_ROOT,
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
