import { app } from 'electron'
import type { AppHost, AppPathName } from '../appHost'

export const electronAppHost: AppHost = {
  getPath(name: AppPathName): string {
    return app.getPath(name)
  },

  getAppPath(): string {
    return app.getAppPath()
  },

  getVersion(): string {
    return app.getVersion()
  },

  getName(): string {
    return app.getName()
  },

  getLocale(): string {
    return app.getLocale()
  },

  isPackaged(): boolean {
    return app.isPackaged
  },

  getResourcesPath(): string {
    return process.resourcesPath
  },

  getLoginItemEnabled(): boolean {
    return app.getLoginItemSettings().openAtLogin
  },

  setLoginItemEnabled(enabled: boolean): void {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
  }
}
