/**
 * Message dialog implemented via the renderer process
 * The dialog is displayed on the currently active tab. If the tab is in the background, it will automatically switch to the foreground.
 * Only one message dialog can exist within a single active window. Repeated calls will trigger the callback of the previous dialog with null.
 * @see {@link SendTarget.DEFAULT_TAB}
 */
import {
  DialogRequest,
  DialogRequestParams,
  DialogResponse,
  IDialogPresenter
} from '@shared/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { DIALOG_EVENTS } from '@/events'
import { nanoid } from 'nanoid'

export class DialogPresenter implements IDialogPresenter {
  private pendingDialogs = new Map<
    string,
    {
      resolve: (response: string) => void
      reject: (error: Error) => void
    }
  >()

  /**
   * show dialog in default active tab
   * @param request Dialog Parameters
   * @returns Promise<DialogResponse> click result
   */
  async showDialog(request: DialogRequestParams): Promise<string> {
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
          // send dialog request to renderer
          eventBus.sendToRenderer(DIALOG_EVENTS.REQUEST, SendTarget.DEFAULT_TAB, finalRequest)
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
      console.log('[Dialog] response received:', response)
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
}
