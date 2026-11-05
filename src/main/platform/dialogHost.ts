/**
 * Native dialog boundary.
 *
 * DeepChat asks the user for files and folders, saves images, confirms a full
 * data reset, and reports a fatal startup error. Electron exposes `dialog`;
 * mygo has `Dialog` with file and message dialogs, so this boundary keeps the
 * app's own option shapes instead of Electron's.
 */
export interface DialogFileFilter {
  name: string
  extensions: string[]
}

export type DialogOpenProperty =
  | 'openFile'
  | 'multiSelections'
  | 'openDirectory'
  | 'createDirectory'

export interface DialogOpenOptions {
  properties?: DialogOpenProperty[]
  filters?: DialogFileFilter[]
}

export interface DialogSaveOptions {
  defaultPath?: string
  filters?: DialogFileFilter[]
}

export interface DialogMessageOptions {
  type?: 'none' | 'info' | 'warning' | 'error' | 'question'
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
}

export interface DialogHost {
  showOpenDialog(options: DialogOpenOptions): Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog(options: DialogSaveOptions): Promise<{ canceled: boolean; filePath?: string }>
  /** Shows a blocking message box and returns the index of the chosen button. */
  showMessageBoxSync(options: DialogMessageOptions): number
  showErrorBox(title: string, content: string): void
}

export { electronDialogHost as dialogHost } from './electron/dialogHost'
