import { Tray, Menu, app, nativeImage, NativeImage } from 'electron'
import * as path from 'path'
import { getContextMenuLabels } from '@shared/i18n'
import type { IWindowPresenter } from '@shared/types/desktop'
import type { DesktopSettings } from './settings'

export class TrayPresenter {
  private tray: Tray | null = null
  private iconPath: string

  constructor(
    private readonly settings: Pick<DesktopSettings, 'getLanguage'>,
    private readonly windowPresenter: IWindowPresenter
  ) {
    this.iconPath = path.join(app.getAppPath(), 'resources')
  }

  private createTray() {
    // 根据平台选择不同的图标
    let image: NativeImage | undefined = undefined

    if (process.platform === 'darwin') {
      // macOS 平台
      image = nativeImage.createFromPath(path.join(this.iconPath, 'macTrayTemplate.png'))
      image = image.resize({ width: 24, height: 24 })
      image.setTemplateImage(true)
    } else if (process.platform === 'win32') {
      // Windows 平台
      image = nativeImage.createFromPath(path.join(this.iconPath, 'win_tray.ico'))
    } else {
      // Linux 和其他平台
      image = nativeImage.createFromPath(path.join(this.iconPath, 'linux_tray.png'))
      // Linux 下通常使用较小的图标尺寸
      image = image.resize({ width: 22, height: 22 })
    }

    this.tray = new Tray(image)
    this.tray.setToolTip('DeepChat')

    // 获取当前系统语言
    const locale = this.settings.getLanguage()
    const labels = getContextMenuLabels(locale)
    const contextMenu = Menu.buildFromTemplate([
      {
        label: labels.open || '打开/隐藏',
        click: () => {
          this.windowPresenter.toggleMainWindowVisibility()
        }
      },
      {
        label: labels.checkForUpdates || '检查更新',
        click: () => {
          void this.openUpdateSettings()
        }
      },
      {
        label: labels.quit || '退出',
        click: async () => {
          app.quit() // Exit trigger: tray menu
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)

    // On macOS, clicking the status item opens the system menu. Do not also reveal the window,
    // otherwise the menu's Open/Hide item can never hide the app reliably.
    if (process.platform !== 'darwin') {
      this.tray.on('click', () => {
        this.windowPresenter.toggleMainWindowVisibility(true)
      })
    }
  }

  public init(): void {
    this.createTray()
  }

  private async openUpdateSettings(): Promise<void> {
    try {
      const settingsWindowId = await this.windowPresenter.createSettingsWindow({
        routeName: 'settings-about'
      })
      if (settingsWindowId == null) {
        console.warn('Failed to open settings window for update check')
        return
      }

      this.windowPresenter.sendSettingsCheckForUpdates(settingsWindowId)
    } catch (error) {
      console.error('Failed to open update settings from tray:', error)
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
