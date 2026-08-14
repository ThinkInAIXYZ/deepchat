import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { z } from 'zod'
import logger from '@shared/logger'
import type { SettingsStore } from '@/config/settingsStore'
import {
  backgroundExecSessionManager,
  getBackgroundExecConfig
} from '@/agent/shared/process/backgroundExecSessionManager'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import {
  RTK_ENABLED_SETTING_KEY,
  rtkRuntimeService
} from '@/agent/shared/process/rtkRuntimeService'
import { mergeCommandEnvironment } from '@/agent/shared/process/shellEnvHelper'
import {
  createUtf8OutputDecoderPair,
  prepareShellCommandForUtf8Output
} from '@/agent/shared/process/shellOutputEncoding'
import { resolveUsableSpawnCwd } from '@/agent/shared/process/spawnGuard'
import { resolveSessionDir } from '@/agent/shared/storage/sessionPaths'
import type { ResolvedCommandShell } from '@shared/commandShell'
import { normalizeCommandShellFilePath } from '@/agent/shared/process/commandShellPath'
import type { ArmedAgentCliProgrammaticToken } from '@/cli/agentTokenAuthority'

// Consider moving to a shared handlers location in future refactoring
import {
  CommandPermissionRequiredError,
  CommandPermissionService
} from '../permission/commandPermissionService'

const COMMAND_DEFAULT_TIMEOUT_MS = 120000
const COMMAND_KILL_GRACE_MS = 5000
const PROGRAMMATIC_SETTLEMENT_GRACE_MS = 5000
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
  commandShell: ResolvedCommandShell
  oneShotCommandGrantId?: string
  conversationId?: string
  env?: Record<string, string>
  stdin?: string
  programmatic?: boolean
  signal?: AbortSignal
  maxTimeoutMs?: number
  outputPrefix?: string
  outputPreviewChars?: number
  allowExternalCwd?: boolean
  beforeExecute?: (
    normalizedArguments: Record<string, unknown>
  ) => ArmedAgentCliProgrammaticToken | void
}

export interface AgentCommandEnvironmentPort {
  createEnvironment(
    conversationId: string,
    command: string,
    commandShell: ResolvedCommandShell
  ):
    | Readonly<{
        variables: Readonly<Record<string, string>>
        prependPath: readonly string[]
        preserveCommand: boolean
      }>
    | undefined
  createProgrammaticEnvironment?(
    armed: ArmedAgentCliProgrammaticToken,
    conversationId: string,
    command: string,
    stdin: string | undefined,
    commandShell: ResolvedCommandShell
  ): Readonly<{
    variables: Readonly<Record<string, string>>
    prependPath: readonly string[]
    preserveCommand: boolean
  }>
}

export class ProgrammaticCommandLaunchError extends Error {
  constructor(options?: ErrorOptions) {
    super('Programmatic CLI launch did not reach authoritative settlement', options)
    this.name = 'ProgrammaticCommandLaunchError'
  }
}

export function isProgrammaticCommandLaunchError(
  error: unknown
): error is ProgrammaticCommandLaunchError {
  return error instanceof ProgrammaticCommandLaunchError
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

interface ResolvedCommandEnvironment {
  env?: Record<string, string>
  preserveCommand: boolean
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
  private readonly commandPermissionHandler: CommandPermissionService
  private readonly settings: Pick<SettingsStore, 'get'>

  constructor(
    allowedDirectories: string[],
    settings: Pick<SettingsStore, 'get'>,
    commandPermissionHandler: CommandPermissionService,
    private readonly commandEnvironment?: AgentCommandEnvironmentPort
  ) {
    if (allowedDirectories.length === 0) {
      throw new Error('At least one allowed directory must be provided')
    }
    this.allowedDirectories = allowedDirectories.map((dir) =>
      this.normalizePath(path.resolve(this.expandHome(dir)))
    )
    this.settings = settings
    this.commandPermissionHandler = commandPermissionHandler
  }

  async executeCommand(
    args: unknown,
    options: ExecuteCommandOptions
  ): Promise<{
    output: string | { status: 'running'; sessionId: string }
    rtkApplied: boolean
    rtkMode: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
    outputOffloadPath?: string
  }> {
    const parsed = ExecuteCommandArgsSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error}`)
    }

    const { command, timeout, background, cwd: requestedCwd, yieldMs } = parsed.data
    const isProgrammaticInvocation = options.programmatic === true
    if (isProgrammaticInvocation) {
      options.signal?.throwIfAborted()
    }
    if (
      isProgrammaticInvocation &&
      (!options.conversationId || background || yieldMs !== undefined)
    ) {
      throw new Error('DeepChat Programmatic Tool commands must remain attached and foreground.')
    }
    if (!isProgrammaticInvocation && options.stdin !== undefined) {
      throw new Error('Owned stdin is limited to DeepChat Programmatic Tool commands.')
    }
    const cwd = this.resolveWorkingDirectory(
      requestedCwd,
      options.commandShell,
      options.allowExternalCwd
    )
    const executionTimeout = isProgrammaticInvocation
      ? (options.maxTimeoutMs ?? COMMAND_DEFAULT_TIMEOUT_MS)
      : Math.min(
          timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
          options.maxTimeoutMs ?? Number.MAX_SAFE_INTEGER
        )
    const resolvedTimeout = isProgrammaticInvocation
      ? Math.min(Number.MAX_SAFE_INTEGER, executionTimeout + PROGRAMMATIC_SETTLEMENT_GRACE_MS)
      : executionTimeout

    // Handle background execution
    if (background) {
      return this.executeCommandBackground(command, resolvedTimeout, cwd, options)
    }

    const permissionCheck = this.commandPermissionHandler.checkPermission(
      options.conversationId,
      command,
      options.commandShell,
      options.oneShotCommandGrantId
    )
    if (!permissionCheck.allowed) {
      const commandInfo = this.commandPermissionHandler.buildCommandInfo(
        command,
        options.commandShell
      )
      const responseContent = 'components.messageBlockPermissionRequest.description.commandWithRisk'
      throw new CommandPermissionRequiredError(responseContent, {
        toolName: 'exec',
        serverName: 'agent-filesystem',
        permissionType: 'command',
        description: 'Execute command requires approval.',
        command,
        commandSignature: commandInfo.signature,
        shellProfile: options.commandShell.profile,
        commandInfo,
        conversationId: options.conversationId
      })
    }

    const spawnCwd = resolveUsableSpawnCwd(cwd)
    let result: ShellProcessResult

    const resolvedEnvironment = !isProgrammaticInvocation
      ? this.resolveCommandEnvironment(command, options)
      : { env: options.env, preserveCommand: true }
    const prepared = await this.prepareCommand(
      command,
      resolvedEnvironment.env,
      options.commandShell,
      resolvedEnvironment.preserveCommand || isProgrammaticInvocation
    )
    if (isProgrammaticInvocation) {
      options.signal?.throwIfAborted()
    }

    let armedProgrammaticToken: ArmedAgentCliProgrammaticToken | void
    try {
      armedProgrammaticToken = options.beforeExecute?.({
        command: prepared.command,
        cwd: spawnCwd,
        timeoutMs: resolvedTimeout,
        background: false,
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        ...(prepared.rewritten
          ? {
              fallbackCommand: prepared.originalCommand,
              fallbackPolicy: 'rtk_capability_error'
            }
          : {}),
        ...(yieldMs === undefined ? {} : { yieldMs })
      })
      if (isProgrammaticInvocation) {
        if (!armedProgrammaticToken || !options.conversationId) {
          throw new Error('Programmatic CLI launch requires an armed outer operation grant')
        }
        const programmaticEnvironment = this.commandEnvironment?.createProgrammaticEnvironment?.(
          armedProgrammaticToken,
          options.conversationId,
          prepared.command,
          options.stdin,
          options.commandShell
        )
        if (!programmaticEnvironment) {
          throw new Error('Programmatic CLI command environment is unavailable')
        }
        prepared.env = mergeCommandEnvironment({
          processEnv: process.env,
          overrides: { ...prepared.env, ...programmaticEnvironment.variables },
          prependPathSources: [...programmaticEnvironment.prependPath],
          includeDefaultPaths: false
        })
      }
    } catch (error) {
      if (isProgrammaticInvocation) {
        throw new ProgrammaticCommandLaunchError({ cause: error })
      }
      throw error
    }
    try {
      result = await this.runShellProcess(prepared.command, spawnCwd, resolvedTimeout, {
        ...options,
        env: prepared.env,
        yieldMs
      })
    } catch (error) {
      if (isProgrammaticInvocation) {
        throw new ProgrammaticCommandLaunchError({ cause: error })
      }
      throw error
    }

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

      result = await this.runShellProcess(prepared.originalCommand, spawnCwd, resolvedTimeout, {
        ...options,
        env: prepared.env,
        yieldMs
      })

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
      rtkFallbackReason: prepared.rtkFallbackReason,
      outputOffloadPath: result.offloaded ? result.outputFilePath : undefined
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

  private resolveWorkingDirectory(
    requestedCwd: string | undefined,
    commandShell: ResolvedCommandShell,
    allowExternalCwd = false
  ): string {
    const defaultCwd = this.allowedDirectories[0]
    const normalizedInput = requestedCwd?.trim()
    if (!normalizedInput) {
      return defaultCwd
    }

    const expanded = this.expandHome(
      normalizeCommandShellFilePath(normalizedInput, commandShell.pathStyle)
    )
    const resolved = path.isAbsolute(expanded)
      ? this.normalizePath(path.resolve(expanded))
      : this.normalizePath(path.resolve(defaultCwd, expanded))

    if (!allowExternalCwd && !this.isPathAllowed(resolved)) {
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
    if (options.programmatic === true) {
      options.signal?.throwIfAborted()
    }

    const session = await backgroundExecSessionManager.start(conversationId, command, cwd, {
      commandShell: options.commandShell,
      timeout,
      env: options.env,
      outputPrefix: options.outputPrefix,
      previewChars: options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS,
      offloadThresholdChars: Math.min(
        COMMAND_OFFLOAD_THRESHOLD,
        options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
      )
    })

    let removal: Promise<void> | undefined
    const removeSession = (): Promise<void> => {
      removal ??= backgroundExecSessionManager.remove(conversationId, session.sessionId)
      return removal
    }
    const signal = options.programmatic === true ? options.signal : undefined
    let removeAbortListener = () => {}
    const abortObserved = signal
      ? new Promise<void>((resolve) => {
          const onAbort = () => {
            void removeSession().catch((error) => {
              logger.warn(
                '[AgentBashHandler] Failed to terminate an aborted Programmatic command',
                {
                  conversationId,
                  sessionId: session.sessionId,
                  error
                }
              )
            })
            resolve()
          }
          signal.addEventListener('abort', onAbort, { once: true })
          removeAbortListener = () => signal.removeEventListener('abort', onAbort)
          if (signal.aborted) onAbort()
        })
      : null

    if (signal?.aborted) {
      await removeSession().catch(() => {})
      removeAbortListener()
      signal.throwIfAborted()
    }

    try {
      await backgroundExecSessionManager.write(
        conversationId,
        session.sessionId,
        options.stdin ?? '',
        true
      )
    } catch (error) {
      await removeSession().catch((cause) => {
        logger.warn('[AgentBashHandler] Failed to cleanup a session after stdin delivery failed', {
          conversationId,
          sessionId: session.sessionId,
          cause
        })
      })
      removeAbortListener()
      if (signal?.aborted) signal.throwIfAborted()
      throw error
    }

    try {
      const yielded =
        options.stdin === undefined && options.programmatic !== true
          ? await backgroundExecSessionManager.waitForCompletionOrYield(
              conversationId,
              session.sessionId,
              options.yieldMs ?? getBackgroundExecConfig().backgroundMs,
              options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
            )
          : {
              kind: 'completed' as const,
              result: await (abortObserved && signal
                ? Promise.race([
                    backgroundExecSessionManager.getCompletionResult(
                      conversationId,
                      session.sessionId,
                      options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
                    ),
                    abortObserved.then(async () => {
                      await removeSession().catch(() => {})
                      signal.throwIfAborted()
                      throw new DOMException('Aborted', 'AbortError')
                    })
                  ])
                : backgroundExecSessionManager.getCompletionResult(
                    conversationId,
                    session.sessionId,
                    options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
                  ))
            }

      if (yielded.kind === 'running') {
        return yielded
      }

      const retainOffloadedSession =
        options.stdin === undefined && options.programmatic !== true && yielded.result.offloaded

      try {
        return {
          kind: 'completed',
          output: yielded.result.output,
          exitCode: yielded.result.exitCode,
          timedOut: yielded.result.timedOut,
          offloaded: retainOffloadedSession,
          outputFilePath: retainOffloadedSession ? yielded.result.outputFilePath : undefined
        }
      } finally {
        if (!retainOffloadedSession) {
          await removeSession().catch((error) => {
            logger.warn('[AgentBashHandler] Failed to cleanup completed foreground exec session', {
              conversationId,
              sessionId: session.sessionId,
              error
            })
          })
        }
      }
    } catch (error) {
      if (options.programmatic === true) {
        await removeSession().catch((cause) => {
          logger.warn('[AgentBashHandler] Failed to cleanup failed Programmatic command', {
            conversationId,
            sessionId: session.sessionId,
            cause
          })
        })
      }
      if (signal?.aborted) signal.throwIfAborted()
      throw error
    } finally {
      removeAbortListener()
    }
  }

  private async runDetachedShellProcess(
    command: string,
    cwd: string,
    timeout: number,
    options: ExecuteCommandOptions
  ): Promise<CompletedShellProcessResult> {
    const { executable: shell, args, dialect } = options.commandShell
    const shellCommand = prepareShellCommandForUtf8Output(dialect, command)
    const outputFilePath = this.createOutputFilePath(options.conversationId, options.outputPrefix)
    const outputPreviewChars = options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
    const offloadThresholdChars = Math.min(COMMAND_OFFLOAD_THRESHOLD, outputPreviewChars)

    return new Promise((resolve, reject) => {
      const child = spawn(shell, [...args, shellCommand], {
        cwd,
        env: options.env ? { ...options.env } : { ...process.env },
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let settled = false
      let output = ''
      let totalOutputLength = 0
      let offloaded = false
      let timedOut = false
      let outputWriteQueue = Promise.resolve()
      let timeoutId: NodeJS.Timeout | null = null

      const outputDecoders = createUtf8OutputDecoderPair((data) => appendOutput(data))

      const cleanupTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const settle = async (
        payload: Pick<CompletedShellProcessResult, 'exitCode' | 'timedOut'>
      ) => {
        if (settled) return
        settled = true
        cleanupTimeout()
        outputDecoders.flush()

        try {
          await outputWriteQueue
        } catch {
          // Already logged when flushing output.
        }

        const preview =
          offloaded && outputFilePath
            ? this.readLastCharsFromFile(outputFilePath, outputPreviewChars)
            : output.slice(-outputPreviewChars)
        resolve({
          kind: 'completed',
          output: preview,
          ...payload,
          offloaded,
          outputFilePath: outputFilePath ?? undefined
        })
      }

      const appendOutput = (chunk: string) => {
        totalOutputLength += chunk.length
        const shouldOffload =
          outputFilePath !== null && (offloaded || totalOutputLength > offloadThresholdChars)

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

      child.stdout?.on('data', (data: Buffer | string) => {
        outputDecoders.writeStdout(data)
      })

      child.stderr?.on('data', (data: Buffer | string) => {
        outputDecoders.writeStderr(data)
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

          void settle({
            exitCode: null,
            timedOut: true
          })
        })
      }, timeout)

      child.on('error', (error) => {
        cleanupTimeout()
        outputDecoders.flush()
        reject(error)
      })

      child.on('close', (code, signal) => {
        void settle({
          exitCode: signal && timedOut ? null : (code ?? null),
          timedOut
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
            return content.slice(firstNewline + 1).slice(-maxChars)
          }
        }
        return content.slice(-maxChars)
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

    const permissionCheck = this.commandPermissionHandler.checkPermission(
      conversationId,
      command,
      options.commandShell,
      options.oneShotCommandGrantId
    )
    if (!permissionCheck.allowed) {
      const commandInfo = this.commandPermissionHandler.buildCommandInfo(
        command,
        options.commandShell
      )
      throw new CommandPermissionRequiredError(
        'components.messageBlockPermissionRequest.description.commandWithRisk',
        {
          toolName: 'exec',
          serverName: 'agent-filesystem',
          permissionType: 'command',
          description: 'Execute command requires approval.',
          command,
          commandSignature: commandInfo.signature,
          shellProfile: options.commandShell.profile,
          commandInfo,
          conversationId
        }
      )
    }

    const spawnCwd = resolveUsableSpawnCwd(cwd)
    const resolvedEnvironment = this.resolveCommandEnvironment(command, options)
    const prepared = await this.prepareCommand(
      command,
      resolvedEnvironment.env,
      options.commandShell,
      resolvedEnvironment.preserveCommand
    )

    options.beforeExecute?.({
      command: prepared.command,
      cwd: spawnCwd,
      timeoutMs: timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
      background: true
    })
    const result = await backgroundExecSessionManager.start(
      conversationId,
      prepared.command,
      spawnCwd,
      {
        commandShell: options.commandShell,
        timeout: timeout ?? COMMAND_DEFAULT_TIMEOUT_MS,
        env: prepared.env,
        outputPrefix: options.outputPrefix,
        previewChars: options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS,
        offloadThresholdChars: Math.min(
          COMMAND_OFFLOAD_THRESHOLD,
          options.outputPreviewChars ?? COMMAND_PREVIEW_CHARS
        )
      }
    )

    return {
      output: { status: 'running', sessionId: result.sessionId },
      rtkApplied: prepared.rtkApplied,
      rtkMode: prepared.rtkMode,
      rtkFallbackReason: prepared.rtkFallbackReason
    }
  }

  private async prepareCommand(
    command: string,
    env: Record<string, string> | undefined,
    commandShell: ResolvedCommandShell,
    preserveCommand = false
  ): Promise<PreparedCommand> {
    const baseEnv = env ?? {}
    const prepared = await rtkRuntimeService.prepareShellCommand(
      command,
      baseEnv,
      !preserveCommand && this.settings.get<boolean>(RTK_ENABLED_SETTING_KEY) !== false,
      { allowRewrite: commandShell.dialect === 'posix' }
    )
    return {
      originalCommand: prepared.originalCommand,
      command: prepared.command,
      env: prepared.env,
      rewritten: prepared.rewritten,
      rtkApplied: prepared.rtkApplied,
      rtkMode: prepared.rtkMode,
      rtkFallbackReason: preserveCommand
        ? 'RTK rewrite bypassed for exact command execution'
        : commandShell.dialect !== 'posix' && prepared.rtkMode !== 'direct'
          ? 'RTK rewrite bypassed for non-POSIX command shell'
          : prepared.rtkFallbackReason
    }
  }

  private resolveCommandEnvironment(
    command: string,
    options: ExecuteCommandOptions
  ): ResolvedCommandEnvironment {
    const scopedEnvironment = options.conversationId
      ? this.commandEnvironment?.createEnvironment(
          options.conversationId,
          command,
          options.commandShell
        )
      : undefined
    if (!scopedEnvironment) return { env: options.env, preserveCommand: false }
    return {
      env: mergeCommandEnvironment({
        processEnv: process.env,
        overrides: { ...options.env, ...scopedEnvironment.variables },
        prependPathSources: [...scopedEnvironment.prependPath],
        includeDefaultPaths: false
      }),
      preserveCommand: scopedEnvironment.preserveCommand
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
    commandShell: ResolvedCommandShell,
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
    const permissionCheck = this.commandPermissionHandler.checkPermission(
      conversationId,
      command,
      commandShell
    )
    if (permissionCheck.allowed) {
      return { needsPermission: false }
    }

    const commandInfo = this.commandPermissionHandler.buildCommandInfo(command, commandShell)
    return {
      needsPermission: true,
      description: `Command "${command}" requires permission`,
      signature: commandInfo.signature,
      commandInfo
    }
  }
}
