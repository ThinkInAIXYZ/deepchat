import logger from '@shared/logger'
import { dialog, type BrowserWindow } from 'electron'
import { CORE_NATIVE_CALLS } from '@shared/harness/core'
/**
 * Message dialog implemented via the renderer process
 * The dialog is displayed on the current default window content. If it is in the background, it will automatically switch to the foreground.
 * Only one message dialog can exist within a single active window. Repeated calls will trigger the callback of the previous dialog with null.
 */
import type {
  DialogRequest,
  DialogRequestParams,
  DialogResponse,
  DialogServicePort
} from '@shared/types/dialog'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { nanoid } from 'nanoid'

export class DialogService implements DialogServicePort {
  private stopped = false
  private readonly nativeDialogs = new Map<Promise<unknown>, BrowserWindow>()
  private pendingDialogs = new Map<
    string,
    {
      resolve: (response: string) => void
      reject: (error: Error) => void
    }
  >()

  constructor(private readonly publishEvent: DeepchatEventPublisher) {}

  showOpenDialog(parent: BrowserWindow, options: Electron.OpenDialogOptions) {
    return this.showNativeDialog(parent, () => dialog.showOpenDialog(parent, options))
  }

  showSaveDialog(parent: BrowserWindow, options: Electron.SaveDialogOptions) {
    return this.showNativeDialog(parent, () => dialog.showSaveDialog(parent, options))
  }

  private async showNativeDialog<T>(parent: BrowserWindow, open: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error('Dialog service is stopping')
    if (this.nativeDialogs.size >= CORE_NATIVE_CALLS)
      throw new Error('Native dialog limit exceeded')
    // One physical picker keeps queued requests under the application's shutdown fence.
    const previous = [...this.nativeDialogs.keys()].at(-1)
    const pending = Promise.resolve(previous)
      .catch(() => {})
      .then(() => {
        if (this.stopped || parent.isDestroyed())
          throw new Error('Native dialog owner is unavailable')
        return open()
      })
    this.nativeDialogs.set(pending, parent)
    try {
      return await pending
    } finally {
      this.nativeDialogs.delete(pending)
    }
  }

  async drainNativeDialogs(): Promise<void> {
    if (!this.stopped) throw new Error('Dialog service must stop before retirement')
    if (!this.nativeDialogs.size) return
    if (process.platform === 'darwin')
      for (const parent of new Set(this.nativeDialogs.values()))
        if (!parent.isDestroyed()) parent.hide()
    await Promise.allSettled(this.nativeDialogs.keys())
  }

  /**
   * show dialog in the default active window
   * @param request Dialog Parameters
   * @returns Promise<DialogResponse> click result
   */
  async showDialog(request: DialogRequestParams): Promise<string> {
    if (this.stopped) throw new Error('Dialog service is stopping')
    if (!request.title) {
      throw new Error('Dialog title is required')
    }
    if (Array.isArray(request.buttons) && request.buttons.filter((btn) => btn.default).length > 1) {
      throw new Error('Dialog buttons cannot have more than one default button')
    }
    return new Promise((resolve, reject) => {
      try {
        const finalRequest: DialogRequest = {
          id: nanoid(8), // Better to use current DEFAULT_TAB id to control max one dialog per window, but currently lacks access method
          title: request.title,
          description: request.description,
          i18n: !!request.i18n,
          icon: request.icon,
          buttons: request.buttons ?? [{ key: 'ok', label: 'OK' }],
          timeout: request.timeout ?? 0
        }
        this.pendingDialogs.set(finalRequest.id, { resolve, reject })
        try {
          this.publishEvent('dialog.requested', {
            ...finalRequest,
            version: Date.now()
          })
        } catch (error) {
          // Clean up the pending dialog entry
          this.pendingDialogs.delete(finalRequest.id)
          reject(error)
        }
      } catch (err) {
        console.error('[Dialog] Error in showDialog:', err)
        reject(err)
      }
    })
  }

  /**
   * handle dialog response
   * @param response DialogResponse object containing the response from the dialog
   */
  async handleDialogResponse(response: DialogResponse): Promise<void> {
    if (this.pendingDialogs.has(response.id)) {
      logger.info('[Dialog] response received:', response)
      const pendingDialog = this.pendingDialogs.get(response.id)
      this.pendingDialogs.delete(response.id)
      pendingDialog?.resolve(response.button)
    }
  }

  /**
   * handle dialog error
   * @param id Dialog id
   */
  async handleDialogError(id: string): Promise<void> {
    if (this.pendingDialogs.has(id)) {
      console.warn(`[Dialog] Error handling dialog with id: ${id}`)
      const pendingDialog = this.pendingDialogs.get(id)
      this.pendingDialogs.delete(id)
      pendingDialog?.reject(new Error(`Dialog with id ${id} was cancelled`))
    }
  }

  destroy(): void {
    this.stopped = true
    for (const pending of this.pendingDialogs.values())
      pending.reject(new Error('Dialog service is stopping'))
    this.pendingDialogs.clear()
  }
}
