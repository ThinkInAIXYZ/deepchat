import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * RuntimeHelper - Utility class for managing runtime paths and environment variables
 * Uses singleton pattern to cache runtime paths and avoid repeated filesystem checks
 */
export class RuntimeHelper {
  private static instance: RuntimeHelper | null = null
  private nodeRuntimePath: string | null = null
  private uvRuntimePath: string | null = null
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
   * Initialize runtime paths (idempotent operation)
   * Caches Node.js and UV runtime paths to avoid repeated filesystem checks
   */
  public initializeRuntimes(): void {
    if (this.runtimesInitialized) {
      return
    }

    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')

    // Check if node runtime file exists
    const nodeRuntimePath = path.join(runtimeBasePath, 'node')
    if (process.platform === 'win32') {
      const nodeExe = path.join(nodeRuntimePath, 'node.exe')
      if (fs.existsSync(nodeExe)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    } else {
      const nodeBin = path.join(nodeRuntimePath, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    }

    // Check if uv runtime file exists
    const uvRuntimePath = path.join(runtimeBasePath, 'uv')
    if (process.platform === 'win32') {
      const uvExe = path.join(uvRuntimePath, 'uv.exe')
      const uvxExe = path.join(uvRuntimePath, 'uvx.exe')
      if (fs.existsSync(uvExe) && fs.existsSync(uvxExe)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    } else {
      const uvBin = path.join(uvRuntimePath, 'uv')
      const uvxBin = path.join(uvRuntimePath, 'uvx')
      if (fs.existsSync(uvBin) && fs.existsSync(uvxBin)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    }

    this.runtimesInitialized = true
  }

  /**
   * Get Node.js runtime path
   * @returns Node.js runtime path or null if not found
   */
  public getNodeRuntimePath(): string | null {
    return this.nodeRuntimePath
  }

  /**
   * Get UV runtime path
   * @returns UV runtime path or null if not found
   */
  public getUvRuntimePath(): string | null {
    return this.uvRuntimePath
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

    // Get command basename (remove path)
    const basename = path.basename(command)

    // Handle Node.js related commands (all platforms use same logic)
    if (['node', 'npm', 'npx'].includes(basename)) {
      if (this.nodeRuntimePath) {
        if (process.platform === 'win32') {
          if (basename === 'node') {
            const nodeExe = path.join(this.nodeRuntimePath, 'node.exe')
            if (checkExists) {
              if (fs.existsSync(nodeExe)) {
                return nodeExe
              }
              // If doesn't exist, return original command to let system find it via PATH
              return command
            } else {
              return nodeExe
            }
          } else if (basename === 'npm') {
            // Windows usually has npm as .cmd file
            const npmCmd = path.join(this.nodeRuntimePath, 'npm.cmd')
            if (checkExists) {
              if (fs.existsSync(npmCmd)) {
                return npmCmd
              }
              // Check if npm exists without .cmd extension
              const npmPath = path.join(this.nodeRuntimePath, 'npm')
              if (fs.existsSync(npmPath)) {
                return npmPath
              }
              // If doesn't exist, return original command to let system find it via PATH
              return command
            } else {
              // For mcpClient: return default path without checking
              if (fs.existsSync(npmCmd)) {
                return npmCmd
              }
              return path.join(this.nodeRuntimePath, 'npm')
            }
          } else if (basename === 'npx') {
            // On Windows, npx is typically a .cmd file
            const npxCmd = path.join(this.nodeRuntimePath, 'npx.cmd')
            if (checkExists) {
              if (fs.existsSync(npxCmd)) {
                return npxCmd
              }
              // Check if npx exists without .cmd extension
              const npxPath = path.join(this.nodeRuntimePath, 'npx')
              if (fs.existsSync(npxPath)) {
                return npxPath
              }
              // If doesn't exist, return original command to let system find it via PATH
              return command
            } else {
              // For mcpClient: return default path without checking
              if (fs.existsSync(npxCmd)) {
                return npxCmd
              }
              return path.join(this.nodeRuntimePath, 'npx')
            }
          }
        } else {
          // Non-Windows platforms
          let targetCommand: string
          if (basename === 'node') {
            targetCommand = 'node'
          } else if (basename === 'npm') {
            targetCommand = 'npm'
          } else if (basename === 'npx') {
            targetCommand = 'npx'
          } else {
            targetCommand = basename
          }
          const nodePath = path.join(this.nodeRuntimePath, 'bin', targetCommand)
          if (checkExists) {
            if (fs.existsSync(nodePath)) {
              return nodePath
            }
            // If doesn't exist, return original command to let system find it via PATH
            return command
          } else {
            return nodePath
          }
        }
      }
    }

    // UV command handling (all platforms)
    if (['uv', 'uvx'].includes(basename)) {
      if (!this.uvRuntimePath) {
        return command
      }

      // Both uv and uvx use their corresponding commands
      const targetCommand = basename === 'uvx' ? 'uvx' : 'uv'

      if (process.platform === 'win32') {
        const uvPath = path.join(this.uvRuntimePath, `${targetCommand}.exe`)
        if (checkExists) {
          if (fs.existsSync(uvPath)) {
            return uvPath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        } else {
          return uvPath
        }
      } else {
        const uvPath = path.join(this.uvRuntimePath, targetCommand)
        if (checkExists) {
          if (fs.existsSync(uvPath)) {
            return uvPath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        } else {
          return uvPath
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
   * Normalize PATH environment variable
   * @param paths Array of paths to merge
   * @returns Normalized PATH key-value pair
   */
  public normalizePathEnv(paths: string[]): { key: string; value: string } {
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? ';' : ':'
    const pathKey = isWindows ? 'Path' : 'PATH'
    const pathValue = paths.filter(Boolean).join(separator)
    return { key: pathKey, value: pathValue }
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
      console.log('[RuntimeHelper] Application is installed in system directory:', appPath)
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
