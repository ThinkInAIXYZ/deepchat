import { EventEmitter } from 'node:events'

/**
 * A stand-in for `electron-updater` in the Node sidecar.
 *
 * The real package loads Electron's `app` at module scope, so it cannot be
 * required here. Updates are the shell's responsibility anyway: it owns the
 * package, its signature and the install step. This keeps the app's update
 * service constructible, and every operation reports "nothing happened" instead
 * of throwing at import time.
 */
class SidecarAutoUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowDowngrade = false
  allowPrerelease = false
  currentVersion = { version: '0.0.0' }
  logger: unknown = null

  async checkForUpdates(): Promise<null> {
    return null
  }

  async checkForUpdatesAndNotify(): Promise<null> {
    return null
  }

  async downloadUpdate(): Promise<void> {}

  quitAndInstall(): void {}
}

const autoUpdater = new SidecarAutoUpdater()

export default { autoUpdater }
export { autoUpdater }
export type UpdateInfo = {
  version: string
  releaseDate: string
  releaseNotes?: string
}
export type ProgressInfo = {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}
