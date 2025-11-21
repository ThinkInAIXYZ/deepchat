import * as path from 'path'
import * as fs from 'fs'
import { app, type WebContents } from 'electron'
import type { AcpBuiltinAgentId, AcpAgentConfig, AcpAgentProfile } from '@shared/presenter'
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'

interface InitCommandConfig {
  commands: string[]
  description: string
}

const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  'kimi-cli': {
    commands: ['uv tool run --from kimi-cli kimi'],
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
    commands: ['npm i -g @zed-industries/codex-acp', 'npm install -g @openai/codex-sdk', 'codex'],
    description: 'Initialize Codex CLI ACP'
  }
}

class AcpInitHelper {
  private activeShell: IPty | null = null
  private bunRuntimePath: string | null = null
  private nodeRuntimePath: string | null = null
  private uvRuntimePath: string | null = null
  private runtimesInitialized: boolean = false

  constructor() {
    this.setupRuntimes()
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

    const initConfig = BUILTIN_INIT_COMMANDS[agentId]
    if (!initConfig) {
      console.error('[ACP Init] Unknown builtin agent:', agentId)
      throw new Error(`Unknown builtin agent: ${agentId}`)
    }

    console.log('[ACP Init] Agent config:', {
      description: initConfig.description,
      commands: initConfig.commands
    })

    const envVars = this.buildEnvironmentVariables(
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

    const envVars = this.buildEnvironmentVariables(
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

    const platform = process.platform
    let shell: string
    let shellArgs: string[] = []

    if (platform === 'win32') {
      shell = 'powershell.exe'
      shellArgs = ['-NoLogo']
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
      cwd: process.cwd()
    })

    // Spawn PTY process
    const pty = spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
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
  private buildEnvironmentVariables(
    profile: AcpAgentProfile | AcpAgentConfig,
    useBuiltinRuntime: boolean,
    npmRegistry: string | null,
    uvRegistry: string | null
  ): Record<string, string> {
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

    // Add runtime paths to PATH if using builtin runtime
    if (useBuiltinRuntime) {
      const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
      const existingPath = env[pathKey] || ''
      const separator = process.platform === 'win32' ? ';' : ':'
      const runtimePaths: string[] = []

      if (this.uvRuntimePath) {
        runtimePaths.push(this.uvRuntimePath)
        console.log('[ACP Init] Added UV runtime path:', this.uvRuntimePath)
      }

      if (process.platform === 'win32') {
        if (this.nodeRuntimePath) {
          runtimePaths.push(this.nodeRuntimePath)
          console.log('[ACP Init] Added Node runtime path (Windows):', this.nodeRuntimePath)
        }
      } else {
        if (this.nodeRuntimePath) {
          const nodeBinPath = path.join(this.nodeRuntimePath, 'bin')
          runtimePaths.push(nodeBinPath)
          console.log('[ACP Init] Added Node runtime path (Unix):', nodeBinPath)
        }
        if (this.bunRuntimePath) {
          runtimePaths.push(this.bunRuntimePath)
          console.log('[ACP Init] Added Bun runtime path:', this.bunRuntimePath)
        }
      }

      if (runtimePaths.length > 0) {
        env[pathKey] = [...runtimePaths, existingPath].filter(Boolean).join(separator)
        console.log('[ACP Init] Updated PATH with runtime paths:', {
          runtimePaths,
          finalPathLength: env[pathKey].length
        })
      } else {
        console.warn('[ACP Init] No runtime paths available to add to PATH')
      }
    }

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
            const existingPath = env[pathKey] || ''
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

  /**
   * Setup runtime paths
   */
  private setupRuntimes(): void {
    if (this.runtimesInitialized) {
      console.log('[ACP Init] Runtimes already initialized, skipping setup')
      return
    }

    console.log('[ACP Init] Setting up runtime paths...')
    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')

    console.log('[ACP Init] Runtime base path:', runtimeBasePath)

    // Check if bun runtime file exists
    const bunRuntimePath = path.join(runtimeBasePath, 'bun')
    if (process.platform === 'win32') {
      const bunExe = path.join(bunRuntimePath, 'bun.exe')
      if (fs.existsSync(bunExe)) {
        this.bunRuntimePath = bunRuntimePath
        console.log('[ACP Init] Found Bun runtime (Windows):', bunExe)
      } else {
        console.log('[ACP Init] Bun runtime not found (Windows):', bunExe)
      }
    } else {
      const bunBin = path.join(bunRuntimePath, 'bun')
      if (fs.existsSync(bunBin)) {
        this.bunRuntimePath = bunRuntimePath
        console.log('[ACP Init] Found Bun runtime (Unix):', bunBin)
      } else {
        console.log('[ACP Init] Bun runtime not found (Unix):', bunBin)
      }
    }

    // Check if node runtime file exists
    const nodeRuntimePath = path.join(runtimeBasePath, 'node')
    if (process.platform === 'win32') {
      const nodeExe = path.join(nodeRuntimePath, 'node.exe')
      if (fs.existsSync(nodeExe)) {
        this.nodeRuntimePath = nodeRuntimePath
        console.log('[ACP Init] Found Node runtime (Windows):', nodeExe)
      } else {
        console.log('[ACP Init] Node runtime not found (Windows):', nodeExe)
      }
    } else {
      const nodeBin = path.join(nodeRuntimePath, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        this.nodeRuntimePath = nodeRuntimePath
        console.log('[ACP Init] Found Node runtime (Unix):', nodeBin)
      } else {
        console.log('[ACP Init] Node runtime not found (Unix):', nodeBin)
      }
    }

    // Check if uv runtime file exists
    const uvRuntimePath = path.join(runtimeBasePath, 'uv')
    if (process.platform === 'win32') {
      const uvExe = path.join(uvRuntimePath, 'uv.exe')
      const uvxExe = path.join(uvRuntimePath, 'uvx.exe')
      if (fs.existsSync(uvExe) && fs.existsSync(uvxExe)) {
        this.uvRuntimePath = uvRuntimePath
        console.log('[ACP Init] Found UV runtime (Windows):', { uvExe, uvxExe })
      } else {
        console.log('[ACP Init] UV runtime not found (Windows):', {
          uvExe: fs.existsSync(uvExe),
          uvxExe: fs.existsSync(uvxExe)
        })
      }
    } else {
      const uvBin = path.join(uvRuntimePath, 'uv')
      const uvxBin = path.join(uvRuntimePath, 'uvx')
      if (fs.existsSync(uvBin) && fs.existsSync(uvxBin)) {
        this.uvRuntimePath = uvRuntimePath
        console.log('[ACP Init] Found UV runtime (Unix):', { uvBin, uvxBin })
      } else {
        console.log('[ACP Init] UV runtime not found (Unix):', {
          uvBin: fs.existsSync(uvBin),
          uvxBin: fs.existsSync(uvxBin)
        })
      }
    }

    console.log('[ACP Init] Runtime setup completed:', {
      bunRuntimePath: this.bunRuntimePath,
      nodeRuntimePath: this.nodeRuntimePath,
      uvRuntimePath: this.uvRuntimePath
    })

    this.runtimesInitialized = true
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
