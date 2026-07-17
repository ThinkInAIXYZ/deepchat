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
    html: 'src/renderer/index.html',
    entry: 'src/renderer/src/main.ts'
  },
  {
    id: 'browser-overlay',
    html: 'src/renderer/browser-overlay/index.html',
    entry: 'src/renderer/browser-overlay/main.ts'
  },
  {
    id: 'floating',
    html: 'src/renderer/floating/index.html',
    entry: 'src/renderer/floating/main.ts'
  },
  {
    id: 'splash',
    html: 'src/renderer/splash/index.html',
    entry: 'src/renderer/splash/main.ts'
  },
  {
    id: 'settings',
    html: 'src/renderer/settings/index.html',
    entry: 'src/renderer/settings/main.ts'
  }
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
const importPattern = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g

const collectSettingsToChatImports = async () => {
  const files = (await walk('src/renderer/settings')).filter(isSourceFile)
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

const main = async () => {
  const [settingsToChatImports, legacyBrowserDirectoryExists] = await Promise.all([
    collectSettingsToChatImports(),
    exists('src/renderer/browser')
  ])
  const appStatus = await Promise.all(
    apps.map(async (app) => ({
      ...app,
      htmlExists: await exists(app.html),
      entryExists: await exists(app.entry)
    }))
  )

  const report = {
    schemaVersion: 1,
    apps: appStatus,
    browser: {
      legacyDirectoryExists: legacyBrowserDirectoryExists,
      activeOverlayDirectory: 'src/renderer/browser-overlay'
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
