import path from 'path'
import fs from 'fs'
import os from 'os'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { app, nativeImage } from 'electron'
import {
  buildLaunchArgs,
  WORKSPACE_FILE_OPEN_APPS,
  type WorkspaceFileOpenAppDefinition
} from '@shared/workspace/fileOpenApps'
import type { WorkspaceFileOpenApp } from '@shared/types/workspace'

const execFileAsync = promisify(execFile)

const PROBE_TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 10_000
const ICON_POINT_SIZE = 32
/** Allows batched macOS icon data to exceed Node's 1 MiB exec buffer. */
const ICON_PROBE_MAX_BUFFER = 8 * 1024 * 1024
const INSTALLED_APPS_TTL_MS = 60_000

type InstalledApp = {
  definition: WorkspaceFileOpenAppDefinition
  launchTarget: string
  iconDataUrl?: string
}

let installedAppsCache: { probedAt: number; apps: Promise<InstalledApp[]> } | null = null
const handlerCache = new Map<string, Promise<Set<string>>>()

/**
 * Batch probing uses one subprocess; NSWorkspace avoids generic icons returned for `.app` bundles.
 */
const MACOS_PROBE_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const size = parseInt(argv[1], 10)
  const workspace = $.NSWorkspace.sharedWorkspace
  const result = {}

  for (const bundleId of JSON.parse(argv[0])) {
    const url = workspace.URLForApplicationWithBundleIdentifier(bundleId)
    if (!url || url.isNil()) {
      result[bundleId] = null
      continue
    }

    const appPath = ObjC.unwrap(url.path)
    let icon = null
    try {
      const image = workspace.iconForFile(appPath)
      if (image && !image.isNil()) {
        const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size))
        canvas.lockFocus
        image.drawInRect($.NSMakeRect(0, 0, size, size))
        canvas.unlockFocus
        const tiff = canvas.TIFFRepresentation
        if (tiff && !tiff.isNil()) {
          const rep = $.NSBitmapImageRep.imageRepWithData(tiff)
          const png = rep.representationUsingTypeProperties(4, $())
          icon = ObjC.unwrap(png.base64EncodedStringWithOptions(0))
        }
      }
    } catch (error) {
      icon = null
    }

    result[bundleId] = { path: appPath, icon: icon }
  }

  return JSON.stringify(result)
}`

const MACOS_HANDLERS_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const workspace = $.NSWorkspace.sharedWorkspace
  const bundleIds = []
  const candidates = workspace.URLsForApplicationsToOpenURL(url)
  if (candidates && !candidates.isNil()) {
    const total = candidates.count
    for (let index = 0; index < total; index += 1) {
      const bundle = $.NSBundle.bundleWithURL(candidates.objectAtIndex(index))
      const hasId = bundle && !bundle.isNil() && bundle.bundleIdentifier
      if (hasId && !bundle.bundleIdentifier.isNil()) {
        bundleIds.push(ObjC.unwrap(bundle.bundleIdentifier))
      }
    }
  }
  return JSON.stringify(bundleIds)
}`

async function detectMacOSInstalledApps(): Promise<InstalledApp[]> {
  const bundleIds = [
    ...new Set(WORKSPACE_FILE_OPEN_APPS.flatMap((definition) => definition.bundleIds ?? []))
  ]

  const { stdout } = await execFileAsync(
    'osascript',
    ['-l', 'JavaScript', '-e', MACOS_PROBE_SCRIPT, JSON.stringify(bundleIds), `${ICON_POINT_SIZE}`],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: ICON_PROBE_MAX_BUFFER }
  )

  const resolved = JSON.parse(stdout.trim()) as Record<
    string,
    { path: string; icon: string | null } | null
  >
  const installed: InstalledApp[] = []

  for (const definition of WORKSPACE_FILE_OPEN_APPS) {
    const match = definition.bundleIds
      ?.map((bundleId) => resolved[bundleId])
      .find((entry): entry is { path: string; icon: string | null } => Boolean(entry?.path))

    if (match) {
      installed.push({
        definition,
        launchTarget: match.path,
        iconDataUrl: match.icon ? `data:image/png;base64,${match.icon}` : undefined
      })
    }
  }

  return installed
}

async function readRegistryDefault(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], {
      timeout: PROBE_TIMEOUT_MS
    })
    const match = stdout.match(/\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
    return match?.[1]?.trim().replace(/^"|"$/g, '') || null
  } catch {
    return null
  }
}

/**
 * Prefer per-user App Paths and ignore PATH `.cmd` shims because spawn needs a real executable.
 */
async function resolveWindowsExecutable(executable: string): Promise<string | null> {
  const appPathsSuffix = `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`

  for (const root of ['HKCU', 'HKLM']) {
    const resolvedPath = await readRegistryDefault(`${root}\\${appPathsSuffix}`)
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return resolvedPath
    }
  }

  try {
    const { stdout } = await execFileAsync('where', [executable], { timeout: PROBE_TIMEOUT_MS })
    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith('.exe') && fs.existsSync(line))
    return candidate ?? null
  } catch {
    return null
  }
}

async function detectWindowsInstalledApps(): Promise<InstalledApp[]> {
  const results = await Promise.all(
    WORKSPACE_FILE_OPEN_APPS.map(async (definition) => {
      for (const executable of definition.executables ?? []) {
        const launchTarget = await resolveWindowsExecutable(executable)
        if (!launchTarget) {
          continue
        }

        const icon = await app.getFileIcon(launchTarget, { size: 'normal' }).catch(() => null)
        return {
          definition,
          launchTarget,
          iconDataUrl: icon && !icon.isEmpty() ? icon.toDataURL() : undefined
        }
      }

      return null
    })
  )

  return results.filter((entry): entry is InstalledApp => entry !== null)
}

function desktopEntryDirectories(): string[] {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean)
  return [dataHome, ...dataDirs].map((dir) => path.join(dir, 'applications'))
}

function findDesktopEntry(desktopId: string): string | null {
  for (const dir of desktopEntryDirectories()) {
    const candidate = path.join(dir, desktopId)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/** Themed icon names are unsupported; resolving them requires the active icon theme. */
function readLinuxDesktopIcon(entryPath: string): string | undefined {
  try {
    const content = fs.readFileSync(entryPath, 'utf-8')
    const iconValue = content.match(/^Icon=(.*)$/m)?.[1]?.trim()
    if (!iconValue?.startsWith('/')) {
      return undefined
    }

    const icon = nativeImage.createFromPath(iconValue)
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}

async function detectLinuxInstalledApps(): Promise<InstalledApp[]> {
  const installed: InstalledApp[] = []

  for (const definition of WORKSPACE_FILE_OPEN_APPS) {
    for (const desktopId of definition.desktopIds ?? []) {
      const entryPath = findDesktopEntry(desktopId)
      if (entryPath) {
        installed.push({
          definition,
          launchTarget: desktopId,
          iconDataUrl: readLinuxDesktopIcon(entryPath)
        })
        break
      }
    }
  }

  return installed
}

async function listInstalledApps(): Promise<InstalledApp[]> {
  if (installedAppsCache && Date.now() - installedAppsCache.probedAt < INSTALLED_APPS_TTL_MS) {
    return installedAppsCache.apps
  }

  const apps = (async () => {
    try {
      if (process.platform === 'darwin') {
        return await detectMacOSInstalledApps()
      }
      if (process.platform === 'win32') {
        return await detectWindowsInstalledApps()
      }
      return await detectLinuxInstalledApps()
    } catch (error) {
      console.warn('[Workspace] Failed to detect installed editors and terminals', error)
      installedAppsCache = null
      return []
    }
  })()

  installedAppsCache = { probedAt: Date.now(), apps }
  return apps
}

/** Handler detection only affects ordering; failures fall back to registry order. */
async function listRegisteredHandlerIds(filePath: string): Promise<Set<string>> {
  if (process.platform !== 'darwin') {
    return new Set()
  }

  const cacheKey = path.extname(filePath).toLowerCase() || path.basename(filePath).toLowerCase()
  const cached = handlerCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = (async () => {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', MACOS_HANDLERS_SCRIPT, filePath],
        { timeout: PROBE_TIMEOUT_MS }
      )

      const bundleIds = new Set(JSON.parse(stdout.trim()) as string[])
      return new Set(
        WORKSPACE_FILE_OPEN_APPS.filter((definition) =>
          definition.bundleIds?.some((bundleId) => bundleIds.has(bundleId))
        ).map((definition) => definition.id)
      )
    } catch (error) {
      console.warn(`[Workspace] Failed to read registered handlers for: ${filePath}`, error)
      handlerCache.delete(cacheKey)
      return new Set<string>()
    }
  })()

  handlerCache.set(cacheKey, pending)
  return pending
}

export async function listFileOpenApps(filePath: string): Promise<WorkspaceFileOpenApp[]> {
  const [installed, registeredIds] = await Promise.all([
    listInstalledApps(),
    listRegisteredHandlerIds(filePath)
  ])

  const toPayload = (entry: InstalledApp): WorkspaceFileOpenApp => ({
    id: entry.definition.id,
    name: entry.definition.name,
    kind: entry.definition.kind,
    iconDataUrl: entry.iconDataUrl
  })

  const editors = installed.filter((entry) => entry.definition.kind === 'editor')
  const terminals = installed.filter((entry) => entry.definition.kind === 'terminal')

  return [
    ...editors.filter((entry) => registeredIds.has(entry.definition.id)).map(toPayload),
    ...editors.filter((entry) => !registeredIds.has(entry.definition.id)).map(toPayload),
    ...terminals.map(toPayload)
  ]
}

/**
 * Only registered installed apps may launch; terminals receive the file's containing directory.
 * Rejects unknown apps and launch failures instead of opening a different app.
 */
export async function openFileWithApp(filePath: string, appId: string): Promise<void> {
  const installed = await listInstalledApps()
  const target = installed.find((entry) => entry.definition.id === appId)
  if (!target) {
    throw new Error(`Unknown or unavailable application: ${appId}`)
  }

  const launchPath = target.definition.kind === 'terminal' ? path.dirname(filePath) : filePath

  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', target.launchTarget, launchPath], {
      timeout: LAUNCH_TIMEOUT_MS
    })
    return
  }

  const override =
    process.platform === 'win32'
      ? target.definition.launch?.win32
      : target.definition.launch?.linux

  let command: string
  let args: string[]
  if (override) {
    command = override.command ?? target.launchTarget
    args = buildLaunchArgs(override.args, launchPath)
  } else if (process.platform === 'win32') {
    command = target.launchTarget
    args = [launchPath]
  } else {
    command = 'gio'
    args = ['launch', findDesktopEntry(target.launchTarget) ?? target.launchTarget, launchPath]
  }

  // Detach long-running apps from the main process.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
