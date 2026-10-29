import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { shell } from 'electron'
import fontList from 'font-list'
import { reportNativeMainError } from '@/logging'

export class DesktopConfigurationHost {
  private state: 'active' | 'paused' | 'closed' = 'paused'
  private restartPending = false
  private restartTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly userDataDirectory: string,
    private readonly setLoggingPersistence: (enabled: boolean) => void,
    private readonly restartApplication: () => Promise<void>
  ) {
    if (!isAbsolute(userDataDirectory))
      throw new Error('Desktop profile directory must be absolute')
  }

  async listSystemFonts(): Promise<string[]> {
    this.assertOpen()
    return await fontList.getFonts()
  }

  async openLoggingFolder(): Promise<void> {
    this.assertOpen()
    const directory = join(this.userDataDirectory, 'logs')
    await mkdir(directory, { recursive: true })
    this.assertOpen()
    const error = await shell.openPath(directory)
    if (error) throw new Error(`Unable to open logging folder: ${error}`)
  }

  async applyLogging(enabled: boolean): Promise<void> {
    this.assertOpen()
    this.setLoggingPersistence(enabled)
    this.requestRestart()
  }

  requestRestart(): void {
    this.assertOpen()
    this.restartPending = true
    this.scheduleRestart()
  }

  pause(): void {
    if (this.state === 'closed') return
    this.state = 'paused'
    this.clearRestartTimer()
  }

  resume(): void {
    this.assertOpen()
    this.state = 'active'
    this.scheduleRestart()
  }

  close(): void {
    this.state = 'closed'
    this.restartPending = false
    this.clearRestartTimer()
  }

  private assertOpen(): void {
    if (this.state === 'closed') throw new Error('Desktop configuration host is closed')
  }

  private clearRestartTimer(): void {
    clearTimeout(this.restartTimer)
    this.restartTimer = undefined
  }

  private scheduleRestart(): void {
    this.clearRestartTimer()
    if (this.state !== 'active' || !this.restartPending) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.state !== 'active' || !this.restartPending) return
      this.restartPending = false
      try {
        // The shutdown coordinator owns a fired restart; awaiting it during close would deadlock.
        void this.restartApplication().catch((error) => {
          reportNativeMainError('Application restart failed:', error)
        })
      } catch (error) {
        reportNativeMainError('Application restart failed:', error)
      }
    }, 1000)
  }
}
