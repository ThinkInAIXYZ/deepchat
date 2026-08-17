import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import logger from '@shared/logger'
import {
  SKILL_RUN_MAX_ARGUMENTS,
  SKILL_RUN_MAX_ARGUMENT_CHARS,
  SKILL_RUN_MAX_OUTPUT_BYTES,
  SKILL_RUN_MAX_STDIN_CHARS,
  SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS,
  type SkillRuntimePreference,
  type SkillRuntimePolicy,
  type SkillScriptRuntime
} from '@shared/types/skill'
import { backgroundExecSessionManager } from '@/agent/shared/process/backgroundExecSessionManager'
import { mergeCommandEnvironment } from '@/agent/shared/process/shellEnvHelper'
import {
  createUtf8OutputDecoderPair,
  prepareProcessEnvForUtf8Output,
  prepareShellCommandForUtf8Output
} from '@/agent/shared/process/shellOutputEncoding'
import { resolveSessionDir } from '@/agent/shared/storage/sessionPaths'
import { resolveUsableSpawnCwd } from '@/agent/shared/process/spawnGuard'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import type { CommandShellDialect, ResolvedCommandShell } from '@shared/commandShell'
import type { ResolvedSkillExecutionAuthority } from './skillExecutionAuthority'
import {
  materializeSkillExecutionPackageTree,
  type MaterializedSkillExecutionPackageTree
} from './skillExecutionPackageTree'
import { canonicalSkillExecutionPackagePath } from '@/tape/domain/skillMaterialization'

const DEFAULT_TIMEOUT_MS = 120000
const FOREGROUND_OFFLOAD_THRESHOLD = 10000
const FOREGROUND_PREVIEW_CHARS = 12000
const FOREGROUND_KILL_GRACE_MS = 2000
const RUNTIME_PATH_MAX_ENTRIES = 256

export interface SkillRunRequest {
  skill: string
  script: string
  args?: string[]
  stdin?: string
  background?: boolean
  timeoutMs?: number
}

export interface SkillRunOptions {
  conversationId: string
  commandShell: ResolvedCommandShell
  outputPreviewChars?: number
  signal?: AbortSignal
  assertAuthorityCurrent: () => Promise<void>
  beforeExecute?: (normalizedArguments: Record<string, unknown>) => void
}

interface SkillExecutionServiceOptions {
  resolveConversationWorkdir?: (conversationId: string) => Promise<string | null>
}

interface SkillExecutionResult {
  output: string | { status: 'running'; sessionId: string }
  outputLimited?: boolean
  rtkApplied: boolean
  rtkMode: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  outputOffloadPath?: string
}

interface RuntimeCommand {
  command: string
  argsPrefix?: string[]
  mode: 'uv' | 'python' | 'node' | 'shell'
}

interface MaterializedSkillScript {
  relativePath: string
  absolutePath: string
  runtime: SkillScriptRuntime
  enabled: boolean
}

interface SpawnPlan {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  shellCommand?: string
  outputPrefix: string
  spawnMode: 'direct' | 'shell'
}

interface ForegroundExecutionResult {
  output: string
  outputOffloadPath?: string
  releasePackageTree: boolean
  aborted: boolean
  outputLimited: boolean
  abortReason?: unknown
}

export class SkillExecutionService {
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly resolveConversationWorkdir?: (conversationId: string) => Promise<string | null>

  constructor(options: SkillExecutionServiceOptions = {}) {
    this.resolveConversationWorkdir = options.resolveConversationWorkdir
    this.runtimeHelper.initializeRuntimes()
  }

  async execute(
    input: SkillRunRequest,
    authority: ResolvedSkillExecutionAuthority,
    options: SkillRunOptions
  ): Promise<SkillExecutionResult> {
    this.assertInputWithinLimits(input)
    options.signal?.throwIfAborted()
    await options.assertAuthorityCurrent()
    const tree = await materializeSkillExecutionPackageTree(authority.executionPackage)
    let ownershipTransferred = false
    try {
      await options.assertAuthorityCurrent()
      const preparedPlan = await this.preparePlanForExecution(
        await this.buildSpawnPlan(
          input,
          authority,
          tree,
          options.conversationId,
          options.commandShell,
          options.signal
        ),
        options.commandShell
      )
      const plan = { ...preparedPlan, cwd: resolveUsableSpawnCwd(preparedPlan.cwd) }
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const dispatchArguments = {
        skill: input.skill,
        script: input.script,
        args: input.args ?? [],
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        background: input.background === true,
        timeoutMs,
        resolvedCommand: plan.command,
        resolvedArgs: plan.args,
        resolvedCwd: plan.cwd,
        ...(plan.shellCommand === undefined ? {} : { shellCommand: plan.shellCommand }),
        spawnMode: plan.spawnMode,
        packageHash: authority.executionPackage.packageHash
      }
      const assertReadyForDispatch = async (): Promise<void> => {
        await tree.assertIntact()
        await options.assertAuthorityCurrent()
        options.beforeExecute?.(dispatchArguments)
      }

      if (input.background) {
        const displayCommand =
          plan.shellCommand ?? this.formatDirectInvocation(plan.command, plan.args)
        ownershipTransferred = true
        const result = await backgroundExecSessionManager.start(
          options.conversationId,
          displayCommand,
          plan.cwd,
          {
            commandShell: options.commandShell,
            ...(plan.spawnMode === 'direct'
              ? {
                  directInvocation: {
                    executable: plan.command,
                    args: plan.args
                  }
                }
              : {}),
            timeout: timeoutMs,
            env: plan.env,
            previewChars: options.outputPreviewChars ?? FOREGROUND_PREVIEW_CHARS,
            offloadThresholdChars: Math.min(
              FOREGROUND_OFFLOAD_THRESHOLD,
              options.outputPreviewChars ?? FOREGROUND_PREVIEW_CHARS
            ),
            maxOutputBytes: SKILL_RUN_MAX_OUTPUT_BYTES,
            ownedSkillExecutionPackageTree: tree.descriptor
          },
          assertReadyForDispatch
        )

        if (input.stdin !== undefined) {
          try {
            await backgroundExecSessionManager.write(
              options.conversationId,
              result.sessionId,
              input.stdin,
              true
            )
          } catch (error) {
            await backgroundExecSessionManager
              .remove(options.conversationId, result.sessionId)
              .catch((cleanupError) => {
                logger.warn('[SkillExecutionService] Failed to remove background session', {
                  sessionId: result.sessionId,
                  cleanupError
                })
              })
            throw error
          }
        }

        return {
          output: { status: 'running', sessionId: result.sessionId },
          rtkApplied: plan.spawnMode === 'shell',
          rtkMode: plan.spawnMode === 'shell' ? 'rewrite' : 'bypass'
        }
      }

      await assertReadyForDispatch()
      const foregroundResult = await this.runForeground(
        plan,
        timeoutMs,
        options.conversationId,
        options.commandShell,
        input.stdin,
        options.outputPreviewChars ?? FOREGROUND_PREVIEW_CHARS,
        options.signal
      )
      if (foregroundResult.releasePackageTree === false) {
        ownershipTransferred = true
        logger.warn('[SkillExecutionService] Retaining package tree for an unclosed process tree', {
          rootPath: tree.rootPath
        })
      }
      if (foregroundResult.aborted) {
        throw foregroundResult.abortReason
      }
      return {
        output: foregroundResult.output,
        outputLimited: foregroundResult.outputLimited,
        rtkApplied: plan.spawnMode === 'shell',
        rtkMode: plan.spawnMode === 'shell' ? 'rewrite' : 'bypass',
        outputOffloadPath: foregroundResult.outputOffloadPath
      }
    } finally {
      if (!ownershipTransferred) {
        await tree.cleanup().catch((error) => {
          logger.warn('[SkillExecutionService] Failed to clean foreground package tree', {
            rootPath: tree.rootPath,
            error
          })
        })
      }
    }
  }

  private assertInputWithinLimits(input: SkillRunRequest): void {
    const args = input.args ?? []
    if (
      args.length > SKILL_RUN_MAX_ARGUMENTS ||
      args.some((argument) => argument.length > SKILL_RUN_MAX_ARGUMENT_CHARS) ||
      args.reduce((total, argument) => total + argument.length, 0) >
        SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS
    ) {
      throw new Error('Skill execution arguments exceed the supported input limits.')
    }
    if ((input.stdin?.length ?? 0) > SKILL_RUN_MAX_STDIN_CHARS) {
      throw new Error('Skill execution stdin exceeds the supported input limit.')
    }
  }

  private async buildSpawnPlan(
    input: SkillRunRequest,
    authority: ResolvedSkillExecutionAuthority,
    tree: MaterializedSkillExecutionPackageTree,
    conversationId: string,
    commandShell: ResolvedCommandShell,
    signal?: AbortSignal
  ): Promise<SpawnPlan> {
    if (input.skill !== authority.identity.skillName) {
      throw new Error('Skill execution request does not match its request-bound package authority.')
    }

    const script = this.resolveRequestedScript(input.script, authority, tree)
    if (!script.enabled) {
      throw new Error(`Skill script "${script.relativePath}" is disabled`)
    }

    const executionCwd = await this.resolveExecutionCwd(conversationId, tree.packageRoot)
    const mergedEnv = mergeCommandEnvironment({
      overrides: {
        ...authority.environment,
        SKILL_ROOT: tree.packageRoot,
        DEEPCHAT_SKILL_ROOT: tree.packageRoot
      }
    })

    const runtime = await this.resolveRuntimeCommand(
      script,
      authority.executionPackage.runtimePolicy,
      mergedEnv,
      commandShell,
      signal
    )
    const args = this.buildRuntimeArgs(runtime, script, tree.packageRoot, input.args ?? [])

    return {
      command: runtime.command,
      args,
      cwd: executionCwd,
      env: mergedEnv,
      ...(commandShell.dialect === 'cmd'
        ? {}
        : { shellCommand: this.buildShellCommand(runtime.command, args, commandShell.dialect) }),
      outputPrefix: `skillrun_${input.skill.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      spawnMode: 'direct'
    }
  }

  private async resolveExecutionCwd(conversationId: string, packageRoot: string): Promise<string> {
    const normalizedPackageRoot = path.resolve(packageRoot)
    if (!this.resolveConversationWorkdir) {
      return this.resolveFallbackExecutionCwd(conversationId, normalizedPackageRoot)
    }

    try {
      const resolvedWorkdir = await this.resolveConversationWorkdir(conversationId)
      const normalizedWorkdir = resolvedWorkdir?.trim()
      if (normalizedWorkdir) {
        const resolvedPath = path.resolve(normalizedWorkdir)
        try {
          const stat = await fs.promises.stat(resolvedPath)
          if (stat.isDirectory()) {
            return resolvedPath
          }
          logger.warn('[SkillExecutionService] Conversation workdir is not a directory', {
            conversationId,
            invalidWorkdir: resolvedPath
          })
        } catch (error) {
          logger.warn('[SkillExecutionService] Conversation workdir is invalid', {
            conversationId,
            invalidWorkdir: resolvedPath,
            error
          })
        }
      }
    } catch (error) {
      logger.warn('[SkillExecutionService] Failed to resolve conversation workdir', {
        conversationId,
        error
      })
    }

    logger.warn('[SkillExecutionService] Missing conversation workdir, using session directory', {
      conversationId,
      packageRoot: normalizedPackageRoot
    })
    return this.resolveFallbackExecutionCwd(conversationId, normalizedPackageRoot)
  }

  private resolveFallbackExecutionCwd(conversationId: string, packageRoot: string): string {
    const sessionDir = resolveSessionDir(conversationId)
    if (!sessionDir) {
      return packageRoot
    }

    try {
      fs.mkdirSync(sessionDir, { recursive: true })
      return sessionDir
    } catch (error) {
      logger.warn(
        '[SkillExecutionService] Failed to create session directory, using package root',
        {
          conversationId,
          sessionDir,
          packageRoot,
          error
        }
      )
    }

    return packageRoot
  }

  private resolveRequestedScript(
    requestedScript: string,
    authority: ResolvedSkillExecutionAuthority,
    tree: MaterializedSkillExecutionPackageTree
  ): MaterializedSkillScript {
    let canonicalPath: string
    try {
      canonicalPath = canonicalSkillExecutionPackagePath(requestedScript)
    } catch {
      throw new Error(`Skill script "${requestedScript}" is not a canonical package path`)
    }
    const executable = authority.executionPackage.executables.find(
      (candidate) => candidate.relativePath === canonicalPath
    )
    if (!executable) throw new Error(`Skill script "${requestedScript}" not found in package`)

    return {
      ...executable,
      absolutePath: tree.resolveFile(executable.relativePath)
    }
  }

  private async resolveRuntimeCommand(
    script: MaterializedSkillScript,
    runtimePolicy: SkillRuntimePolicy,
    env: Record<string, string>,
    commandShell: ResolvedCommandShell,
    signal?: AbortSignal
  ): Promise<RuntimeCommand> {
    if (script.runtime === 'shell') {
      const supportedProfile =
        process.platform === 'win32'
          ? commandShell.profile === 'git-bash'
          : ['posix', 'bash', 'zsh', 'fish'].includes(commandShell.profile)
      if (commandShell.dialect !== 'posix' || !supportedProfile) {
        if (process.platform !== 'win32') {
          throw new Error('Shell skill scripts require a platform-compatible POSIX command shell')
        }
        throw new Error('Shell skill scripts on Windows require the Git Bash command shell')
      }
      return { command: commandShell.executable, mode: 'shell' }
    }

    if (script.runtime === 'node') {
      return await this.resolveNodeRuntime(runtimePolicy.node, env, signal)
    }

    return await this.resolvePythonRuntime(runtimePolicy.python, env, signal)
  }

  private async resolvePythonRuntime(
    preference: SkillRuntimePreference,
    env: Record<string, string>,
    signal?: AbortSignal
  ): Promise<RuntimeCommand> {
    if (preference === 'builtin') {
      const bundledUv = this.getBundledRuntimeCommand('uv')
      if (!bundledUv) {
        throw new Error('Bundled uv runtime is not available')
      }
      return { command: bundledUv, mode: 'uv' }
    }

    if (preference === 'system') {
      const system = await this.findSystemPythonRuntime(env, signal)
      if (!system) {
        throw new Error('No compatible system Python runtime found for this skill')
      }
      return system
    }

    const systemUv = await this.resolveSystemCommand('uv', env, signal)
    if (systemUv) {
      return { command: systemUv, mode: 'uv' }
    }

    const bundledUv = this.getBundledRuntimeCommand('uv')
    if (bundledUv) {
      return { command: bundledUv, mode: 'uv' }
    }

    const fallback = await this.findSystemPythonRuntime(env, signal)
    if (!fallback) {
      throw new Error('No compatible Python runtime found for this skill')
    }
    return fallback
  }

  private async resolveNodeRuntime(
    preference: SkillRuntimePreference,
    env: Record<string, string>,
    signal?: AbortSignal
  ): Promise<RuntimeCommand> {
    if (preference === 'builtin') {
      const bundledNode = this.getBundledRuntimeCommand('node')
      if (!bundledNode) {
        throw new Error('Bundled node runtime is not available')
      }
      return { command: bundledNode, mode: 'node' }
    }

    if (preference === 'system') {
      const systemNode = await this.resolveSystemCommand('node', env, signal)
      if (!systemNode) {
        throw new Error('System node runtime is not available')
      }
      return { command: systemNode, mode: 'node' }
    }

    const systemNode = await this.resolveSystemCommand('node', env, signal)
    if (systemNode) {
      return { command: systemNode, mode: 'node' }
    }

    const bundledNode = this.getBundledRuntimeCommand('node')
    if (!bundledNode) {
      throw new Error('No compatible node runtime found for this skill')
    }
    return { command: bundledNode, mode: 'node' }
  }

  private async findSystemPythonRuntime(
    env: Record<string, string>,
    signal?: AbortSignal
  ): Promise<RuntimeCommand | null> {
    const candidates: Array<{ command: string; argsPrefix?: string[] }> =
      process.platform === 'win32'
        ? [{ command: 'python' }, { command: 'py', argsPrefix: ['-3'] }]
        : [{ command: 'python3' }, { command: 'python' }]

    for (const candidate of candidates) {
      const executable = await this.resolveSystemCommand(candidate.command, env, signal)
      if (executable) {
        return {
          command: executable,
          argsPrefix: candidate.argsPrefix,
          mode: 'python'
        }
      }
    }

    return null
  }

  private buildRuntimeArgs(
    runtime: RuntimeCommand,
    script: MaterializedSkillScript,
    packageRoot: string,
    args: string[]
  ): string[] {
    if (runtime.mode === 'uv') {
      const commandArgs = ['run']
      if (fs.existsSync(path.join(packageRoot, 'pyproject.toml'))) {
        commandArgs.push('--project', packageRoot)
      }
      commandArgs.push(script.absolutePath, ...args)
      return commandArgs
    }

    if (runtime.mode === 'python') {
      return [...(runtime.argsPrefix ?? []), script.absolutePath, ...args]
    }

    if (runtime.mode === 'node') {
      return [script.absolutePath, ...args]
    }

    return [script.absolutePath, ...args]
  }

  private async runForeground(
    plan: SpawnPlan,
    timeoutMs: number,
    conversationId: string,
    commandShell: ResolvedCommandShell,
    stdin?: string,
    outputPreviewChars = FOREGROUND_PREVIEW_CHARS,
    signal?: AbortSignal,
    maxOutputBytes = SKILL_RUN_MAX_OUTPUT_BYTES
  ): Promise<ForegroundExecutionResult> {
    signal?.throwIfAborted()
    const outputFilePath = this.createForegroundOutputPath(conversationId, plan.outputPrefix)
    const offloadThresholdChars = Math.min(FOREGROUND_OFFLOAD_THRESHOLD, outputPreviewChars)

    return await new Promise((resolve, reject) => {
      const shellRuntime = plan.spawnMode === 'shell' ? commandShell : null
      if (shellRuntime && plan.shellCommand === undefined) {
        reject(new Error('Shell spawn plan is missing a serialized command'))
        return
      }
      const command = shellRuntime ? shellRuntime.executable : plan.command
      const shellCommand = shellRuntime
        ? prepareShellCommandForUtf8Output(shellRuntime.dialect, plan.shellCommand ?? '')
        : undefined
      const args = shellRuntime ? [...shellRuntime.args, shellCommand ?? ''] : plan.args
      const env = prepareProcessEnvForUtf8Output(plan.env)
      const child = spawn(command, args, {
        cwd: plan.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })

      let outputBuffer = ''
      let totalOutputLength = 0
      let totalOutputBytes = 0
      let offloaded = false
      let offloadDisabled = outputFilePath === null
      let activeOutputFilePath = outputFilePath
      let timedOut = false
      let outputWriteQueue = Promise.resolve()
      let timeoutId: NodeJS.Timeout | null = null
      let settled = false
      let releasePackageTree = true
      let aborted = false
      let abortReason: unknown
      let terminationStarted = false
      let outputLimited = false

      const outputDecoders = createUtf8OutputDecoderPair((data) => appendOutput(data))

      const cleanupTimers = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const onAbort = () => {
        aborted = true
        abortReason = signal?.reason ?? new DOMException('Aborted', 'AbortError')
        requestTermination('cancelled')
      }

      const cleanupAbortListener = () => {
        signal?.removeEventListener('abort', onAbort)
      }

      const settleUnclosedProcessTree = () => {
        if (settled) return
        releasePackageTree = false
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.stdin?.destroy()
        if (typeof child.unref === 'function') {
          child.unref()
        }
        void settleProcess(null)
      }

      const settleProcess = async (code: number | null, error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        cleanupTimers()
        cleanupAbortListener()
        child.removeAllListeners('error')
        child.removeAllListeners('close')
        outputDecoders.flush()

        try {
          await outputWriteQueue
        } catch {
          // Already logged when the queue failed.
        }

        if (error && !aborted) {
          reject(error)
          return
        }

        const preview =
          offloaded && activeOutputFilePath
            ? this.readLastCharsFromFile(activeOutputFilePath, outputPreviewChars)
            : outputBuffer

        const lines: string[] = []
        if (preview.trim()) {
          lines.push(preview.trimEnd())
        }
        lines.push(`Exit Code: ${code ?? 'null'}`)
        if (timedOut) {
          lines.push('Timed out')
        }
        if (offloaded && activeOutputFilePath) {
          lines.push(`Output offloaded: ${activeOutputFilePath}`)
        }
        resolve({
          output: lines.join('\n'),
          outputOffloadPath: offloaded ? (activeOutputFilePath ?? undefined) : undefined,
          releasePackageTree,
          aborted,
          outputLimited,
          ...(aborted ? { abortReason } : {})
        })
      }

      const requestTermination = (cause: 'cancelled' | 'timed-out' | 'output-limited') => {
        if (settled || terminationStarted) return
        terminationStarted = true
        timedOut = cause === 'timed-out'
        void terminateProcessTree(child, { graceMs: FOREGROUND_KILL_GRACE_MS })
          .then((closed) => {
            if (closed || settled) return
            settleUnclosedProcessTree()
          })
          .catch((error) => {
            logger.warn(`[SkillExecutionService] Failed to terminate ${cause} process tree`, {
              error
            })
            settleUnclosedProcessTree()
          })
      }

      const appendToOutputBuffer = (data: string) => {
        if (!data) {
          return
        }

        outputBuffer += data
        if (outputBuffer.length > outputPreviewChars) {
          outputBuffer = outputBuffer.slice(-outputPreviewChars)
        }
      }

      const disableOffload = (data: string) => {
        const filePreview =
          offloaded && activeOutputFilePath
            ? this.readLastCharsFromFile(activeOutputFilePath, outputPreviewChars)
            : ''

        offloaded = false
        offloadDisabled = true
        activeOutputFilePath = null
        outputBuffer = ''
        appendToOutputBuffer(filePreview)
        appendToOutputBuffer(data)
      }

      const queueOutputWrite = (data: string) => {
        if (offloadDisabled || !activeOutputFilePath || !data) {
          offloaded = false
          appendToOutputBuffer(data)
          return
        }

        const targetOutputFilePath = activeOutputFilePath
        outputWriteQueue = outputWriteQueue
          .then(async () => {
            if (
              !targetOutputFilePath ||
              offloadDisabled ||
              activeOutputFilePath !== targetOutputFilePath
            ) {
              appendToOutputBuffer(data)
              return
            }

            await fs.promises.appendFile(targetOutputFilePath, data, 'utf-8')
          })
          .catch((error) => {
            logger.warn('[SkillExecutionService] Failed to flush foreground output', {
              outputFilePath: targetOutputFilePath,
              error
            })
            disableOffload(data)
          })
      }

      const appendAcceptedOutput = (data: string) => {
        totalOutputLength += data.length
        const shouldOffload =
          !offloadDisabled &&
          activeOutputFilePath !== null &&
          (offloaded || totalOutputLength > offloadThresholdChars)

        if (!shouldOffload) {
          appendToOutputBuffer(data)
          return
        }

        offloaded = true
        const chunk = outputBuffer + data
        outputBuffer = ''
        queueOutputWrite(chunk)
      }

      const appendOutput = (data: string) => {
        if (!data || outputLimited) return
        const dataBytes = Buffer.byteLength(data, 'utf8')
        if (totalOutputBytes + dataBytes > maxOutputBytes) {
          outputLimited = true
          appendAcceptedOutput(`\n[Process terminated: output exceeded ${maxOutputBytes} bytes.]\n`)
          requestTermination('output-limited')
          return
        }
        totalOutputBytes += dataBytes
        appendAcceptedOutput(data)
      }

      child.stdout?.on('data', (data: Buffer | string) => outputDecoders.writeStdout(data))
      child.stderr?.on('data', (data: Buffer | string) => outputDecoders.writeStderr(data))

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }

      child.stdin?.on('error', (error) => {
        logger.warn('[SkillExecutionService] Failed to write skill stdin', { error })
      })
      if (!aborted && stdin !== undefined) {
        child.stdin?.write(stdin)
      }
      child.stdin?.end()

      if (!settled) {
        timeoutId = setTimeout(() => {
          requestTermination('timed-out')
        }, timeoutMs)
      }

      child.on('error', (error) => {
        void settleProcess(null, error)
      })

      child.on('close', async (code) => {
        void settleProcess(code ?? null)
      })
    })
  }

  private async preparePlanForExecution(
    plan: SpawnPlan,
    commandShell: ResolvedCommandShell
  ): Promise<SpawnPlan> {
    if (commandShell.dialect === 'cmd') {
      if (plan.spawnMode === 'shell') {
        throw new Error('Skill shell execution is unavailable under Command Prompt')
      }
      return {
        ...plan,
        shellCommand: undefined
      }
    }

    if (commandShell.dialect === 'powershell') {
      if (plan.spawnMode === 'shell') {
        throw new Error('Skill shell execution is unavailable under Windows PowerShell')
      }
      return {
        ...plan,
        shellCommand: undefined
      }
    }

    if (plan.shellCommand === undefined) {
      throw new Error('Shell-capable skill plan is missing a serialized command')
    }

    return plan
  }

  private buildShellCommand(
    command: string,
    args: string[],
    dialect: Exclude<CommandShellDialect, 'cmd'>
  ): string {
    const invocation = [command, ...args]
      .map((token) => this.quoteForShell(token, dialect))
      .join(' ')
    return dialect === 'powershell' ? `& ${invocation}` : invocation
  }

  private quoteForShell(token: string, dialect: Exclude<CommandShellDialect, 'cmd'>): string {
    if (dialect === 'powershell') return `'${token.replace(/'/g, "''")}'`
    return `'${token.replace(/'/g, `'\\''`)}'`
  }

  private formatDirectInvocation(command: string, args: string[]): string {
    return [command, ...args].map((token) => JSON.stringify(token)).join(' ')
  }

  private getBundledRuntimeCommand(command: 'uv' | 'node'): string | null {
    this.runtimeHelper.initializeRuntimes()

    if (command === 'uv' && !this.runtimeHelper.getUvRuntimePath()) {
      return null
    }
    if (command === 'node' && !this.runtimeHelper.getNodeRuntimePath()) {
      return null
    }

    const resolved = this.runtimeHelper.replaceWithRuntimeCommand(command, true, true)
    return resolved === command ? null : resolved
  }

  private async resolveSystemCommand(
    command: string,
    env: Record<string, string>,
    signal?: AbortSignal
  ): Promise<string | null> {
    signal?.throwIfAborted()
    const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
    if (!pathValue) return null
    const platformPath = process.platform === 'win32' ? path.win32 : path.posix
    const pathEntries = pathValue
      .split(platformPath.delimiter, RUNTIME_PATH_MAX_ENTRIES)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
      .filter((entry) => platformPath.isAbsolute(entry))
    const pathExtValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATHEXT')?.[1]
    const extensions =
      process.platform !== 'win32' || platformPath.extname(command)
        ? ['']
        : (pathExtValue || '.COM;.EXE')
            .split(';')
            .map((extension) => extension.trim().toUpperCase())
            .filter((extension) => extension === '.COM' || extension === '.EXE')

    for (const directory of pathEntries) {
      for (const extension of extensions) {
        signal?.throwIfAborted()
        const candidate = platformPath.resolve(directory, `${command}${extension}`)
        let resolved: string
        let stat: fs.Stats
        try {
          resolved = await fs.promises.realpath(candidate)
          signal?.throwIfAborted()
          stat = await fs.promises.stat(resolved)
          signal?.throwIfAborted()
          await fs.promises.access(
            resolved,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
          )
        } catch {
          signal?.throwIfAborted()
          continue
        }
        if (stat.isFile()) return resolved
      }
    }

    return null
  }

  private createForegroundOutputPath(conversationId: string, prefix: string): string | null {
    const sessionDir = resolveSessionDir(conversationId)
    if (!sessionDir) {
      return null
    }

    try {
      fs.mkdirSync(sessionDir, { recursive: true })
      return path.join(sessionDir, `${prefix}_${Date.now()}.log`)
    } catch (error) {
      logger.warn('[SkillExecutionService] Failed to create session directory for output offload', {
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
        fs.readSync(fd, buffer, 0, bytesToRead, startPosition)
        const content = buffer.toString('utf-8')
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
      logger.warn('[SkillExecutionService] Failed to read preview from offloaded output', {
        filePath,
        error
      })
      return ''
    }
  }
}
