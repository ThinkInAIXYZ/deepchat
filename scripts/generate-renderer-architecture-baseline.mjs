import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const checkMode = process.argv.includes('--check')
const REPORT_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/renderer-application-boundaries-baseline.json'
)

const apps = [
  {
    id: 'chat-main',
    html: 'packages/desktop/src/renderer/index.html',
    entry: 'packages/desktop/src/renderer/src/main.ts'
  },
  {
    id: 'browser-overlay',
    html: 'packages/desktop/src/renderer/browser-overlay/index.html',
    entry: 'packages/desktop/src/renderer/browser-overlay/main.ts'
  },
  {
    id: 'floating',
    html: 'packages/desktop/src/renderer/floating/index.html',
    entry: 'packages/desktop/src/renderer/floating/main.ts'
  },
  {
    id: 'splash',
    html: 'packages/desktop/src/renderer/splash/index.html',
    entry: 'packages/desktop/src/renderer/splash/main.ts'
  },
  {
    id: 'settings',
    html: 'packages/desktop/src/renderer/settings/index.html',
    entry: 'packages/desktop/src/renderer/settings/main.ts'
  }
]

const sharedServices = [
  {
    id: 'notifications',
    root: 'packages/desktop/src/renderer/services/notifications'
  }
]

const appSourceRoots = [
  'packages/desktop/src/renderer/src',
  'packages/desktop/src/renderer/browser-overlay',
  'packages/desktop/src/renderer/floating',
  'packages/desktop/src/renderer/splash',
  'packages/desktop/src/renderer/settings'
]

const exists = async (relativePath) => {
  try {
    await fs.access(path.join(ROOT, relativePath))
    return true
  } catch {
    return false
  }
}

const walk = async (relativePath) => {
  const directory = path.join(ROOT, relativePath)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const childPath = path.join(relativePath, entry.name)
      if (entry.isDirectory()) return walk(childPath)
      return [childPath]
    })
  )
  return files.flat()
}

const isSourceFile = (file) => /\.(?:ts|tsx|vue|js|jsx)$/.test(file)
const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g

const collectSettingsToChatImports = async () => {
  const files = (await walk('packages/desktop/src/renderer/settings')).filter(isSourceFile)
  const imports = []

  for (const file of files) {
    const source = await fs.readFile(path.join(ROOT, file), 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2]
      if (specifier.startsWith('@/') || specifier.startsWith('../src/')) {
        imports.push({ file, specifier })
      }
    }
  }

  return imports.sort((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(`${right.file}:${right.specifier}`)
  )
}

const collectSharedServiceToAppImports = async () => {
  if (!(await exists('packages/desktop/src/renderer/services'))) return []

  const files = (await walk('packages/desktop/src/renderer/services')).filter(isSourceFile)
  const imports = []

  for (const file of files) {
    const source = await fs.readFile(path.join(ROOT, file), 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2]
      let target
      if (specifier.startsWith('@/')) {
        target = path.join('packages/desktop/src/renderer/src', specifier.slice(2))
      } else if (specifier.startsWith('.')) {
        target = path.normalize(path.join(path.dirname(file), specifier))
      }

      if (
        target &&
        appSourceRoots.some((root) => target === root || target.startsWith(`${root}/`))
      ) {
        imports.push({ file, specifier, target })
      }
    }
  }

  return imports.sort((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(`${right.file}:${right.specifier}`)
  )
}

const main = async () => {
  const [settingsToChatImports, sharedServiceToAppImports, legacyBrowserDirectoryExists] =
    await Promise.all([
      collectSettingsToChatImports(),
      collectSharedServiceToAppImports(),
      exists('packages/desktop/src/renderer/browser')
    ])
  const appStatus = await Promise.all(
    apps.map(async (app) => ({
      ...app,
      htmlExists: await exists(app.html),
      entryExists: await exists(app.entry)
    }))
  )
  const sharedServiceStatus = await Promise.all(
    sharedServices.map(async (service) => ({
      ...service,
      rootExists: await exists(service.root)
    }))
  )

  const report = {
    schemaVersion: 2,
    apps: appStatus,
    sharedServices: sharedServiceStatus,
    sharedServiceToAppImports,
    sharedServiceToAppImportCount: sharedServiceToAppImports.length,
    browser: {
      legacyDirectoryExists: legacyBrowserDirectoryExists,
      activeOverlayDirectory: 'packages/desktop/src/renderer/browser-overlay'
    },
    settingsToChatAppImports: settingsToChatImports,
    settingsToChatAppImportCount: settingsToChatImports.length
  }

  const serializedReport = `${JSON.stringify(report, null, 2)}\n`

  if (checkMode) {
    const existingReport = await fs.readFile(REPORT_PATH, 'utf8').catch(() => null)
    if (existingReport !== serializedReport) {
      throw new Error(
        `renderer architecture baseline changed: ${path.relative(ROOT, REPORT_PATH)}. ` +
          'Run pnpm run architecture:renderer-baseline and review the diff.'
      )
    }
    console.info(
      `renderer architecture baseline is current (settings→chat imports: ${settingsToChatImports.length})`
    )
    return
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, serializedReport)
  console.info(
    `renderer architecture baseline written: ${path.relative(ROOT, REPORT_PATH)} ` +
      `(settings→chat imports: ${settingsToChatImports.length})`
  )
}

await main()
