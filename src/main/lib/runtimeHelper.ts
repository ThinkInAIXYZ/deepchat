import logger from '@shared/logger'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * RuntimeHelper - Utility class for managing runtime paths and environment variables
 * Uses singleton pattern to cache runtime paths and avoid repeated filesystem checks
 */
export class RuntimeHelper {
  private static instance: RuntimeHelper | null = null
  private rtkRuntimePath: string | null = null
  private runtimesInitialized: boolean = false

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
   * Initialize runtime paths (idempotent). Only RTK is owned here; Node/uv
   * resolve through ToolchainService.
   */
  public initializeRuntimes(force: boolean = false): void {
    if (this.runtimesInitialized && !force) {
      return
    }

    if (force) {
      this.rtkRuntimePath = null
    }

    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')

    const rtkRuntimePath = path.join(runtimeBasePath, 'rtk')
    if (process.platform === 'win32') {
      const rtkExe = path.join(rtkRuntimePath, 'rtk.exe')
      if (fs.existsSync(rtkExe)) {
        this.rtkRuntimePath = rtkRuntimePath
      } else {
        this.rtkRuntimePath = null
      }
    } else {
      const rtkBin = path.join(rtkRuntimePath, 'rtk')
      if (fs.existsSync(rtkBin)) {
        this.rtkRuntimePath = rtkRuntimePath
      } else {
        this.rtkRuntimePath = null
      }
    }

    this.runtimesInitialized = true
  }

  public refreshRuntimes(): void {
    this.initializeRuntimes(true)
  }

  /**
   * Get Node.js runtime path
   * @returns Node.js runtime path or null if not found
   */
  public getNodeRuntimePath(): string | null {
    return null
  }

  public setNodeRuntimePath(_value: string | null): void {}

  /**
   * Get UV runtime path
   * @returns UV runtime path or null if not found
   */
  public getUvRuntimePath(): string | null {
    return null
  }

  public setUvRuntimePath(_value: string | null): void {}

  /**
   * Get RTK runtime path
   * @returns RTK runtime path or null if not found
   */
  public getRtkRuntimePath(): string | null {
    return this.rtkRuntimePath
  }

  public getBundledRuntimeBinPaths(): string[] {
    this.initializeRuntimes()

    const candidates: string[] = []

    if (this.rtkRuntimePath) {
      candidates.push(this.rtkRuntimePath)
    }

    const seen = new Set<string>()
    return candidates.filter((candidate) => {
      if (!candidate || !fs.existsSync(candidate)) {
        return false
      }
      const normalized = process.platform === 'win32' ? candidate.toLowerCase() : candidate
      if (seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })
  }

  public prependBundledRuntimeToEnv(env: Record<string, string>): Record<string, string> {
    const runtimePaths = this.getBundledRuntimeBinPaths()
    if (runtimePaths.length === 0) {
      return { ...env }
    }

    const separator = process.platform === 'win32' ? ';' : ':'
    const nextEnv = { ...env }
    const existingPath =
      nextEnv.PATH ||
      nextEnv.Path ||
      process.env.PATH ||
      process.env.Path ||
      this.getDefaultPaths(app.getPath('home')).join(separator)

    const entries = existingPath.split(separator).filter(Boolean)
    const seen = new Set<string>()
    const merged = [...runtimePaths, ...entries].filter((entry) => {
      const normalized = process.platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })

    const value = merged.join(separator)
    nextEnv.PATH = value
    if (process.platform === 'win32') {
      nextEnv.Path = value
    }

    return nextEnv
  }

  /**
   * Replace command with runtime version if needed
   * @param command Original command
   * @param useBuiltinRuntime Whether to use builtin runtime
   * @param checkExists Whether to check if file exists (default: true)
   * @returns Processed command path or original command
   */
  public replaceWithRuntimeCommand(
    command: string,
    useBuiltinRuntime: boolean,
    checkExists: boolean = true
  ): string {
    // If useBuiltinRuntime is false, return original command
    if (!useBuiltinRuntime) {
      return command
    }

    const basename = path.basename(command)

    // RTK command handling (all platforms)
    const normalizedRtkBasename =
      process.platform === 'win32' ? basename.toLowerCase().replace(/\.exe$/, '') : basename
    if (normalizedRtkBasename === 'rtk') {
      if (!this.rtkRuntimePath) {
        return command
      }

      if (process.platform === 'win32') {
        const rtkPath = path.join(this.rtkRuntimePath, 'rtk.exe')
        if (checkExists) {
          if (fs.existsSync(rtkPath)) {
            return rtkPath
          }
          return command
        } else {
          return rtkPath
        }
      } else {
        const rtkPath = path.join(this.rtkRuntimePath, 'rtk')
        if (checkExists) {
          if (fs.existsSync(rtkPath)) {
            return rtkPath
          }
          return command
        } else {
          return rtkPath
        }
      }
    }

    return command
  }

  /**
   * Process command and arguments with runtime replacement (for mcpClient)
   * This method does not check file existence and always tries to replace
   * @param command Original command
   * @param args Command arguments
   * @returns Processed command and arguments
   */
  public processCommandWithArgs(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    return {
      command: this.replaceWithRuntimeCommand(command, true, false),
      args: args.map((arg) => this.replaceWithRuntimeCommand(arg, true, false))
    }
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
