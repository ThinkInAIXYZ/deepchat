import logger from '@shared/logger'
import type { DeviceInfo, DeviceServicePort, DiskInfo, MemoryInfo } from '@shared/types/device'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { app, dialog } from 'electron'
import { svgSanitizer } from '../lib/svgSanitizer'
import { cacheImage } from '@/platform/imageCache'
const execAsync = promisify(exec)

export class DeviceService implements DeviceServicePort {
  static getDefaultHeaders(): Record<string, string> {
    const version = app.getVersion()
    return {
      'HTTP-Referer': 'https://deepchatai.cn',
      'X-Title': 'DeepChat',
      'User-Agent': `DeepChat/${version}`
    }
  }
  async getAppVersion(): Promise<string> {
    return app.getVersion()
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const platform = process.platform
    const osVersion = os.release()

    // Build version metadata based on current platform
    let osVersionMetadata: Array<{ name: string; build: number }> = []

    if (platform === 'win32') {
      osVersionMetadata = [
        { name: 'Windows 11', build: 22000 },
        { name: 'Windows 10', build: 10240 },
        { name: 'Windows 8.1', build: 9600 },
        { name: 'Windows 8', build: 9200 }
      ]
    } else if (platform === 'darwin') {
      osVersionMetadata = [
        { name: 'macOS Tahoe', build: 25 },
        { name: 'macOS Sequoia', build: 24 },
        { name: 'macOS Sonoma', build: 23 },
        { name: 'macOS Ventura', build: 22 },
        { name: 'macOS Monterey', build: 21 },
        { name: 'macOS Big Sur', build: 20 }
      ]
    }

    return {
      platform,
      arch: process.arch,
      cpuModel: os.cpus()[0].model,
      totalMemory: os.totalmem(),
      osVersion,
      osVersionMetadata
    }
  }

  async getCPUUsage(): Promise<number> {
    const startMeasure = os.cpus().map((cpu) => cpu.times)

    // Wait for 100ms to get a meaningful CPU usage measurement
    await new Promise((resolve) => setTimeout(resolve, 100))

    const endMeasure = os.cpus().map((cpu) => cpu.times)

    const idleDifferences = endMeasure.map((end, i) => {
      const start = startMeasure[i]
      const idle = end.idle - start.idle
      const total =
        end.user -
        start.user +
        (end.nice - start.nice) +
        (end.sys - start.sys) +
        (end.irq - start.irq) +
        idle
      return 1 - idle / total
    })

    // Return average CPU usage across all cores
    return (idleDifferences.reduce((sum, idle) => sum + idle, 0) / idleDifferences.length) * 100
  }

  async getMemoryUsage(): Promise<MemoryInfo> {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free

    return {
      total,
      free,
      used
    }
  }

  async getDiskSpace(): Promise<DiskInfo> {
    if (process.platform === 'win32') {
      // Windows implementation
      const { stdout } = await execAsync('wmic logicaldisk get size,freespace')
      const lines = stdout.trim().split('\n').slice(1)
      let total = 0
      let free = 0

      lines.forEach((line) => {
        const [freeSpace, size] = line.trim().split(/\s+/).map(Number)
        if (!isNaN(freeSpace) && !isNaN(size)) {
          free += freeSpace
          total += size
        }
      })

      return {
        total,
        free,
        used: total - free
      }
    } else {
      // Unix-like systems implementation
      const { stdout } = await execAsync('df -k /')
      const [, line] = stdout.trim().split('\n')
      const [, total, , used, free] = line.split(/\s+/)

      return {
        total: parseInt(total) * 1024,
        free: parseInt(free) * 1024,
        used: parseInt(used) * 1024
      }
    }
  }

  /**
   * 缓存图片到本地文件系统
   * @param imageData 图片数据，可以是URL或Base64编码
   * @returns 返回以imgcache://协议的图片URL或原始URL（下载失败时）
   */
  async cacheImage(imageData: string): Promise<string> {
    return cacheImage(imageData)
  }

  async resetData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const response = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['确认', '取消'],
        defaultId: 0,
        message: '清除本地的所有数据',
        detail: '注意本操作会导致本地记录彻底删除，你确定么？'
      })
      if (response === 0) {
        try {
          const dbPath = path.join(app.getPath('userData'), 'app_db')
          const removeDirectory = (dirPath: string): void => {
            if (fs.existsSync(dirPath)) {
              fs.readdirSync(dirPath).forEach((file) => {
                const currentPath = path.join(dirPath, file)
                if (fs.lstatSync(currentPath).isDirectory()) {
                  removeDirectory(currentPath)
                } else {
                  fs.unlinkSync(currentPath)
                }
              })
              fs.rmdirSync(dirPath)
            }
          }
          removeDirectory(dbPath)

          app.relaunch()
          app.exit()
          resolve()
        } catch (err) {
          console.error('softReset failed')
          reject(err)
          return
        }
      }
    })
  }

  /**
   * 根据类型重置数据
   * @param resetType 重置类型：'chat' | 'knowledge' | 'config' | 'all'
   */
  async resetDataByType(resetType: 'chat' | 'knowledge' | 'config' | 'all'): Promise<void> {
    try {
      const userDataPath = app.getPath('userData')

      const removeDirectory = (dirPath: string): void => {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach((file) => {
            const currentPath = path.join(dirPath, file)
            if (fs.lstatSync(currentPath).isDirectory()) {
              removeDirectory(currentPath)
            } else {
              fs.unlinkSync(currentPath)
            }
          })
          fs.rmdirSync(dirPath)
        }
      }

      const removeFile = (filePath: string): void => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      }

      switch (resetType) {
        case 'chat': {
          // 删除聊天数据
          logger.info('Resetting chat data...')
          const appDbPath = path.join(userDataPath, 'app_db')
          const mainDbFile = path.join(appDbPath, 'agent.db')
          try {
            removeFile(mainDbFile)
            logger.info('Removed chat database file')
          } catch (error) {
            console.warn('Failed to remove chat database file:', error)
          }
          const auxiliaryFiles = ['agent.db-wal', 'agent.db-shm']
          auxiliaryFiles.forEach((fileName) => {
            const filePath = path.join(appDbPath, fileName)
            if (fs.existsSync(filePath)) {
              try {
                removeFile(filePath)
                logger.info('Cleaned up auxiliary file:', fileName)
              } catch (error) {
                console.warn('Failed to clean auxiliary file:', fileName, error)
              }
            }
          })
          break
        }

        case 'knowledge': {
          // 删除知识库数据
          logger.info('Resetting knowledge base data...')
          const knowledgeDbPath = path.join(userDataPath, 'app_db', 'KnowledgeBase')
          logger.info('Removing knowledge base directory:', knowledgeDbPath)
          removeDirectory(knowledgeDbPath)
          break
        }

        case 'config': {
          // 删除配置文件
          logger.info('Resetting configuration files')
          const configFiles = [
            path.join(userDataPath, 'app-settings.json'),
            path.join(userDataPath, 'mcp-settings.json'),
            path.join(userDataPath, 'model-config.json'),
            path.join(userDataPath, 'custom_prompts.json')
          ]

          configFiles.forEach((filePath) => {
            try {
              removeFile(filePath)
              logger.info('Removed config file:', filePath)
            } catch (error) {
              console.warn('Failed to remove config file:', filePath, error)
            }
          })

          try {
            removeDirectory(path.join(userDataPath, 'provider_models'))
            logger.info('Removed provider_models directory')
          } catch (error) {
            console.warn('Failed to remove provider_models directory:', error)
          }
          break
        }

        case 'all': {
          // 删除整个用户数据目录
          logger.info('Performing complete reset of user data...')
          logger.info('Removing user data directory:', userDataPath)
          removeDirectory(userDataPath)
          break
        }

        default:
          throw new Error(`Unknown reset type: ${resetType}`)
      }

      this.restartAppWithDelay()
    } catch (error) {
      console.error('resetDataByType failed:', error)
      throw error
    }
  }

  private restartAppWithDelay(): void {
    try {
      setTimeout(() => {
        app.relaunch()
        app.exit()
      }, 1000)
    } catch (error) {
      console.error('重启失败:', error)
      throw error
    }
  }

  /**
   * 选择目录
   * @returns 返回所选目录的路径，如果用户取消则返回null
   */
  async selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
  }

  /**
   * 选择文件
   * @param options 文件选择选项
   * @returns 返回所选文件的路径，如果用户取消则返回空数组
   */
  async selectFiles(options?: {
    filters?: { name: string; extensions: string[] }[]
    multiple?: boolean
  }): Promise<{ canceled: boolean; filePaths: string[] }> {
    const properties: ('openFile' | 'multiSelections')[] = ['openFile']
    if (options?.multiple) {
      properties.push('multiSelections')
    }
    return dialog.showOpenDialog({
      properties,
      filters: options?.filters
    })
  }

  /**
   * 重启应用程序
   */
  restartApp(): Promise<void> {
    logger.info('restartApp')
    app.relaunch()
    app.exit()
    return Promise.resolve()
  }

  /**
   * 安全净化SVG内容
   * @param svgContent 原始SVG内容
   * @returns 净化后的SVG内容，如果净化失败则返回null
   */
  async sanitizeSvgContent(svgContent: string): Promise<string | null> {
    try {
      logger.info('Sanitizing SVG content, length:', svgContent.length)
      // Debug: 显示SVG前100个字符
      logger.info('SVG preview:', svgContent.substring(0, 100) + '...')

      // 使用SVG净化器处理内容
      const sanitizedContent = svgSanitizer.sanitize(svgContent)

      if (sanitizedContent) {
        logger.info('SVG content sanitized successfully, output length:', sanitizedContent.length)
        logger.info('Comments preserved:', /<!--/.test(sanitizedContent))
        return sanitizedContent
      } else {
        console.warn('SVG content was rejected by sanitizer')
        // Debug: 检查具体是哪一步失败了
        logger.info('Debug: SVG starts with <svg:', svgContent.trim().startsWith('<svg'))
        logger.info('Debug: SVG contains dangerous content:', svgContent.includes('<script'))
        return null
      }
    } catch (error) {
      console.error('Error sanitizing SVG content:', error)
      return null
    }
  }
}
