import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import {
  appsForPlatform,
  toFileOpenAppPlatform,
  type WorkspaceFileOpenAppDefinition,
  type WorkspaceFileOpenAppLaunch,
  type WorkspaceFileOpenAppPlatform
} from '@shared/workspace/fileOpenApps'
import { extractMacOSIcons } from './iconExtractor'
import {
  desktopEntryAcceptsFiles,
  findDesktopEntry,
  readDesktopEntry,
  readDesktopEntryIcon
} from './linuxDesktopEntries'

const execFileAsync = promisify(execFile)

const PROBE_TIMEOUT_MS = 8_000
const SAFE_BINARY_REGEX = /^[\w.-]+$/

/**
 * A detected app: how to launch it, plus its real icon as a PNG data URL.
 *
 * `launchTarget` is a bundle path on macOS, an executable path on Windows, and
 * either a binary path or a `.desktop` path on Linux. `launchOverride` narrows
 * the registry's declared strategy to whichever one detection actually resolved.
 */
export type DetectedApp = {
  definition: WorkspaceFileOpenAppDefinition
  launchTarget: string
  launchOverride?: WorkspaceFileOpenAppLaunch
  iconDataUrl?: string
}

/**
 * Batch-resolve macOS bundle ids to bundle paths in one subprocess. Uses Launch
 * Services rather than probing hardcoded `/Applications` paths, so apps in
 * `~/Applications` are found too.
 */
const MACOS_RESOLVE_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const workspace = $.NSWorkspace.sharedWorkspace
  const result = {}
  for (const bundleId of JSON.parse(argv[0])) {
    const url = workspace.URLForApplicationWithBundleIdentifier(bundleId)
    result[bundleId] = url && !url.isNil() ? ObjC.unwrap(url.path) : null
  }
  return JSON.stringify(result)
}`

async function detectDarwin(
  definitions: WorkspaceFileOpenAppDefinition[]
): Promise<DetectedApp[]> {
  const bundleIds = [
    ...new Set(
      definitions.flatMap((definition) => {
        const detect = definition.detect.darwin
        return detect?.type === 'macBundleId' ? detect.bundleIds : []
      })
    )
  ]

  const { stdout } = await execFileAsync(
    'osascript',
    ['-l', 'JavaScript', '-e', MACOS_RESOLVE_SCRIPT, JSON.stringify(bundleIds)],
    { timeout: PROBE_TIMEOUT_MS }
  )
  const resolved = JSON.parse(stdout.trim()) as Record<string, string | null>

  const detected: DetectedApp[] = []
  for (const definition of definitions) {
    const detect = definition.detect.darwin
    if (detect?.type !== 'macBundleId') {
      continue
    }

    const launchTarget = detect.bundleIds
      .map((bundleId) => resolved[bundleId])
      .find((bundlePath): bundlePath is string => Boolean(bundlePath))

    if (launchTarget) {
      detected.push({ definition, launchTarget })
    }
  }

  const icons = await extractMacOSIcons(detected.map((entry) => entry.launchTarget))
  return detected.map((entry) => ({ ...entry, iconDataUrl: icons.get(entry.launchTarget) }))
}

/** Expand `%VAR%` references, which App Paths stores as REG_EXPAND_SZ. */
function expandWindowsEnvironmentVariables(value: string): string {
  const environment = new Map(
    Object.entries(process.env).map(([name, variableValue]) => [name.toLowerCase(), variableValue])
  )
  return value.replace(/%([^%]+)%/g, (reference, name: string) => {
    return environment.get(name.toLowerCase()) ?? reference
  })
}

/**
 * Read the default value of a registry key.
 *
 * Anchors on the `REG_SZ` / `REG_EXPAND_SZ` type column rather than the value
 * name: `reg query /ve` localizes the `(Default)` label, so matching that name
 * fails on non-English Windows.
 */
async function readRegistryDefault(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true
    })

    const match = stdout.match(/\s{2,}REG_(EXPAND_SZ|SZ)\s{2,}(.+)/i)
    const value = match?.[2]?.trim().replace(/^"|"$/g, '')
    if (!value) {
      return null
    }

    return match[1].toUpperCase() === 'EXPAND_SZ'
      ? expandWindowsEnvironmentVariables(value)
      : value
  } catch {
    return null
  }
}

/**
 * Resolve a Windows executable to a full path: App Paths under HKCU first
 * (per-user installers, the default for VS Code and Cursor, cannot write HKLM),
 * then HKLM, then PATH. The PATH result is filtered to real `.exe` files because
 * the CLI shims are `.cmd` wrappers that cannot be spawned directly.
 */
async function resolveWindowsExecutable(exeName: string): Promise<string | null> {
  const suffix = `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`

  for (const root of ['HKCU', 'HKLM']) {
    const resolved = await readRegistryDefault(`${root}\\${suffix}`)
    if (resolved && fs.existsSync(resolved)) {
      return resolved
    }
  }

  try {
    const { stdout } = await execFileAsync('where', [exeName], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true
    })
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.toLowerCase().endsWith('.exe') && fs.existsSync(line)) ?? null
    )
  } catch {
    return null
  }
}

async function detectWin32(definitions: WorkspaceFileOpenAppDefinition[]): Promise<DetectedApp[]> {
  const results = await Promise.all(
    definitions.map(async (definition) => {
      const detect = definition.detect.win32
      if (detect?.type !== 'winExecutable') {
        return null
      }

      for (const exeName of detect.exeNames) {
        const launchTarget = await resolveWindowsExecutable(exeName)
        if (!launchTarget) {
          continue
        }

        // On Windows the icon lives in the executable, so Electron can read it.
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

  return results.filter((entry): entry is DetectedApp => entry !== null)
}

/** `command -v` lookup. The binary name is validated to keep it out of the shell. */
async function resolveLinuxBinary(binary: string): Promise<string | null> {
  if (!SAFE_BINARY_REGEX.test(binary)) {
    console.warn(`[Workspace] Rejecting unsafe binary name: ${binary}`)
    return null
  }

  try {
    const { stdout } = await execFileAsync('/bin/sh', ['-c', `command -v "${binary}"`], {
      timeout: PROBE_TIMEOUT_MS
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Detect a Linux app, preferring an exec'able binary over a desktop entry.
 *
 * A binary can carry CLI flags, which terminals need for their working
 * directory. A desktop entry is the fallback for installs that leave no binary
 * on PATH (JetBrains Toolbox without a CLI launcher, Flatpaks, some distro
 * packages), and is only accepted when it declares a `%f`/`%u` field code —
 * `gio launch` silently drops the path otherwise, so the app would open empty.
 */
async function detectLinuxApp(
  definition: WorkspaceFileOpenAppDefinition
): Promise<DetectedApp | null> {
  const detect = definition.detect.linux
  if (detect?.type !== 'linuxApp') {
    return null
  }

  if (detect.binary) {
    const binaryPath = await resolveLinuxBinary(detect.binary)
    if (binaryPath) {
      // No override: the registry's `exec` strategy carries the CLI flags that
      // terminals need for their working directory.
      return { definition, launchTarget: binaryPath }
    }
  }

  for (const desktopId of detect.desktopIds ?? []) {
    const entryPath = findDesktopEntry(desktopId)
    if (!entryPath) {
      continue
    }

    const content = readDesktopEntry(entryPath)
    if (!content || !desktopEntryAcceptsFiles(content)) {
      continue
    }

    return {
      definition,
      launchTarget: entryPath,
      launchOverride: { type: 'desktopEntry' },
      iconDataUrl: readDesktopEntryIcon(content)
    }
  }

  return null
}

async function detectLinux(definitions: WorkspaceFileOpenAppDefinition[]): Promise<DetectedApp[]> {
  const results = await Promise.all(definitions.map((definition) => detectLinuxApp(definition)))
  return results.filter((entry): entry is DetectedApp => entry !== null)
}

/**
 * Detect every registry app available on the current platform. Registry order is
 * preserved so callers can apply their own ranking.
 *
 * Rejects on probe failure rather than returning an empty list, so a caller
 * caching the result cannot pin "no apps installed" after one transient error.
 */
export async function detectInstalledApps(
  platform: WorkspaceFileOpenAppPlatform = toFileOpenAppPlatform(process.platform)
): Promise<DetectedApp[]> {
  const definitions = appsForPlatform(platform)

  if (platform === 'darwin') {
    return detectDarwin(definitions)
  }
  if (platform === 'win32') {
    return detectWin32(definitions)
  }
  return detectLinux(definitions)
}
