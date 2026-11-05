import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type { AppHost, AppPathName } from '../appHost'

/**
 * Path and version resolution for a Node sidecar.
 *
 * The Go shell owns the real application paths. It passes them through the
 * environment so the sidecar resolves exactly the same directories the Electron
 * build used; the defaults below only keep the sidecar runnable on its own
 * during development.
 */
const APP_NAME = 'DeepChat'

const resolveDefaultUserData = (): string => {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', APP_NAME)
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), APP_NAME)
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), APP_NAME)
}

const paths: Record<AppPathName, () => string> = {
  userData: () => process.env.DEEPCHAT_USER_DATA ?? resolveDefaultUserData(),
  temp: () => tmpdir(),
  home: () => homedir(),
  appData: () =>
    process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support')
      : (process.env.APPDATA ?? path.join(homedir(), '.config')),
  documents: () => path.join(homedir(), 'Documents'),
  desktop: () => path.join(homedir(), 'Desktop'),
  downloads: () => path.join(homedir(), 'Downloads'),
  logs: () =>
    process.env.DEEPCHAT_LOGS_DIR ??
    path.join(process.env.DEEPCHAT_USER_DATA ?? resolveDefaultUserData(), 'logs')
}

const resolveLocale = (): string => {
  const raw = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? 'en-US'
  return raw.split('.')[0].replace('_', '-') || 'en-US'
}

export const nodeAppHost: AppHost = {
  getPath(name: AppPathName): string {
    return paths[name]()
  },

  getAppPath(): string {
    return process.env.DEEPCHAT_APP_PATH ?? process.cwd()
  },

  getVersion(): string {
    return process.env.DEEPCHAT_APP_VERSION ?? '0.0.0'
  },

  getName(): string {
    return APP_NAME
  },

  getLocale(): string {
    return resolveLocale()
  },

  isPackaged(): boolean {
    return process.env.DEEPCHAT_PACKAGED === '1'
  },

  getResourcesPath(): string {
    return process.env.DEEPCHAT_RESOURCES_PATH ?? path.join(process.cwd(), 'resources')
  },

  // Launch-at-login is an OS integration the shell owns. Reporting "off" and
  // ignoring writes keeps the setting inert here instead of failing a read.
  getLoginItemEnabled(): boolean {
    return false
  },

  setLoginItemEnabled(): void {}
}

/** Canonical name so the build can swap this module in for the electron one. */
export const appHost = nodeAppHost
