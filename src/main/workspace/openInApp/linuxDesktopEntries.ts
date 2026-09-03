import fs from 'fs'
import os from 'os'
import path from 'path'
import { nativeImage } from 'electron'

/**
 * Desktop-entry lookup for Linux app detection.
 *
 * A `command -v` hit is preferred because it can be exec'd with CLI flags, but
 * many installs only register a `.desktop` file: JetBrains Toolbox IDEs without
 * a CLI launcher, Flatpaks, and distro packages that keep their binary off PATH.
 */

function desktopEntryDirectories(): string[] {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean)
  return [dataHome, ...dataDirs].map((dir) => path.join(dir, 'applications'))
}

/** Absolute path of the first matching desktop entry, or null. */
export function findDesktopEntry(desktopId: string): string | null {
  for (const dir of desktopEntryDirectories()) {
    const candidate = path.join(dir, desktopId)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function readDesktopEntry(entryPath: string): string | null {
  try {
    return fs.readFileSync(entryPath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Whether the entry's `Exec=` declares a file field code (`%f`/`%F`/`%u`/`%U`).
 *
 * `gio launch` only forwards a path to entries that declare one; without it the
 * app opens with no file and the user sees a silent no-op. Only the
 * `[Desktop Entry]` group is considered, so action groups cannot mask a miss.
 */
export function desktopEntryAcceptsFiles(content: string): boolean {
  let inDesktopEntry = false

  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '[Desktop Entry]') {
      inDesktopEntry = true
      continue
    }
    if (inDesktopEntry && line.startsWith('[')) {
      break
    }
    if (inDesktopEntry && line.startsWith('Exec=')) {
      return /(^|[^%])%[fFuU]/.test(line.slice('Exec='.length))
    }
  }

  return false
}

/**
 * Icon from the entry's `Icon=` key, as a data URL.
 *
 * Only absolute paths are resolved; a themed icon name would need an icon-theme
 * lookup, and those fall back to the renderer's placeholder.
 */
export function readDesktopEntryIcon(content: string): string | undefined {
  const iconValue = content.match(/^Icon=(.*)$/m)?.[1]?.trim()
  if (!iconValue?.startsWith('/')) {
    return undefined
  }

  try {
    const icon = nativeImage.createFromPath(iconValue)
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}
