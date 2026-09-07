import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'

const execFileAsync = promisify(execFile)

/** 64px keeps the payload small while staying crisp at the renderer's 16px on Retina. */
const ICON_SIZE = 64
const EXEC_TIMEOUT_MS = 5_000

let tmpDirPromise: Promise<string | null> | null = null

async function ensureTmpDir(): Promise<string | null> {
  if (!tmpDirPromise) {
    tmpDirPromise = mkdtemp(path.join(tmpdir(), 'deepchat-openinapp-')).catch(() => null)
  }
  return tmpDirPromise
}

/**
 * Render an app bundle's icon via `plutil` + `sips`.
 *
 * Both ship with every macOS install. This is preferred over drawing an
 * `NSImage` in JXA because it needs no graphics context, so it also works when
 * the process has no window server connection.
 *
 * Returns null when the bundle declares no `CFBundleIconFile` (asset-catalog
 * only apps), which is the case the JXA fallback covers.
 */
async function extractIconWithSips(bundlePath: string): Promise<string | null> {
  const tmpDir = await ensureTmpDir()
  if (!tmpDir) {
    return null
  }

  let icnsPath: string
  try {
    const { stdout } = await execFileAsync(
      'plutil',
      ['-extract', 'CFBundleIconFile', 'raw', path.join(bundlePath, 'Contents', 'Info.plist')],
      { timeout: EXEC_TIMEOUT_MS }
    )
    const iconName = stdout.trim()
    if (!iconName) {
      return null
    }
    const fileName = iconName.endsWith('.icns') ? iconName : `${iconName}.icns`
    icnsPath = path.join(bundlePath, 'Contents', 'Resources', fileName)
  } catch {
    return null
  }

  const outPath = path.join(tmpDir, `${path.basename(bundlePath, '.app')}-${Date.now()}.png`)
  try {
    await execFileAsync(
      'sips',
      ['-z', `${ICON_SIZE}`, `${ICON_SIZE}`, '-s', 'format', 'png', icnsPath, '--out', outPath],
      { timeout: EXEC_TIMEOUT_MS }
    )
    const buffer = await readFile(outPath)
    return buffer.length > 0 ? `data:image/png;base64,${buffer.toString('base64')}` : null
  } catch {
    return null
  } finally {
    void unlink(outPath).catch(() => undefined)
  }
}

/**
 * JXA fallback that renders the Launch Services icon for bundles `sips` cannot
 * resolve. Batched into one subprocess, keyed by bundle path.
 */
const MACOS_ICON_FALLBACK_SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const size = parseInt(argv[1], 10)
  const workspace = $.NSWorkspace.sharedWorkspace
  const result = {}

  for (const bundlePath of JSON.parse(argv[0])) {
    let icon = null
    try {
      const image = workspace.iconForFile(bundlePath)
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
    result[bundlePath] = icon
  }

  return JSON.stringify(result)
}`

async function extractIconsWithJxa(bundlePaths: string[]): Promise<Map<string, string>> {
  const icons = new Map<string, string>()
  if (bundlePaths.length === 0) {
    return icons
  }

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        MACOS_ICON_FALLBACK_SCRIPT,
        JSON.stringify(bundlePaths),
        `${ICON_SIZE}`
      ],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    )

    for (const [bundlePath, base64] of Object.entries(
      JSON.parse(stdout.trim()) as Record<string, string | null>
    )) {
      if (base64) {
        icons.set(bundlePath, `data:image/png;base64,${base64}`)
      }
    }
  } catch (error) {
    console.warn('[Workspace] JXA icon fallback failed', error)
  }

  return icons
}

/**
 * Resolve icons for the given macOS bundle paths: `sips` first, then one batched
 * JXA pass for whatever it could not resolve.
 */
export async function extractMacOSIcons(bundlePaths: string[]): Promise<Map<string, string>> {
  const icons = new Map<string, string>()

  const sipsResults = await Promise.all(
    bundlePaths.map(
      async (bundlePath) => [bundlePath, await extractIconWithSips(bundlePath)] as const
    )
  )

  const unresolved: string[] = []
  for (const [bundlePath, icon] of sipsResults) {
    if (icon) {
      icons.set(bundlePath, icon)
    } else {
      unresolved.push(bundlePath)
    }
  }

  if (unresolved.length > 0) {
    for (const [bundlePath, icon] of await extractIconsWithJxa(unresolved)) {
      icons.set(bundlePath, icon)
    }
  }

  return icons
}
