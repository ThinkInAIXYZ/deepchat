import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { appsForPlatform, toFileOpenAppPlatform } from '@shared/workspace/fileOpenApps'
import type { WorkspaceFileOpenApp } from '@shared/types/workspace'
import { detectInstalledApps, type DetectedApp } from './detectors'
import { launchApp } from './launchers'

const execFileAsync = promisify(execFile)

const PROBE_TIMEOUT_MS = 8_000
/** Re-probe occasionally so apps installed while running eventually show up. */
const CACHE_TTL_MS = 60_000

type Cached<T> = { probedAt: number; value: Promise<T> }

/** Detection is expensive but machine-global, so cache it behind a short TTL. */
let installedCache: Cached<DetectedApp[]> | null = null

/** OS handler lists depend only on file type, so cache them per extension. */
const handlerCache = new Map<string, Cached<Set<string>>>()

const isFresh = (cached: Cached<unknown> | null | undefined): boolean =>
  Boolean(cached && Date.now() - cached.probedAt < CACHE_TTL_MS)

async function listInstalledApps(): Promise<DetectedApp[]> {
  if (isFresh(installedCache)) {
    return installedCache!.value
  }

  const value = detectInstalledApps()
    .catch((error) => {
      console.warn('[Workspace] Failed to detect installed editors and terminals', error)
      return [] as DetectedApp[]
    })
    .then((apps) => {
      // Never cache an empty result. It means either a failed probe, which must
      // be retried, or genuinely nothing installed, where one extra subprocess
      // costs little. Windows and Linux probes swallow per-app errors, so an
      // empty list is the only signal that detection went wrong there.
      if (apps.length === 0) {
        installedCache = null
      }
      return apps
    })

  installedCache = { probedAt: Date.now(), value }
  return value
}

/**
 * Bundle ids Launch Services registers as handlers for a file, used only to rank
 * the picker. macOS only; elsewhere ranking falls back to registry order.
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

async function listRegisteredHandlerIds(filePath: string): Promise<Set<string>> {
  if (process.platform !== 'darwin') {
    return new Set()
  }

  const cacheKey = path.extname(filePath).toLowerCase() || path.basename(filePath).toLowerCase()
  const cached = handlerCache.get(cacheKey)
  if (isFresh(cached)) {
    return cached!.value
  }

  const value = (async () => {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', MACOS_HANDLERS_SCRIPT, filePath],
        { timeout: PROBE_TIMEOUT_MS }
      )
      const handlerBundleIds = new Set(JSON.parse(stdout.trim()) as string[])

      return new Set(
        appsForPlatform('darwin')
          .filter((definition) => {
            const detect = definition.detect.darwin
            return (
              detect?.type === 'macBundleId' &&
              detect.bundleIds.some((bundleId) => handlerBundleIds.has(bundleId))
            )
          })
          .map((definition) => definition.id)
      )
    } catch (error) {
      console.warn(`[Workspace] Failed to read registered handlers for: ${filePath}`, error)
      handlerCache.delete(cacheKey)
      return new Set<string>()
    }
  })()

  handlerCache.set(cacheKey, { probedAt: Date.now(), value })
  return value
}

/**
 * List the installed editors, IDEs and terminals offered for a file.
 *
 * Editors the OS registers for this file type come first, then the remaining
 * installed editors, then terminals. Terminals never register as file handlers,
 * so they are always included when installed.
 */
export async function listFileOpenApps(filePath: string): Promise<WorkspaceFileOpenApp[]> {
  const [installed, registeredIds] = await Promise.all([
    listInstalledApps(),
    listRegisteredHandlerIds(filePath)
  ])

  const toPayload = (entry: DetectedApp): WorkspaceFileOpenApp => ({
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
 * Open a file with one of the apps reported by {@link listFileOpenApps}.
 *
 * The id must belong to an installed registry app, so a renderer cannot turn
 * this into an arbitrary command launcher.
 */
export async function openFileWithApp(filePath: string, appId: string): Promise<void> {
  const installed = await listInstalledApps()
  const target = installed.find((entry) => entry.definition.id === appId)
  if (!target) {
    throw new Error(`Unknown or unavailable application: ${appId}`)
  }

  await launchApp(target, filePath, toFileOpenAppPlatform(process.platform))
}
