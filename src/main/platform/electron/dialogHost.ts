import { dialog } from 'electron'
import type {
  DialogHost,
  DialogMessageOptions,
  DialogOpenOptions,
  DialogSaveOptions
} from '../dialogHost'

export const electronDialogHost: DialogHost = {
  async showOpenDialog(options: DialogOpenOptions) {
    return await dialog.showOpenDialog({
      properties: options.properties,
      filters: options.filters
    })
  },

  async showSaveDialog(options: DialogSaveOptions) {
    return await dialog.showSaveDialog({
      defaultPath: options.defaultPath,
      filters: options.filters
    })
  },

  showMessageBoxSync(options: DialogMessageOptions): number {
    return dialog.showMessageBoxSync({
      type: options.type,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      defaultId: options.defaultId
    })
  },

  showErrorBox(title: string, content: string): void {
    dialog.showErrorBox(title, content)
  }
}
