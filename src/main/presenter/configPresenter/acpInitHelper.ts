import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { type WebContents, app } from 'electron'
import type { AcpBuiltinAgentId, AcpAgentConfig, AcpAgentProfile } from '@shared/presenter'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { getShellEnvironment } from '../llmProviderPresenter/agent/shellEnvHelper'

const execAsync = promisify(exec)

interface InitCommandConfig {
  commands: string[]
  description: string
}

interface ExternalDependency {
  name: string
  description: string
  platform?: string[]
  checkCommand?: string
  checkPaths?: string[]
  installCommands?: {
    winget?: string
    chocolatey?: string
    scoop?: string
  }
  downloadUrl?: string
  requiredFor?: string[]
}

const EXTERNAL_DEPENDENCIES: ExternalDependency[] = [
  {
    name: 'Git Bash',
    description: 'Git for Windows includes Git Bash',
    platform: ['win32'],
    checkCommand: 'git --version',
    checkPaths: [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ],
    installCommands: {
      winget: 'winget install Git.Git',
      chocolatey: 'choco install git',
      scoop: 'scoop install git'
    },
    downloadUrl: 'https://git-scm.com/download/win',
    requiredFor: ['claude-code-acp']
  }
]

const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  'kimi-cli': {
    commands: ['uv tool install --python 3.13 kimi-cli', 'kimi'],
    description: 'Initialize Kimi CLI'
  },
  'claude-code-acp': {
    commands: [
      'npm i -g @zed-industries/claude-code-acp',
      'npm install -g @anthropic-ai/claude-code',
      'claude'
    ],
    description: 'Initialize Claude Code ACP'
  },
  'codex-acp': {
    commands: ['npm i -g @zed-industries/codex-acp', 'npm install -g @openai/codex', 'codex'],
    description: 'Initialize Codex CLI ACP'
  }
}

class AcpInitHelper {
  private activeShell: IPty | null = null
  private readonly runtimeHelper = RuntimeHelper.getInstance()

  constructor() {
    this.runtimeHelper.initializeRuntimes()
  }

  /**
   * Get or create the temporary directory for ACP agent shell sessions
   */
  private getAcpTempDir(): string {
    const userDataPath = app.getPath('userData')
    const acpTempDir = path.join(userDataPath, 'temp', 'acp-agents')

    try {
      fs.mkdirSync(acpTempDir, { recursive: true })
      console.log('[ACP Init] ACP temp directory:', acpTempDir)
    } catch (error) {
      console.error('[ACP Init] Failed to create ACP temp directory:', error)
      // Fallback to process.cwd() if directory creation fails
      return process.cwd()
    }

    return acpTempDir
  }

  /**
   * Check if an external dependency is available
   */
  private async checkExternalDependency(dep: ExternalDependency): Promise<boolean> {
    const platform = process.platform

    // Check if dependency supports current platform
    if (dep.platform && !dep.platform.includes(platform)) {
      console.log(`[ACP Init] Dependency ${dep.name} not required on platform ${platform}`)
      return true // Not required on this platform, consider it available
    }

    // Method 1: Check via command
    if (dep.checkCommand) {
      try {
        const { stdout } = await execAsync(dep.checkCommand, { timeout: 5000 })
        if (stdout && stdout.trim().length > 0) {
          console.log(`[ACP Init] Dependency ${dep.name} found via command: ${dep.checkCommand}`)
          return true
        }
      } catch {
        console.log(`[ACP Init] Dependency ${dep.name} not found via command: ${dep.checkCommand}`)
      }
    }

    // Method 2: Check via paths
    if (dep.checkPaths && dep.checkPaths.length > 0) {
      for (const checkPath of dep.checkPaths) {
        try {
          if (fs.existsSync(checkPath)) {
            console.log(`[ACP Init] Dependency ${dep.name} found at path: ${checkPath}`)
            return true
          }
        } catch {
          // Continue checking other paths
        }
      }
    }

    // Method 3: Use system tools to find command
    if (dep.checkCommand) {
      try {
        const commandName = dep.checkCommand.split(' ')[0]
        let findCommand: string

        if (platform === 'win32') {
          findCommand = `where.exe ${commandName}`
        } else {
          findCommand = `which ${commandName}`
        }

        const { stdout } = await execAsync(findCommand, { timeout: 5000 })
        if (stdout && stdout.trim().length > 0) {
          console.log(`[ACP Init] Dependency ${dep.name} found via system tool: ${findCommand}`)
          return true
        }
      } catch {
        // Command not found
      }
    }

    console.log(`[ACP Init] Dependency ${dep.name} not found`)
    return false
  }

  /**
   * Check required dependencies for an agent
   */
  private async checkRequiredDependencies(agentId: string): Promise<ExternalDependency[]> {
    const platform = process.platform
    const missingDeps: ExternalDependency[] = []

    // Find dependencies required for this agent
    const requiredDeps = EXTERNAL_DEPENDENCIES.filter(
      (dep) => dep.requiredFor && dep.requiredFor.includes(agentId)
    )

    console.log(`[ACP Init] Checking dependencies for agent ${agentId}:`, {
      totalDeps: requiredDeps.length,
      platform
    })

    // Check each dependency
    for (const dep of requiredDeps) {
      const isAvailable = await this.checkExternalDependency(dep)
      if (!isAvailable) {
        missingDeps.push(dep)
        console.log(`[ACP Init] Missing dependency: ${dep.name}`)
      }
    }

    return missingDeps
  }

  /**
   * Initialize a builtin ACP agent with terminal output streaming
   */
  async initializeBuiltinAgent(
    agentId: AcpBuiltinAgentId,
    profile: AcpAgentProfile,
    useBuiltinRuntime: boolean,
    npmRegistry: string | null,
    uvRegistry: string | null,
    webContents?: WebContents
  ): Promise<IPty | null> {
    console.log('[ACP Init] Initializing builtin agent:', {
      agentId,
      useBuiltinRuntime,
      npmRegistry,
      uvRegistry,
      hasWebContents: !!webContents,
      profileName: profile.name
    })

    // Check external dependencies before initialization
    const missingDeps = await this.checkRequiredDependencies(agentId)
    if (missingDeps.length > 0) {
      console.log('[ACP Init] Missing dependencies detected, blocking initialization:', {
        agentId,
        missingCount: missingDeps.length
      })
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('external-deps-required', {
          agentId,
          missingDeps
        })
      }
      // Stop initialization - user must install dependencies first
      return null
    }

    const initConfig = BUILTIN_INIT_COMMANDS[agentId]
    if (!initConfig) {
      console.error('[ACP Init] Unknown builtin agent:', agentId)
      throw new Error(`Unknown builtin agent: ${agentId}`)
    }

    console.log('[ACP Init] Agent config:', {
      description: initConfig.description,
      commands: initConfig.commands
    })

    const envVars = await this.buildEnvironmentVariables(
      profile,
      useBuiltinRuntime,
      npmRegistry,
      uvRegistry
    )

    const commands = initConfig.commands
    console.log('[ACP Init] Starting interactive session with commands:', commands)
    return this.startInteractiveSession(commands, envVars, webContents)
  }

  /**
   * Initialize a custom ACP agent with terminal output streaming
   */
  async initializeCustomAgent(
    agent: AcpAgentConfig,
    useBuiltinRuntime: boolean,
    npmRegistry: string | null,
    uvRegistry: string | null,
    webContents?: WebContents
  ): Promise<IPty | null> {
    console.log('[ACP Init] Initializing custom agent:', {
      name: agent.name,
      command: agent.command,
      args: agent.args,
      useBuiltinRuntime,
      npmRegistry,
      uvRegistry,
      hasWebContents: !!webContents
    })

    const envVars = await this.buildEnvironmentVariables(
      agent,
      useBuiltinRuntime,
      npmRegistry,
      uvRegistry
    )

    // For custom agents, use the configured command
    const command = agent.command
    const args = agent.args || []
    const fullCommandStr = [command, ...args].join(' ')

    console.log('[ACP Init] Starting interactive session with custom command:', fullCommandStr)
    return this.startInteractiveSession([fullCommandStr], envVars, webContents)
  }

  writeToTerminal(data: string) {
    if (this.activeShell) {
      try {
        console.log('[ACP Init] Writing to terminal:', {
          dataLength: data.length,
          dataPreview: data.substring(0, 50)
        })
        this.activeShell.write(data)
      } catch (error) {
        console.warn('[ACP Init] Cannot write to terminal:', error)
      }
    } else {
      console.warn('[ACP Init] Cannot write to terminal - shell not available')
    }
  }

  killTerminal() {
    if (this.activeShell) {
      console.log('[ACP Init] Killing active shell process:', {
        pid: this.activeShell.pid
      })
      try {
        this.activeShell.kill()
      } catch (error) {
        console.warn('[ACP Init] Error killing shell:', error)
      }
      this.activeShell = null
      console.log('[ACP Init] Shell process killed')
    } else {
      console.log('[ACP Init] No active shell to kill')
    }
  }

  /**
   * Start an interactive shell session
   */
  private startInteractiveSession(
    initCommands: string[],
    envVars: Record<string, string>,
    webContents?: WebContents
  ): IPty | null {
    console.log('[ACP Init] Starting interactive session:', {
      commands: initCommands,
      envVarCount: Object.keys(envVars).length,
      hasWebContents: !!webContents
    })

    if (!webContents || webContents.isDestroyed()) {
      console.error('[ACP Init] Cannot start session - webContents invalid or destroyed')
      return null
    }

    // Kill existing shell if any
    this.killTerminal()

    // Get temporary directory for ACP agent shell session
    const workDir = this.getAcpTempDir()

    const platform = process.platform
    let shell: string
    let shellArgs: string[] = []

    if (platform === 'win32') {
      shell = 'powershell.exe'
      shellArgs = ['-NoLogo', '-ExecutionPolicy', 'Bypass']
    } else {
      // Use user's default shell or bash/zsh
      shell = process.env.SHELL || '/bin/bash'
      // Force interactive mode for bash/zsh to get prompt and aliases
      if (shell.endsWith('bash') || shell.endsWith('zsh')) {
        shellArgs = ['-i']
      }
    }

    console.log('[ACP Init] Spawning shell with PTY:', {
      platform,
      shell,
      shellArgs,
      cwd: workDir
    })

    // Spawn PTY process
    const pty = spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env: { ...process.env, ...envVars } as Record<string, string>
    })

    console.log('[ACP Init] PTY process spawned:', {
      pid: pty.pid
    })

    this.activeShell = pty

    // Track shell readiness for command injection
    let shellReady = false
    let outputBuffer = ''
    let commandInjected = false
    const maxWaitTime = 3000 // Maximum wait time for shell ready (3 seconds)
    const startTime = Date.now()

    // Handle PTY output (PTY combines stdout and stderr into a single stream)
    pty.onData((data: string) => {
      outputBuffer += data

      console.log('[ACP Init] PTY data:', {
        length: data.length,
        preview: data.substring(0, 100).replace(/\n/g, '\\n'),
        shellReady,
        commandInjected
      })

      // Detect shell readiness by looking for prompt patterns or any meaningful output
      if (!shellReady && outputBuffer.length > 0) {
        // Check for common shell prompt patterns or any non-empty output
        const hasPromptPattern =
          /[$#>]\s*$/.test(outputBuffer) || outputBuffer.includes('\n') || outputBuffer.length > 10

        if (hasPromptPattern || Date.now() - startTime > 500) {
          shellReady = true
          console.log('[ACP Init] Shell detected as ready, output length:', outputBuffer.length)
        }
      }

      // Send output to renderer (PTY output is treated as stdout)
      if (!webContents.isDestroyed()) {
        webContents.send('acp-init:output', { type: 'stdout', data })
      }

      // Inject command once shell is ready
      if (shellReady && !commandInjected && initCommands.length > 0) {
        commandInjected = true
        const separator = platform === 'win32' ? ';' : '&&'
        const initCmd = initCommands.join(` ${separator} `)

        console.log('[ACP Init] Injecting initialization command (shell ready):', {
          command: initCmd,
          outputBufferLength: outputBuffer.length
        })

        // Small delay to ensure shell is fully ready
        setTimeout(() => {
          try {
            pty.write(initCmd + '\n')
            console.log('[ACP Init] Command written to PTY')
          } catch (error) {
            console.warn('[ACP Init] Error writing command to PTY:', error)
          }
        }, 100)
      }
    })

    // Handle process exit
    pty.onExit(({ exitCode, signal }) => {
      console.log('[ACP Init] Process exited:', {
        pid: pty.pid,
        code: exitCode,
        signal,
        commandInjected
      })
      if (!webContents.isDestroyed()) {
        webContents.send('acp-init:exit', { code: exitCode, signal: signal || null })
      }
      if (this.activeShell === pty) {
        this.activeShell = null
        console.log('[ACP Init] Active shell cleared')
      }
    })

    // Delay sending start event to ensure renderer listeners are set up
    // Also inject command if shell doesn't become ready within timeout
    setTimeout(() => {
      if (!webContents.isDestroyed()) {
        console.log('[ACP Init] Sending start event (delayed to ensure listeners ready)')
        webContents.send('acp-init:start', { command: shell })
      }

      // Fallback: inject command if shell hasn't become ready yet
      if (!commandInjected && initCommands.length > 0 && Date.now() - startTime < maxWaitTime) {
        console.log('[ACP Init] Fallback: injecting command after delay (shell may be ready)')
        commandInjected = true
        const separator = platform === 'win32' ? ';' : '&&'
        const initCmd = initCommands.join(` ${separator} `)

        setTimeout(() => {
          try {
            pty.write(initCmd + '\n')
            console.log('[ACP Init] Fallback command written to PTY')
          } catch (error) {
            console.warn('[ACP Init] Error writing fallback command to PTY:', error)
          }
        }, 200)
      }
    }, 500) // Delay to ensure renderer listeners are set up

    return pty
  }

  /**
   * Build environment variables for the terminal
   */
  private async buildEnvironmentVariables(
    profile: AcpAgentProfile | AcpAgentConfig,
    useBuiltinRuntime: boolean,
    npmRegistry: string | null,
    uvRegistry: string | null
  ): Promise<Record<string, string>> {
    console.log('[ACP Init] Building environment variables:', {
      useBuiltinRuntime,
      npmRegistry,
      uvRegistry,
      hasProfileEnv: !!(profile.env && Object.keys(profile.env).length > 0)
    })

    const env: Record<string, string> = {}

    // Add system environment variables
    const systemEnvCount = Object.entries(process.env).filter(
      ([, value]) => value !== undefined && value !== ''
    ).length
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        env[key] = value
      }
    })
    console.log('[ACP Init] Added system environment variables:', systemEnvCount)

    // Merge shell environment (includes user PATH from shell startup)
    const pathKeys = ['PATH', 'Path', 'path']
    const existingPaths: string[] = []
    pathKeys.forEach((key) => {
      const value = env[key]
      if (value) existingPaths.push(value)
    })

    try {
      const shellEnv = await getShellEnvironment()
      Object.entries(shellEnv).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && !pathKeys.includes(key)) {
          env[key] = value
        }
      })
      const shellPath = shellEnv.PATH || shellEnv.Path || shellEnv.path
      if (shellPath) {
        existingPaths.unshift(shellPath)
      }
    } catch (error) {
      console.warn('[ACP Init] Failed to merge shell environment variables:', error)
    }

    // Prepare PATH merging
    const HOME_DIR = app.getPath('home')
    const defaultPaths = this.runtimeHelper.getDefaultPaths(HOME_DIR)
    const allPaths = [...existingPaths, ...defaultPaths]

    // Add runtime paths to PATH if using builtin runtime
    if (useBuiltinRuntime) {
      const runtimePaths: string[] = []

      const uvRuntimePath = this.runtimeHelper.getUvRuntimePath()
      const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()

      if (uvRuntimePath) {
        runtimePaths.push(uvRuntimePath)
        console.log('[ACP Init] Added UV runtime path:', uvRuntimePath)
      }

      if (process.platform === 'win32') {
        if (nodeRuntimePath) {
          runtimePaths.push(nodeRuntimePath)
          console.log('[ACP Init] Added Node runtime path (Windows):', nodeRuntimePath)
        }
      } else {
        if (nodeRuntimePath) {
          const nodeBinPath = path.join(nodeRuntimePath, 'bin')
          runtimePaths.push(nodeBinPath)
          console.log('[ACP Init] Added Node runtime path (Unix):', nodeBinPath)
        }
      }

      if (runtimePaths.length > 0) {
        allPaths.unshift(...runtimePaths)
      } else {
        console.warn('[ACP Init] No runtime paths available to add to PATH')
      }
    }

    // Normalize and set PATH
    const normalizedPath = this.runtimeHelper.normalizePathEnv(allPaths)
    env[normalizedPath.key] = normalizedPath.value

    // Add registry environment variables if using builtin runtime
    if (useBuiltinRuntime) {
      if (npmRegistry && npmRegistry !== '') {
        env.npm_config_registry = npmRegistry
        env.NPM_CONFIG_REGISTRY = npmRegistry
        console.log('[ACP Init] Set NPM registry:', npmRegistry)
      }

      if (uvRegistry && uvRegistry !== '') {
        env.UV_DEFAULT_INDEX = uvRegistry
        env.PIP_INDEX_URL = uvRegistry
        console.log('[ACP Init] Set UV registry:', uvRegistry)
      }

      // On Windows, if app is installed in system directory, set npm prefix to user directory
      // to avoid permission issues when installing global packages
      if (process.platform === 'win32' && this.runtimeHelper.isInstalledInSystemDirectory()) {
        const userNpmPrefix = this.runtimeHelper.getUserNpmPrefix()

        if (userNpmPrefix) {
          env.npm_config_prefix = userNpmPrefix
          env.NPM_CONFIG_PREFIX = userNpmPrefix
          console.log(
            '[ACP Init] Set NPM prefix to user directory (system install detected):',
            userNpmPrefix
          )

          // Add user npm bin directory to PATH
          const pathKey = 'Path'
          const separator = ';'
          const existingPath = env[pathKey] || ''
          const userNpmBinPath = userNpmPrefix

          // Ensure the user npm bin path is at the beginning of PATH
          if (existingPath) {
            env[pathKey] = [userNpmBinPath, existingPath].filter(Boolean).join(separator)
          } else {
            env[pathKey] = userNpmBinPath
          }

          console.log('[ACP Init] Added user npm bin directory to PATH:', userNpmBinPath)
        }
      }
    }

    // Add custom environment variables from profile
    if (profile.env) {
      const customEnvCount = Object.entries(profile.env).filter(
        ([, value]) => value !== undefined && value !== ''
      ).length
      Object.entries(profile.env).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          if (['PATH', 'Path', 'path'].includes(key)) {
            // Merge PATH variables
            const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
            const separator = process.platform === 'win32' ? ';' : ':'
            const existingPath = env[pathKey] || env[normalizedPath.key] || ''
            env[pathKey] = [value, existingPath].filter(Boolean).join(separator)
            console.log('[ACP Init] Merged custom PATH from profile:', {
              customPath: value,
              mergedPathLength: env[pathKey].length
            })
          } else {
            env[key] = value
            console.log('[ACP Init] Added custom env var:', key)
          }
        }
      })
      console.log('[ACP Init] Added custom environment variables from profile:', customEnvCount)
    }

    console.log('[ACP Init] Environment variables built:', {
      totalEnvVars: Object.keys(env).length,
      pathLength: env[process.platform === 'win32' ? 'Path' : 'PATH']?.length || 0
    })

    return env
  }
}

// Export helper functions
let initHelperInstance: AcpInitHelper | null = null

function getInitHelper(): AcpInitHelper {
  if (!initHelperInstance) {
    initHelperInstance = new AcpInitHelper()
  }
  return initHelperInstance
}

export async function initializeBuiltinAgent(
  agentId: AcpBuiltinAgentId,
  profile: AcpAgentProfile,
  useBuiltinRuntime: boolean,
  npmRegistry: string | null,
  uvRegistry: string | null,
  webContents?: WebContents
): Promise<IPty | null> {
  return getInitHelper().initializeBuiltinAgent(
    agentId,
    profile,
    useBuiltinRuntime,
    npmRegistry,
    uvRegistry,
    webContents
  )
}

export async function initializeCustomAgent(
  agent: AcpAgentConfig,
  useBuiltinRuntime: boolean,
  npmRegistry: string | null,
  uvRegistry: string | null,
  webContents?: WebContents
): Promise<IPty | null> {
  return getInitHelper().initializeCustomAgent(
    agent,
    useBuiltinRuntime,
    npmRegistry,
    uvRegistry,
    webContents
  )
}

export function writeToTerminal(data: string): void {
  getInitHelper().writeToTerminal(data)
}

export function killTerminal(): void {
  getInitHelper().killTerminal()
}
