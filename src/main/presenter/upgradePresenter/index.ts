import { app, shell } from 'electron'
import {
  IUpgradePresenter,
  UpdateStatus,
  UpdateProgress,
  IConfigPresenter
} from '@shared/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { UPDATE_EVENTS, WINDOW_EVENTS } from '@/events'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const { autoUpdater } = electronUpdater

// 版本信息接口
interface VersionInfo {
  version: string
  releaseDate: string
  releaseNotes: string
  githubUrl?: string
  downloadUrl?: string
}

const GITHUB_OWNER = 'ThinkInAIXYZ'
const GITHUB_REPO = 'deepchat'
const GITHUB_RELEASE_BASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

const getReleaseTag = (version: string) => `v${version}`
const getReleasePageUrl = (version: string) =>
  `${GITHUB_RELEASE_BASE_URL}/tag/${getReleaseTag(version)}`
const getChangelogUrl = (version: string) =>
  `${GITHUB_RELEASE_BASE_URL}/download/${getReleaseTag(version)}/changelog.md`

// 获取自动更新状态文件路径
const getUpdateMarkerFilePath = () => {
  return path.join(app.getPath('userData'), 'auto_update_marker.json')
}

export class UpgradePresenter implements IUpgradePresenter {
  private _lock: boolean = false
  private _status: UpdateStatus = 'not-available'
  private _progress: UpdateProgress | null = null
  private _error: string | null = null
  private _versionInfo: VersionInfo | null = null
  private _lastCheckTime: number = 0 // 上次检查更新的时间戳
  private _lastCheckType: string | undefined
  private _updateMarkerPath: string
  private _previousUpdateFailed: boolean = false // 标记上次更新是否失败
  private _configPresenter: IConfigPresenter // 配置presenter
  private _isUpdating: boolean = false // Flag to track if update installation is in progress

  constructor(configPresenter: IConfigPresenter) {
    this._configPresenter = configPresenter
    this._updateMarkerPath = getUpdateMarkerFilePath()

    // 配置自动更新
    autoUpdater.autoDownload = false // 默认不自动下载，由我们手动控制
    autoUpdater.allowDowngrade = false
    autoUpdater.autoInstallOnAppQuit = true
    if (process.platform === 'darwin') {
      autoUpdater.channel = process.arch === 'arm64' ? 'arm64' : 'x64'
    }

    // 错误处理
    autoUpdater.on('error', (e) => {
      console.log('自动更新失败', e.message)
      this._lock = false
      this._status = 'error'
      this._error = e.message
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        error: this._error,
        info: this._versionInfo
      })
    })

    // 检查更新状态
    autoUpdater.on('checking-for-update', () => {
      console.log('正在检查更新')
    })

    // 无可用更新
    autoUpdater.on('update-not-available', () => {
      console.log('无可用更新')
      this._lock = false
      this._status = 'not-available'
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        type: this._lastCheckType
      })
    })

    // 有可用更新
    autoUpdater.on('update-available', (info) => {
      console.log('检测到新版本', info)
      this._status = 'available'
      this._versionInfo = this.buildVersionInfo(info, '')
      console.log('使用已保存的版本信息:', this._versionInfo)
      void this.refreshReleaseNotes(info)
      if (this._previousUpdateFailed) {
        console.log('上次更新失败，本次不进行自动更新，改为手动更新')
        this._status = 'error'
        this._error = '自动更新可能不稳定，请手动下载更新'
        eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
          status: this._status,
          error: this._error,
          info: this._versionInfo
        })
        return
      }
      this.startDownloadUpdate()
    })

    // 下载进度
    autoUpdater.on('download-progress', (progressObj) => {
      this._lock = true
      this._status = 'downloading'
      this._progress = {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total
      }
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        info: this._versionInfo // 使用已保存的版本信息
      })
      eventBus.sendToRenderer(UPDATE_EVENTS.PROGRESS, SendTarget.ALL_WINDOWS, this._progress)
    })

    // 下载完成
    autoUpdater.on('update-downloaded', (info) => {
      console.log('更新下载完成', info)
      this._lock = false
      this._status = 'downloaded'

      // 写入更新标记文件
      this.writeUpdateMarker(this._versionInfo?.version || info.version)

      // 确保保存完整的更新信息
      console.log('使用已保存的版本信息:', this._versionInfo)

      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        info: this._versionInfo // 使用已保存的版本信息
      })
    })

    // 监听应用获得焦点事件
    eventBus.on(WINDOW_EVENTS.APP_FOCUS, this.handleAppFocus.bind(this))

    // 应用启动时检查是否有未完成的更新
    this.checkPendingUpdate()
  }

  // 检查是否有未完成的自动更新
  private checkPendingUpdate(): void {
    try {
      if (fs.existsSync(this._updateMarkerPath)) {
        const content = fs.readFileSync(this._updateMarkerPath, 'utf8')
        const updateInfo = JSON.parse(content)
        const currentVersion = app.getVersion()
        console.log('检查未完成的更新', updateInfo, currentVersion)

        // 如果当前版本与目标版本相同，说明更新已完成
        if (updateInfo.version === currentVersion) {
          // 删除标记文件
          fs.unlinkSync(this._updateMarkerPath)
          return
        }

        // 否则说明上次更新失败，标记为错误状态
        console.log('检测到未完成的更新', updateInfo.version)
        this._status = 'error'
        this._error = '上次自动更新未完成'
        this._versionInfo = updateInfo
        this._previousUpdateFailed = true // 标记上次更新失败

        // 删除标记文件
        fs.unlinkSync(this._updateMarkerPath)

        // 通知渲染进程
        eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
          status: this._status,
          error: this._error,
          info: {
            version: updateInfo.version,
            releaseDate: updateInfo.releaseDate,
            releaseNotes: updateInfo.releaseNotes,
            githubUrl: updateInfo.githubUrl,
            downloadUrl: updateInfo.downloadUrl
          }
        })
      }
    } catch (error) {
      console.error('检查未完成更新失败', error)
      // 出错时尝试删除标记文件
      try {
        if (fs.existsSync(this._updateMarkerPath)) {
          fs.unlinkSync(this._updateMarkerPath)
        }
      } catch (e) {
        console.error('删除更新标记文件失败', e)
      }
    }
  }

  // 写入更新标记文件
  private writeUpdateMarker(version: string): void {
    try {
      const updateInfo = {
        version,
        releaseDate: this._versionInfo?.releaseDate || '',
        releaseNotes: this._versionInfo?.releaseNotes || '',
        githubUrl: this._versionInfo?.githubUrl || '',
        downloadUrl: this._versionInfo?.downloadUrl || '',
        timestamp: Date.now()
      }

      fs.writeFileSync(this._updateMarkerPath, JSON.stringify(updateInfo, null, 2), 'utf8')
      console.log('写入更新标记文件成功', this._updateMarkerPath)
    } catch (error) {
      console.error('写入更新标记文件失败', error)
    }
  }

  // 处理应用获得焦点事件
  private handleAppFocus(): void {
    const now = Date.now()
    const twelveHoursInMs = 12 * 60 * 60 * 1000 // 12小时的毫秒数
    // 如果距离上次检查更新超过12小时，则重新检查
    if (now - this._lastCheckTime > twelveHoursInMs) {
      this.checkUpdate('autoCheck')
    }
  }

  /**
   *
   * @param type 检查更新的类型，'autoCheck'表示自动检查
   *            如果不传则默认为手动检查
   * @returns
   */
  async checkUpdate(type?: string): Promise<void> {
    if (this._lock) {
      return
    }

    try {
      this._status = 'checking'
      this._lastCheckType = type
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status
      })

      const rawChannel = this._configPresenter.getUpdateChannel()
      autoUpdater.allowPrerelease = rawChannel === 'canary'
      if (process.platform === 'darwin') {
        autoUpdater.channel = process.arch === 'arm64' ? 'arm64' : 'x64'
      }

      // 更新上次检查时间
      this._lastCheckTime = Date.now()

      // 使用electron-updater检查更新，但不自动下载
      await autoUpdater.checkForUpdates()
    } catch (error: Error | unknown) {
      this._status = 'error'
      this._error = error instanceof Error ? error.message : String(error)
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        error: this._error
      })
    }
  }

  getUpdateStatus() {
    return {
      status: this._status,
      progress: this._progress,
      error: this._error,
      updateInfo: this._versionInfo
        ? {
            version: this._versionInfo.version,
            releaseDate: this._versionInfo.releaseDate,
            releaseNotes: this._versionInfo.releaseNotes,
            githubUrl: this._versionInfo.githubUrl,
            downloadUrl: this._versionInfo.downloadUrl
          }
        : null
    }
  }

  async goDownloadUpgrade(type: 'github' | 'netdisk'): Promise<void> {
    if (type === 'github') {
      const url = this._versionInfo?.githubUrl
      if (url) {
        shell.openExternal(url)
      }
    } else if (type === 'netdisk') {
      const url = this._versionInfo?.downloadUrl
      if (url) {
        shell.openExternal(url)
      }
    }
  }

  // 开始下载更新（如果手动触发）
  startDownloadUpdate(): boolean {
    if (this._status !== 'available') {
      return false
    }
    try {
      this._status = 'downloading'
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        info: this._versionInfo // 使用已保存的版本信息
      })
      autoUpdater.downloadUpdate()
      return true
    } catch (error: Error | unknown) {
      this._status = 'error'
      this._error = error instanceof Error ? error.message : String(error)
      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        error: this._error
      })
      return false
    }
  }

  // Execute quit and install update for all platforms
  private _doQuitAndInstall(): void {
    console.log('Preparing to quit and install update')
    try {
      // Send restart notification to all windows
      eventBus.sendToRenderer(UPDATE_EVENTS.WILL_RESTART, SendTarget.ALL_WINDOWS)

      // Set flags to prevent lifecycle and window management interference
      console.log('Update installation: setting application state for proper quit behavior')
      this.setUpdatingFlag(true)
      eventBus.sendToMain(WINDOW_EVENTS.SET_APPLICATION_QUITTING, { isQuitting: true })

      // Platform-specific quit and install behavior
      if (process.platform === 'darwin') {
        console.log('macOS update: calling quitAndInstall with forceRunAfter=true')
        // Delay to ensure message delivery completion
        setTimeout(() => {
          autoUpdater.quitAndInstall(false, true) // silent=false, forceRunAfter=true
        }, 500)
      } else {
        console.log(`${process.platform} update: calling quitAndInstall`)
        // For Windows/Linux, still use shorter delay but same approach
        setTimeout(() => {
          autoUpdater.quitAndInstall()
        }, 500)
      }

      // Force quit if installation doesn't complete within 30 seconds
      setTimeout(() => {
        console.log('Update installation timeout, force quit')
        app.quit() // Exit trigger: upgrade
      }, 30000)
    } catch (e) {
      console.error('Failed to quit and install update', e)
      this.setUpdatingFlag(false)

      // Reset application quitting state on error
      console.log('Resetting application quitting flag after update error')
      eventBus.sendToMain(WINDOW_EVENTS.SET_APPLICATION_QUITTING, { isQuitting: false })

      eventBus.sendToRenderer(UPDATE_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // 重启并更新
  restartToUpdate(): boolean {
    console.log('重启并更新')
    if (this._status !== 'downloaded') {
      eventBus.sendToRenderer(UPDATE_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        error: '更新尚未下载完成'
      })
      return false
    }
    try {
      this._doQuitAndInstall()
      return true
    } catch (e) {
      console.error('重启更新失败', e)
      eventBus.sendToRenderer(UPDATE_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        error: e instanceof Error ? e.message : String(e)
      })
      return false
    }
  }

  // 重启应用
  restartApp(): void {
    try {
      // 发送即将重启的消息
      eventBus.sendToRenderer(UPDATE_EVENTS.WILL_RESTART, SendTarget.ALL_WINDOWS)
      // 给UI层一点时间保存状态
      setTimeout(() => {
        app.relaunch()
        app.exit()
      }, 1000)
    } catch (e) {
      console.error('重启失败', e)
      eventBus.sendToRenderer(UPDATE_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  private buildVersionInfo(info: UpdateInfo, releaseNotes: string): VersionInfo {
    const version = info.version
    return {
      version,
      releaseDate: info.releaseDate ? String(info.releaseDate) : '',
      releaseNotes,
      githubUrl: getReleasePageUrl(version)
    }
  }

  private async refreshReleaseNotes(info: UpdateInfo): Promise<void> {
    try {
      const changelog = await this.fetchChangelog(info.version)
      if (!this._versionInfo) {
        this._versionInfo = this.buildVersionInfo(info, changelog)
      } else {
        this._versionInfo.releaseNotes = changelog
      }

      eventBus.sendToRenderer(UPDATE_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        status: this._status,
        info: this._versionInfo
      })
    } catch (error) {
      console.error('获取更新日志失败', error)
    }
  }

  private async fetchChangelog(version: string): Promise<string> {
    const url = getChangelogUrl(version)
    try {
      const response = await axios.get<string>(url, {
        timeout: 15000,
        responseType: 'text',
        validateStatus: (status) => status >= 200 && status < 300
      })

      const content = typeof response.data === 'string' ? response.data.trim() : ''
      if (content.length > 0) {
        return content
      }
    } catch (error) {
      console.warn('changelog not found', error)
    }

    const fallbackUrl = getReleasePageUrl(version)
    return `Release notes are not available yet. [View release page](${fallbackUrl}).`
  }

  // Set update flag and broadcast state
  private setUpdatingFlag(updating: boolean): void {
    this._isUpdating = updating
    // Broadcast update state to lifecycle manager
    eventBus.sendToMain(UPDATE_EVENTS.STATE_CHANGED, { isUpdating: updating })
  }

  // Get update flag
  isUpdatingInProgress(): boolean {
    return this._isUpdating
  }
}
