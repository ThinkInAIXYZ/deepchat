import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import logger from '@shared/logger'
import type { IConfigPresenter } from '@shared/presenter'
import { getBackgroundExecConfig } from '@/lib/agentRuntime/backgroundExecSessionManager'
import { terminateProcessTree } from '@/lib/agentRuntime/processTree'
import { rtkRuntimeService } from '@/lib/agentRuntime/rtkRuntimeService'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../../permission/commandPermissionService'
import { resolveSessionDir } from '../../sessionPresenter/sessionPaths'
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

interface PreparedCommand {
  originalCommand: string
  command: string
  env: Record<string, string>
  rewritten: boolean
  rtkApplied: boolean
  rtkMode: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
}

interface CompletedShellProcessResult {
  kind: 'completed'
  output: string
  exitCode: number | null
  timedOut: boolean
  offloaded: boolean
  outputFilePath?: string
}

interface RunningShellProcessResult {
  kind: 'running'
  sessionId: string
}

type ShellProcessResult = CompletedShellProcessResult | RunningShellProcessResult

export class AgentBashHandler {
  private allowedDirectories: string[]
  private readonly commandPermissionHandler?: CommandPermissionService
  private readonly configPresenter?: Pick<IConfigPresenter, 'getSetting'>

  constructor(
    allowedDirectories: string[],
    commandPermissionHandler?: CommandPermissionService,
    configPresenter?: Pick<IConfigPresenter, 'getSetting'>
  ) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
    this.commandPermissionHandler = commandPermissionHandler
    this.configPresenter = configPresenter
  }

  async executeCommand(
    args: unknown,
    options: ExecuteCommandOptions = {}
  ): Promise<{
    output: string | { status: 'running'; sessionId: string }
    rtkApplied: boolean
    rtkMode: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
  }> {
    const parsed = ExecuteCommandArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { command, timeout, background, cwd: requestedCwd, yieldMs } = parsed.data
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

    let result: ShellProcessResult

    const prepared = await this.prepareCommand(command, options.env)

    result = await this.runShellProcess(
      prepared.command,
      cwd,
      timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
      {
        ...options,
        env: prepared.env,
        yieldMs
      }
    )

    if (result.kind === 'running') {
      return {
        output: { status: 'running', sessionId: result.sessionId },
        rtkApplied: prepared.rtkApplied,
        rtkMode: prepared.rtkMode,
        rtkFallbackReason: prepared.rtkFallbackReason
      }
    }

    const fallbackReason = this.getRtkCapabilityFallbackReason(result.output)
    if (
      prepared.rewritten &&
      !result.timedOut &&
      result.exitCode !== null &&
      result.exitCode !== 0 &&
      fallbackReason
    ) {
      logger.warn(
        '[AgentBashHandler] Falling back to original command after RTK capability error',
        {
          command,
          rewrittenCommand: prepared.command,
          originalCommand: prepared.originalCommand,
          fallbackReason
        }
      )

      result = await this.runShellProcess(
        prepared.originalCommand,
        cwd,
        timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
        {
          ...options,
          env: prepared.env,
          yieldMs
        }
      )

      prepared.rtkApplied = false
      prepared.rtkMode = 'bypass'
      prepared.rtkFallbackReason = fallbackReason

      if (result.kind === 'running') {
        return {
          output: { status: 'running', sessionId: result.sessionId },
          rtkApplied: prepared.rtkApplied,
          rtkMode: prepared.rtkMode,
          rtkFallbackReason: prepared.rtkFallbackReason
        }
      }
    }

    return {
      output: this.formatCompletedResult(result),
      rtkApplied: prepared.rtkApplied,
      rtkMode: prepared.rtkMode,
      rtkFallbackReason: prepared.rtkFallbackReason
    }
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
    options: ExecuteCommandOptions & { yieldMs?: number }
  ): Promise<ShellProcessResult> {
    if (options.conversationId) {
      return await this.runManagedShellProcess(command, cwd, timeout, options)
    }

    return await this.runDetachedShellProcess(command, cwd, timeout, options)
  }

  private async runManagedShellProcess(
    command: string,
    cwd: string,
    timeout: number,
    options: ExecuteCommandOptions & { yieldMs?: number }
  ): Promise<ShellProcessResult> {
    const conversationId = options.conversationId
    if (!conversationId) {
      throw new Error('Managed shell process requires a conversation ID')
    }

    const session = await backgroundExecSessionManager.start(conversationId, command, cwd, {
      timeout,
      env: options.env,
      outputPrefix: options.outputPrefix
    })

    backgroundExecSessionManager.write(conversationId, session.sessionId, options.stdin ?? '', true)

    const yielded = await backgroundExecSessionManager.waitForCompletionOrYield(
      conversationId,
      session.sessionId,
      options.yieldMs ?? getBackgroundExecConfig().backgroundMs
    )

    if (yielded.kind === 'running') {
      return yielded
    }

    const shouldCleanupSession = !yielded.result.offloaded

    try {
      return {
        kind: 'completed',
        output: yielded.result.output,
        exitCode: yielded.result.exitCode,
        timedOut: yielded.result.timedOut,
        offloaded: yielded.result.offloaded,
        outputFilePath: yielded.result.outputFilePath
      }
    } finally {
      if (shouldCleanupSession) {
        await backgroundExecSessionManager
          .remove(conversationId, session.sessionId)
          .catch((error) => {
            logger.warn('[AgentBashHandler] Failed to cleanup completed foreground exec session', {
              conversationId,
              sessionId: session.sessionId,
              error
            })
          })
      }
    }
  }

  private async runDetachedShellProcess(
    command: string,
    cwd: string,
    timeout: number,
    options: ExecuteCommandOptions
  ): Promise<CompletedShellProcessResult> {
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
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let settled = false
      let output = ''
      let totalOutputLength = 0
      let offloaded = false
      let timedOut = false
      let outputWriteQueue = Promise.resolve()
      let timeoutId: NodeJS.Timeout | null = null

      const cleanupTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const settle = async (payload: CompletedShellProcessResult) => {
        if (settled) return
        settled = true
        cleanupTimeout()

        try {
          await outputWriteQueue
        } catch {
          // Already logged when flushing output.
        }

        resolve(payload)
      }

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
        void terminateProcessTree(child, { graceMs: COMMAND_KILL_GRACE_MS }).then((closed) => {
          if (closed || settled) {
            return
          }

          const preview =
            offloaded && outputFilePath
              ? this.readLastCharsFromFile(outputFilePath, COMMAND_PREVIEW_CHARS)
              : output

          void settle({
            kind: 'completed',
            output: preview,
            exitCode: null,
            timedOut: true,
            offloaded,
            outputFilePath: outputFilePath ?? undefined
          })
        })
      }, timeout)

      child.on('error', (error) => {
        cleanupTimeout()
        reject(error)
      })

      child.on('close', async (code, signal) => {
        const preview =
          offloaded && outputFilePath
            ? this.readLastCharsFromFile(outputFilePath, COMMAND_PREVIEW_CHARS)
            : output

        void settle({
          kind: 'completed',
          output: preview,
          exitCode: signal && timedOut ? null : (code ?? null),
          timedOut,
          offloaded,
          outputFilePath: outputFilePath ?? undefined
        })
      })
    })
  }

  private formatCompletedResult(result: CompletedShellProcessResult): string {
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
  ): Promise<{
    output: { status: 'running'; sessionId: string }
    rtkApplied: boolean
    rtkMode: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
  }> {
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

    const prepared = await this.prepareCommand(command, options.env)

    const result = await backgroundExecSessionManager.start(conversationId, prepared.command, cwd, {
      timeout: timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
      env: prepared.env,
      outputPrefix: options.outputPrefix
    })

    if (options.stdin !== undefined) {
      backgroundExecSessionManager.write(conversationId, result.sessionId, options.stdin, true)
    }

    return {
      output: { status: 'running', sessionId: result.sessionId },
      rtkApplied: prepared.rtkApplied,
      rtkMode: prepared.rtkMode,
      rtkFallbackReason: prepared.rtkFallbackReason
    }
  }

  private async prepareCommand(
    command: string,
    env?: Record<string, string>
  ): Promise<PreparedCommand> {
    const baseEnv = env ?? {}
    if (!this.configPresenter) {
      return {
        originalCommand: command,
        command,
        env: baseEnv,
        rewritten: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: 'RTK settings are unavailable'
      }
    }

    const prepared = await rtkRuntimeService.prepareShellCommand(
      command,
      baseEnv,
      this.configPresenter
    )
    return {
      originalCommand: prepared.originalCommand,
      command: prepared.command,
      env: prepared.env,
      rewritten: prepared.rewritten,
      rtkApplied: prepared.rtkApplied,
      rtkMode: prepared.rtkMode,
      rtkFallbackReason: prepared.rtkFallbackReason
    }
  }

  private getRtkCapabilityFallbackReason(output: string): string | undefined {
    const normalized = output.toLowerCase()
    if (normalized.includes('rtk find does not support compound predicates or actions')) {
      return 'RTK capability fallback after rewrite failure: unsupported find compound predicates or actions'
    }
    if (normalized.includes('unsupported predicate')) {
      return 'RTK capability fallback after rewrite failure: unsupported predicate'
    }
    if (normalized.includes('unsupported action')) {
      return 'RTK capability fallback after rewrite failure: unsupported action'
    }
    return undefined
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
