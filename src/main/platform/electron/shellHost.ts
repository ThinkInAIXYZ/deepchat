import { shell } from 'electron'
import type { ShellHost } from '../shellHost'

export const electronShellHost: ShellHost = {
  async openExternal(url: string): Promise<void> {
    await shell.openExternal(url)
  },

  async openPath(path: string): Promise<string> {
    return await shell.openPath(path)
  },

  showItemInFolder(path: string): void {
    shell.showItemInFolder(path)
  }
}
