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
/** Icons render at 16px; 32pt yields a crisp 64x64 bitmap on Retina. */
const ICON_POINT_SIZE = 32
/** Icon payload is ~7KB per app; the registry can exceed Node's 1MB default. */
const ICON_PROBE_MAX_BUFFER = 8 * 1024 * 1024
/** Re-probe occasionally so apps installed while running eventually show up. */
const INSTALLED_APPS_TTL_MS = 60_000

/**
 * A detected app: how to launch it, plus its real icon as a PNG data URL.
 */
type InstalledApp = {
  definition: WorkspaceFileOpenAppDefinition
  launchTarget: string
  iconDataUrl?: string
}

/** Detection is expensive but machine-global, so cache it behind a short TTL. */
let installedAppsCache: { probedAt: number; apps: Promise<InstalledApp[]> } | null = null

/** OS handler lists depend only on file type, so cache them per extension. */
const handlerCache = new Map<string, Promise<Set<string>>>()

/**
 * JXA batch probe: resolves each bundle id to its app path and renders the real
 * Launch Services icon to base64 PNG. One subprocess covers the whole registry.
 *
 * `NSWorkspace.iconForFile` is used rather than Electron's `app.getFileIcon`,
 * which returns a generic document icon for `.app` bundles on macOS.
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

/**
 * JXA lookup of the applications Launch Services registers for a file, returned
 * as bundle identifiers so they can be matched against the registry.
 */
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

/**
 * Read the default value of a Windows registry key, or null when absent.
 */
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
 * Resolve a Windows executable to a full path.
 *
 * HKCU is queried before HKLM because per-user installers (the default for VS
 * Code and Cursor) cannot write HKLM. The PATH fallback is last and filtered to
 * real executables: the CLI shims on PATH are `.cmd` wrappers, which cannot be
 * spawned directly and carry no icon.
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
  // Each definition costs up to 2 subprocess spawns per candidate executable, so
  // probe definitions concurrently rather than serially.
  const results = await Promise.all(
    WORKSPACE_FILE_OPEN_APPS.map(async (definition) => {
      for (const executable of definition.executables ?? []) {
        const launchTarget = await resolveWindowsExecutable(executable)
        if (!launchTarget) {
          continue
        }

        // On Windows the icon is attached to the executable, so Electron can read it.
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

/**
 * Read the `Icon=` value of a desktop entry. Only absolute paths are resolved;
 * themed icon names would need a full icon-theme lookup, so those get no icon.
 */
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

/**
 * Registry ids the OS reports as handlers for this file type. Used only for
 * ordering, so a detection failure degrades to registry order.
 */
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

/**
 * List the installed editors, IDEs and terminals offered for a file.
 *
 * Editors the OS registers for this file type are listed first, then remaining
 * installed editors, then terminals. Terminals never register as file handlers,
 * so they are always included when installed.
 */
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
 * Launch a file with one of the apps reported by {@link listFileOpenApps}.
 *
 * The id must belong to an installed registry app, so a renderer cannot turn
 * this into an arbitrary command launcher. Terminals receive the containing
 * directory instead of the file: passing the file would make some terminals
 * try to execute it.
 *
 * Rejects when the app is unknown or the launch fails, so the caller can tell
 * the user instead of silently opening something else.
 */
export async function openFileWithApp(filePath: string, appId: string): Promise<void> {
  const installed = await listInstalledApps()
  const target = installed.find((entry) => entry.definition.id === appId)
  if (!target) {
    throw new Error(`Unknown or unavailable application: ${appId}`)
  }

  const launchPath = target.definition.kind === 'terminal' ? path.dirname(filePath) : filePath

  if (process.platform === 'darwin') {
    // `open` hands off to Launch Services and exits immediately, and already
    // opens terminals at the given directory.
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

  // The launched process stays attached on these platforms, so detach instead of
  // waiting: a timeout would otherwise kill the application the user opened.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
