import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import logger from '@shared/logger'
import { presenter } from '@/presenter'
import {
  CommandPermissionHandler,
  CommandPermissionRequiredError
} from '../../threadPresenter/handlers/commandPermissionHandler'
import { getShellEnvironment, getUserShell } from './shellEnvHelper'
import { registerCommandProcess, unregisterCommandProcess } from './commandProcessTracker'

const COMMAND_MAX_OUTPUT_LENGTH = 30000
const COMMAND_DEFAULT_TIMEOUT_MS = 120000
const COMMAND_KILL_GRACE_MS = 5000

const ExecuteCommandArgsSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().min(100).optional(),
  workdir: z.string().optional(),
  description: z.string().min(5).max(100)
})

export interface ExecuteCommandOptions {
  conversationId?: string
  snippetId?: string
}

export class AgentBashHandler {
  private allowedDirectories: string[]
  private readonly commandPermissionHandler?: CommandPermissionHandler

  constructor(allowedDirectories: string[], commandPermissionHandler?: CommandPermissionHandler) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
    this.commandPermissionHandler = commandPermissionHandler
  }

  async executeCommand(args: unknown, options: ExecuteCommandOptions = {}): Promise<string> {
    const parsed = ExecuteCommandArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { command, timeout, workdir } = parsed.data
    if (this.commandPermissionHandler) {
      const permissionCheck = this.commandPermissionHandler.checkPermission(
        options.conversationId,
        command
      )
      if (!permissionCheck.allowed) {
        const commandInfo = this.commandPermissionHandler.buildCommandInfo(command)
        const responseContent =
          'components.messageBlockPermissionRequest.description.commandWithRisk'
        throw new CommandPermissionRequiredError(responseContent, {
          toolName: 'execute_command',
          serverName: 'agent-filesystem',
          permissionType: 'command',
          description: 'Execute command requires approval.',
          command,
          commandSignature: commandInfo.signature,
          commandInfo,
          conversationId: options.conversationId
        })
      }
    }

    const cwd = workdir ? await this.validatePath(workdir) : this.allowedDirectories[0]
    const startedAt = Date.now()
    const snippetId = options.snippetId ?? nanoid()

    await this.emitTerminalSnippet(options.conversationId, {
      id: snippetId,
      status: 'running',
      command,
      cwd,
      output: '',
      truncated: false,
      exitCode: null,
      startedAt,
      timestamp: startedAt
    })

    let result: {
      output: string
      exitCode: number | null
      timedOut: boolean
      aborted: boolean
      truncated: boolean
    }
    const conversationId = options.conversationId
    let registered = false

    try {
      result = await this.runShellProcess(command, cwd, timeout ?? COMMAND_DEFAULT_TIMEOUT_MS, {
        onSpawn: (child, markAborted) => {
          if (!conversationId) return
          registerCommandProcess(conversationId, snippetId, child, markAborted)
          registered = true
          child.once('exit', () => unregisterCommandProcess(conversationId, snippetId))
        }
      })
    } catch (error) {
      if (registered && conversationId) {
        unregisterCommandProcess(conversationId, snippetId)
      }
      const endedAt = Date.now()
      await this.emitTerminalSnippet(options.conversationId, {
        id: snippetId,
        status: 'failed',
        command,
        cwd,
        output: error instanceof Error ? error.message : String(error),
        truncated: false,
        exitCode: null,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        timestamp: endedAt
      })
      throw error
    }

    const endedAt = Date.now()
    const status = result.timedOut
      ? 'timed_out'
      : result.aborted
        ? 'aborted'
        : result.exitCode === 0
          ? 'completed'
          : 'failed'

    await this.emitTerminalSnippet(options.conversationId, {
      id: snippetId,
      status,
      command,
      cwd,
      output: result.output,
      truncated: result.truncated,
      exitCode: result.exitCode,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      timestamp: endedAt
    })

    const responseLines: string[] = []
    if (result.output) {
      responseLines.push(result.output.trimEnd())
    }
    responseLines.push(`Exit Code: ${result.exitCode ?? 'null'}`)
    if (result.timedOut) {
      responseLines.push('Timed out')
    }
    if (result.truncated) {
      responseLines.push('Output truncated')
    }
    return responseLines.join('\n')
  }

  private normalizePath(p: string): string {
    return path.normalize(p)
  }

  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  private isPathAllowed(candidatePath: string): boolean {
    return this.allowedDirectories.some((dir) => {
      if (candidatePath === dir) return true
      const dirWithSeparator = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`
      return candidatePath.startsWith(dirWithSeparator)
    })
  }

  private async validatePath(requestedPath: string): Promise<string> {
    const expandedPath = this.expandHome(requestedPath)
    const absolute = path.isAbsolute(expandedPath)
      ? path.resolve(expandedPath)
      : path.resolve(process.cwd(), expandedPath)
    const normalizedRequested = this.normalizePath(absolute)
    const isAllowed = this.isPathAllowed(normalizedRequested)
    if (!isAllowed) {
      throw new Error(
        `Access denied - path outside allowed directories: ${absolute} not in ${this.allowedDirectories.join(', ')}`
      )
    }
    try {
      const realPath = await fs.realpath(absolute)
      const normalizedReal = this.normalizePath(realPath)
      const isRealPathAllowed = this.isPathAllowed(normalizedReal)
      if (!isRealPathAllowed) {
        throw new Error('Access denied - symlink target outside allowed directories')
      }
      return realPath
    } catch {
      const parentDir = path.dirname(absolute)
      try {
        const realParentPath = await fs.realpath(parentDir)
        const normalizedParent = this.normalizePath(realParentPath)
        const isParentAllowed = this.isPathAllowed(normalizedParent)
        if (!isParentAllowed) {
          throw new Error('Access denied - parent directory outside allowed directories')
        }
        return absolute
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`)
      }
    }
  }

  private async runShellProcess(
    command: string,
    cwd: string,
    timeout: number,
    options: {
      onSpawn?: (child: ChildProcess, markAborted: () => void) => void
    } = {}
  ): Promise<{
    output: string
    exitCode: number | null
    timedOut: boolean
    aborted: boolean
    truncated: boolean
  }> {
    const { shell, args } = getUserShell()
    const shellEnv = await getShellEnvironment()

    return new Promise((resolve, reject) => {
      const child = spawn(shell, [...args, command], {
        cwd,
        env: {
          ...process.env,
          ...shellEnv
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let output = ''
      let truncated = false
      let timedOut = false
      let aborted = false
      let exitCode: number | null = null
      let timeoutId: NodeJS.Timeout | null = null
      let killTimeoutId: NodeJS.Timeout | null = null
      const markAborted = () => {
        aborted = true
      }

      options.onSpawn?.(child, markAborted)

      const appendOutput = (chunk: string) => {
        if (truncated) return
        const remaining = COMMAND_MAX_OUTPUT_LENGTH - output.length
        if (remaining <= 0) {
          truncated = true
          return
        }
        if (chunk.length <= remaining) {
          output += chunk
        } else {
          output += chunk.slice(0, remaining)
          truncated = true
        }
      }

      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')

      child.stdout?.on('data', (data: string) => {
        appendOutput(data)
      })

      child.stderr?.on('data', (data: string) => {
        appendOutput(data)
      })

      timeoutId = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          // ignore kill errors
        }
        killTimeoutId = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore kill errors
          }
        }, COMMAND_KILL_GRACE_MS)
      }, timeout)

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId)
        if (killTimeoutId) clearTimeout(killTimeoutId)
        reject(error)
      })

      child.on('exit', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId)
        if (killTimeoutId) clearTimeout(killTimeoutId)
        if (signal && timedOut) {
          exitCode = null
        } else {
          exitCode = code ?? null
        }
        resolve({
          output,
          exitCode,
          timedOut,
          aborted,
          truncated
        })
      })
    })
  }

  private async emitTerminalSnippet(
    conversationId: string | undefined,
    snippet: {
      id: string
      status: 'running' | 'completed' | 'failed' | 'timed_out' | 'aborted'
      command: string
      cwd?: string
      output: string
      truncated: boolean
      exitCode?: number | null
      startedAt?: number
      endedAt?: number
      durationMs?: number
      timestamp: number
    }
  ): Promise<void> {
    if (!conversationId || !presenter?.workspacePresenter) return
    try {
      await presenter.workspacePresenter.emitTerminalSnippet(conversationId, snippet)
    } catch (error) {
      logger.warn('[AgentBashHandler] Failed to emit terminal snippet', { error })
    }
  }
}
