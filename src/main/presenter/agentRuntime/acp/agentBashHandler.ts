import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import logger from '@shared/logger'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../../permission/commandPermissionService'
import { resolveSessionDir } from '../sessionPaths'
import { getShellEnvironment, getUserShell } from './shellEnvHelper'
import { backgroundExecSessionManager } from './backgroundExecSessionManager'

const COMMAND_DEFAULT_TIMEOUT_MS = 120000
const COMMAND_KILL_GRACE_MS = 5000
const COMMAND_OFFLOAD_THRESHOLD = 10000
const COMMAND_PREVIEW_CHARS = 12000

const ExecuteCommandArgsSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().min(100).optional(),
  description: z.string().min(5).max(100),
  cwd: z.string().optional(),
  background: z.boolean().optional().default(false),
  yieldMs: z.number().min(100).optional()
})

export interface ExecuteCommandOptions {
  conversationId?: string
  env?: Record<string, string>
  stdin?: string
  outputPrefix?: string
}

export class AgentBashHandler {
  private allowedDirectories: string[]
  private readonly commandPermissionHandler?: CommandPermissionService

  constructor(allowedDirectories: string[], commandPermissionHandler?: CommandPermissionService) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
    this.commandPermissionHandler = commandPermissionHandler
  }

  async executeCommand(
    args: unknown,
    options: ExecuteCommandOptions = {}
  ): Promise<string | { status: 'running'; sessionId: string }> {
    const parsed = ExecuteCommandArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { command, timeout, background, cwd: requestedCwd } = parsed.data
    const cwd = this.resolveWorkingDirectory(requestedCwd)

    // Handle background execution
    if (background) {
      return this.executeCommandBackground(command, timeout, cwd, options)
    }

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
          toolName: 'exec',
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

    let result: {
      output: string
      exitCode: number | null
      timedOut: boolean
      offloaded: boolean
      outputFilePath?: string
    }

    result = await this.runShellProcess(
      command,
      cwd,
      timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
      options
    )

    const responseLines: string[] = []
    if (result.output) {
      responseLines.push(result.output.trimEnd())
    }
    responseLines.push(`Exit Code: ${result.exitCode ?? 'null'}`)
    if (result.timedOut) {
      responseLines.push('Timed out')
    }
    if (result.offloaded && result.outputFilePath) {
      responseLines.push(`Output offloaded: ${result.outputFilePath}`)
    }
    return responseLines.join('\n')
  }

  private normalizePath(p: string): string {
    return path.normalize(p)
  }

  private normalizeForComparison(inputPath: string): string {
    const normalized = this.normalizePath(path.resolve(inputPath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private isPathAllowed(targetPath: string): boolean {
    const normalizedTarget = this.normalizeForComparison(targetPath)
    return this.allowedDirectories.some((allowedDirectory) => {
      const normalizedAllowed = this.normalizeForComparison(allowedDirectory)
      const relative = path.relative(normalizedAllowed, normalizedTarget)
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    })
  }

  private resolveWorkingDirectory(requestedCwd?: string): string {
    const defaultCwd = this.allowedDirectories[0]
    const normalizedInput = requestedCwd?.trim()
    if (!normalizedInput) {
      return defaultCwd
    }

    const expanded = this.expandHome(normalizedInput)
    const resolved = path.isAbsolute(expanded)
      ? this.normalizePath(path.resolve(expanded))
      : this.normalizePath(path.resolve(defaultCwd, expanded))

    if (!this.isPathAllowed(resolved)) {
      throw new Error(`Working directory is not allowed: ${requestedCwd}`)
    }

    return resolved
  }

  private expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  private async runShellProcess(
    command: string,
    cwd: string,
    timeout: number,
    options: ExecuteCommandOptions
  ): Promise<{
    output: string
    exitCode: number | null
    timedOut: boolean
    offloaded: boolean
    outputFilePath?: string
  }> {
    const { shell, args } = getUserShell()
    const shellEnv = await getShellEnvironment()
    const outputFilePath = this.createOutputFilePath(options.conversationId, options.outputPrefix)

    return new Promise((resolve, reject) => {
      const child = spawn(shell, [...args, command], {
        cwd,
        env: {
          ...process.env,
          ...shellEnv,
          ...options.env
        },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let totalOutputLength = 0
      let offloaded = false
      let timedOut = false
      let exitCode: number | null = null
      let outputWriteQueue = Promise.resolve()
      let timeoutId: NodeJS.Timeout | null = null
      let killTimeoutId: NodeJS.Timeout | null = null

      const appendOutput = (chunk: string) => {
        totalOutputLength += chunk.length
        const shouldOffload =
          outputFilePath !== null && (offloaded || totalOutputLength > COMMAND_OFFLOAD_THRESHOLD)

        if (!shouldOffload) {
          output += chunk
          return
        }

        offloaded = true
        const buffered = output + chunk
        output = ''
        outputWriteQueue = outputWriteQueue
          .then(async () => {
            await fs.promises.appendFile(outputFilePath, buffered, 'utf-8')
          })
          .catch((error) => {
            logger.warn('[AgentBashHandler] Failed to offload foreground output', {
              outputFilePath,
              error
            })
            offloaded = false
            output += buffered
          })
      }

      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')

      child.stdout?.on('data', (data: string) => {
        appendOutput(data)
      })

      child.stderr?.on('data', (data: string) => {
        appendOutput(data)
      })

      if (options.stdin !== undefined) {
        child.stdin?.write(options.stdin)
      }
      child.stdin?.end()

      timeoutId = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
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

      child.on('close', async (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId)
        if (killTimeoutId) clearTimeout(killTimeoutId)

        try {
          await outputWriteQueue
        } catch {
          // Already logged when flushing output.
        }

        if (signal && timedOut) {
          exitCode = null
        } else {
          exitCode = code ?? null
        }

        const preview =
          offloaded && outputFilePath
            ? this.readLastCharsFromFile(outputFilePath, COMMAND_PREVIEW_CHARS)
            : output

        resolve({
          output: preview,
          exitCode,
          timedOut,
          offloaded,
          outputFilePath: outputFilePath ?? undefined
        })
      })
    })
  }

  private createOutputFilePath(
    conversationId?: string,
    outputPrefix: string = 'exec'
  ): string | null {
    if (!conversationId) {
      return null
    }

    const sessionDir = resolveSessionDir(conversationId)
    if (!sessionDir) {
      return null
    }

    try {
      fs.mkdirSync(sessionDir, { recursive: true })
      const safePrefix = outputPrefix.replace(/[^a-zA-Z0-9_-]/g, '_')
      return path.join(sessionDir, `${safePrefix}_${Date.now()}.log`)
    } catch (error) {
      logger.warn('[AgentBashHandler] Failed to prepare output offload path', {
        conversationId,
        error
      })
      return null
    }
  }

  private readLastCharsFromFile(filePath: string, maxChars: number): string {
    try {
      const stats = fs.statSync(filePath)
      const fileSize = stats.size
      const bytesToRead = Math.min(maxChars * 4, fileSize)
      const startPosition = Math.max(0, fileSize - bytesToRead)
      const fd = fs.openSync(filePath, 'r')

      try {
        const buffer = Buffer.alloc(bytesToRead)
        const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, startPosition)
        if (bytesRead <= 0) {
          return ''
        }
        const content = buffer.subarray(0, bytesRead).toString('utf-8')
        if (startPosition > 0) {
          const firstNewline = content.indexOf('\n')
          if (firstNewline > 0) {
            return content.slice(firstNewline + 1)
          }
        }
        return content
      } finally {
        fs.closeSync(fd)
      }
    } catch (error) {
      logger.warn('[AgentBashHandler] Failed to read offloaded preview', { filePath, error })
      return ''
    }
  }

  private async executeCommandBackground(
    command: string,
    timeout: number | undefined,
    cwd: string,
    options: ExecuteCommandOptions
  ): Promise<{ status: 'running'; sessionId: string }> {
    const conversationId = options.conversationId

    if (!conversationId) {
      throw new Error('Background execution requires a conversation ID')
    }

    if (this.commandPermissionHandler) {
      const permissionCheck = this.commandPermissionHandler.checkPermission(conversationId, command)
      if (!permissionCheck.allowed) {
        const commandInfo = this.commandPermissionHandler.buildCommandInfo(command)
        throw new CommandPermissionRequiredError(
          'components.messageBlockPermissionRequest.description.commandWithRisk',
          {
            toolName: 'exec',
            serverName: 'agent-filesystem',
            permissionType: 'command',
            description: 'Execute command requires approval.',
            command,
            commandSignature: commandInfo.signature,
            commandInfo,
            conversationId
          }
        )
      }
    }

    // Start background session
    const result = await backgroundExecSessionManager.start(conversationId, command, cwd, {
      timeout: timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
      env: options.env
    })

    return { status: 'running', sessionId: result.sessionId }
  }

  /**
   * Pre-check command permission without executing
   * Returns permission info if permission is needed, null if no permission needed
   */
  checkCommandPermission(
    command: string,
    conversationId?: string
  ): {
    needsPermission: boolean
    description?: string
    signature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  } {
    if (!this.commandPermissionHandler) {
      return { needsPermission: false }
    }

    const permissionCheck = this.commandPermissionHandler.checkPermission(conversationId, command)
    if (permissionCheck.allowed) {
      return { needsPermission: false }
    }

    const commandInfo = this.commandPermissionHandler.buildCommandInfo(command)
    return {
      needsPermission: true,
      description: `Command "${command}" requires permission`,
      signature: commandInfo.signature,
      commandInfo
    }
  }
}
