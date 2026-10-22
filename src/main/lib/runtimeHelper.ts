import logger from '@shared/logger'
import { app } from 'electron'
import * as path from 'path'

/**
 * Utilities for environment paths and platform-specific installation locations.
 */
export class RuntimeHelper {
  private static instance: RuntimeHelper | null = null

  private constructor() {
    // Private constructor to enforce singleton pattern
  }

  /**
   * Get the singleton instance of RuntimeHelper
   */
  public static getInstance(): RuntimeHelper {
    if (!RuntimeHelper.instance) {
      RuntimeHelper.instance = new RuntimeHelper()
    }
    return RuntimeHelper.instance
  }

  /**
   * Expand various symbols and variables in paths
   * @param inputPath Input path that may contain ~ or environment variables
   * @returns Expanded path
   */
  public expandPath(inputPath: string): string {
    let expandedPath = inputPath

    // Handle ~ symbol (user home directory)
    if (expandedPath.startsWith('~/') || expandedPath === '~') {
      const homeDir = app.getPath('home')
      expandedPath = expandedPath.replace('~', homeDir)
    }

    // Handle environment variable expansion
    expandedPath = expandedPath.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || match
    })

    // Handle simple $VAR format (without braces)
    expandedPath = expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
      return process.env[varName] || match
    })

    return expandedPath
  }

  /**
   * Get system-specific default paths
   * @param homeDir User home directory
   * @returns Array of default system paths
   */
  public getDefaultPaths(homeDir: string): string[] {
    if (process.platform === 'darwin') {
      return [
        '/bin',
        '/usr/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/opt/node/bin',
        '/opt/local/bin',
        `${homeDir}/.cargo/bin`
      ]
    } else if (process.platform === 'linux') {
      return ['/bin', '/usr/bin', '/usr/local/bin', `${homeDir}/.cargo/bin`]
    } else {
      // Windows
      return [`${homeDir}\\.cargo\\bin`, `${homeDir}\\.local\\bin`]
    }
  }

  /**
   * Check if the application is installed in a Windows system directory
   * System directories include Program Files and Program Files (x86)
   * @returns true if installed in system directory, false otherwise
   */
  public isInstalledInSystemDirectory(): boolean {
    if (process.platform !== 'win32') {
      return false
    }

    const appPath = app.getAppPath()
    const normalizedPath = appPath.toLowerCase()

    // Check if app is installed in Program Files or Program Files (x86)
    const isSystemDir =
      normalizedPath.includes('program files') || normalizedPath.includes('program files (x86)')

    if (isSystemDir) {
      logger.info('[RuntimeHelper] Application is installed in system directory:', appPath)
    }

    return isSystemDir
  }

  /**
   * Get user npm prefix path for Windows
   * Returns the path where npm should install global packages when app is in system directory
   * @returns User npm prefix path or null if not applicable
   */
  public getUserNpmPrefix(): string | null {
    if (process.platform !== 'win32') {
      return null
    }

    const appDataPath = app.getPath('appData')
    return path.join(appDataPath, 'npm')
  }
}
