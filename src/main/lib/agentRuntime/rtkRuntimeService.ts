import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { IConfigPresenter } from '@shared/presenter'
import type {
  RtkFailureStage,
  RtkHealthStatus,
  RtkRuntimeSource,
  UsageDashboardRtkData,
  UsageDashboardRtkDay,
  UsageDashboardRtkSummary
} from '@shared/types/agent-interface'
import logger from '@shared/logger'
import { getShellEnvironment, mergeCommandEnvironment } from './shellEnvHelper'
import { RuntimeHelper } from '../runtimeHelper'

const RTK_ENABLED_SETTING_KEY = 'rtkEnabled'
const RTK_HEALTH_TIMEOUT_MS = 12000
const RTK_REWRITE_TIMEOUT_MS = 8000
const RTK_CIRCUIT_BREAKER_THRESHOLD = 3

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  signal: NodeJS.Signals | null
  timedOut: boolean
}

interface CommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

interface ResolvedRuntime {
  command: string
  source: Exclude<RtkRuntimeSource, 'none'>
}

interface RtkRuntimeHealthState {
  health: RtkHealthStatus
  checkedAt: number | null
  source: RtkRuntimeSource
  failureStage: RtkFailureStage | null
  failureMessage: string | null
}

interface PrepareShellCommandResult {
  originalCommand: string
  command: string
  env: Record<string, string>
  rewritten: boolean
  usedRtk: boolean
  rtkApplied: boolean
  rtkMode: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
}

interface RtkRuntimeServiceDeps {
  runtimeHelper?: Pick<
    RuntimeHelper,
    | 'initializeRuntimes'
    | 'refreshRuntimes'
    | 'replaceWithRuntimeCommand'
    | 'getRtkRuntimePath'
    | 'prependBundledRuntimeToEnv'
  >
  getShellEnvironment?: () => Promise<Record<string, string>>
  runCommand?: (command: string, args: string[], options?: CommandOptions) => Promise<CommandResult>
  getPath?: (name: 'userData' | 'temp') => string
  now?: () => number
}

class RtkHealthCheckError extends Error {
  constructor(
    public readonly stage: Exclude<RtkFailureStage, 'runtime'>,
    message: string
  ) {
    super(message)
    this.name = 'RtkHealthCheckError'
  }
}

function createEmptyRtkSummary(): UsageDashboardRtkSummary {
  return {
    totalCommands: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalSavedTokens: 0,
    avgSavingsPct: 0,
    totalTimeMs: 0,
    avgTimeMs: 0
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null
    let killTimeoutId: NodeJS.Timeout | null = null

    const settle = (result: CommandResult) => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (killTimeoutId) {
        clearTimeout(killTimeoutId)
      }
      resolve(result)
    }

    const timeoutMs = options.timeoutMs ?? RTK_HEALTH_TIMEOUT_MS
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore kill failures
        }
        killTimeoutId = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore kill failures
          }
        }, 1000)
      }, timeoutMs)
    }

    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      settle({
        code: null,
        stdout,
        stderr: stderr || getErrorMessage(error),
        signal: null,
        timedOut
      })
    })

    child.on('close', (code, signal) => {
      settle({
        code: code ?? null,
        stdout,
        stderr,
        signal: signal ?? null,
        timedOut
      })
    })
  })
}

export class RtkRuntimeService {
  private readonly runtimeHelper
  private readonly getShellEnvironmentImpl
  private readonly runCommandImpl
  private readonly getPathImpl
  private readonly nowImpl
  private healthState: RtkRuntimeHealthState = {
    health: 'checking',
    checkedAt: null,
    source: 'none',
    failureStage: null,
    failureMessage: null
  }
  private resolvedRuntime: ResolvedRuntime | null = null
  private healthCheckPromise: Promise<RtkRuntimeHealthState> | null = null
  private executionFailureCount = 0

  constructor(deps: RtkRuntimeServiceDeps = {}) {
    this.runtimeHelper = deps.runtimeHelper ?? RuntimeHelper.getInstance()
    this.getShellEnvironmentImpl = deps.getShellEnvironment ?? getShellEnvironment
    this.runCommandImpl = deps.runCommand ?? defaultRunCommand
    this.getPathImpl = deps.getPath ?? ((name) => app.getPath(name))
    this.nowImpl = deps.now ?? (() => Date.now())
  }

  getHealthState(): RtkRuntimeHealthState {
    return { ...this.healthState }
  }

  getUserEnabled(configPresenter: Pick<IConfigPresenter, 'getSetting'>): boolean {
    return configPresenter.getSetting<boolean>(RTK_ENABLED_SETTING_KEY) !== false
  }

  isEffectivelyEnabled(configPresenter: Pick<IConfigPresenter, 'getSetting'>): boolean {
    return (
      this.getUserEnabled(configPresenter) &&
      this.healthState.health === 'healthy' &&
      this.resolvedRuntime !== null
    )
  }

  async startHealthCheck(): Promise<RtkRuntimeHealthState> {
    return await this.runHealthCheck(false)
  }

  async retryHealthCheck(): Promise<RtkRuntimeHealthState> {
    return await this.runHealthCheck(true)
  }

  getAppTrackingDbPath(): string {
    return path.join(this.getPathImpl('userData'), 'rtk', 'history.db')
  }

  async getDashboardData(
    configPresenter: Pick<IConfigPresenter, 'getSetting'>
  ): Promise<UsageDashboardRtkData> {
    const enabled = this.getUserEnabled(configPresenter)
    const state = this.getHealthState()
    const base: UsageDashboardRtkData = {
      scope: 'deepchat',
      enabled,
      effectiveEnabled: this.isEffectivelyEnabled(configPresenter),
      available: state.source !== 'none',
      health: state.health,
      checkedAt: state.checkedAt,
      source: state.source,
      failureStage: state.failureStage,
      failureMessage: state.failureMessage,
      summary: createEmptyRtkSummary(),
      daily: []
    }

    const runtime = this.resolvedRuntime
    if (!runtime) {
      return base
    }

    try {
      const env = await this.createRuntimeEnv({}, this.getAppTrackingDbPath())
      const result = await this.runCommandImpl(
        runtime.command,
        ['gain', '--all', '--format', 'json'],
        {
          env,
          timeoutMs: RTK_HEALTH_TIMEOUT_MS
        }
      )

      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || 'rtk gain failed')
      }

      const parsed = this.parseGainJson(result.stdout)
      return {
        ...base,
        available: true,
        summary: parsed.summary,
        daily: parsed.daily
      }
    } catch (error) {
      logger.warn('[RtkRuntimeService] Failed to load RTK dashboard data', { error })
      return {
        ...base,
        failureMessage: base.failureMessage ?? getErrorMessage(error)
      }
    }
  }

  async prepareShellCommand(
    rawCommand: string,
    env: Record<string, string>,
    configPresenter: Pick<IConfigPresenter, 'getSetting'>
  ): Promise<PrepareShellCommandResult> {
    const preparedEnv = await this.prepareExecutionEnv(env)

    if (!this.isEffectivelyEnabled(configPresenter)) {
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: this.describeBypassReason(configPresenter)
      }
    }

    const runtime = this.resolvedRuntime
    if (!runtime) {
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: 'RTK runtime is not available'
      }
    }

    if (this.isRtkCommand(rawCommand)) {
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: true,
        rtkApplied: true,
        rtkMode: 'direct'
      }
    }

    const bypassReason = this.getRewriteBypassReason(rawCommand)
    if (bypassReason) {
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: bypassReason
      }
    }

    try {
      const rewriteResult = await this.runCommandImpl(runtime.command, ['rewrite', rawCommand], {
        env: preparedEnv,
        timeoutMs: RTK_REWRITE_TIMEOUT_MS
      })

      if (rewriteResult.code === 0) {
        const rewritten = rewriteResult.stdout.trim()
        if (rewritten) {
          this.recordRuntimeSuccess()
          return {
            originalCommand: rawCommand,
            command: rewritten,
            env: preparedEnv,
            rewritten: true,
            usedRtk: true,
            rtkApplied: true,
            rtkMode: 'rewrite'
          }
        }
      }

      if (rewriteResult.code === 1) {
        this.recordRuntimeSuccess()
        return {
          originalCommand: rawCommand,
          command: rawCommand,
          env: preparedEnv,
          rewritten: false,
          usedRtk: false,
          rtkApplied: false,
          rtkMode: 'bypass',
          rtkFallbackReason: 'RTK rewrite did not match this command'
        }
      }

      const failureMessage =
        rewriteResult.stderr.trim() || rewriteResult.stdout.trim() || 'rtk rewrite failed'
      this.recordRuntimeFailure('rewrite', failureMessage)
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: failureMessage
      }
    } catch (error) {
      const failureMessage = getErrorMessage(error)
      this.recordRuntimeFailure('rewrite', failureMessage)
      return {
        originalCommand: rawCommand,
        command: rawCommand,
        env: preparedEnv,
        rewritten: false,
        usedRtk: false,
        rtkApplied: false,
        rtkMode: 'bypass',
        rtkFallbackReason: failureMessage
      }
    }
  }

  async prepareExecutionEnv(
    env: Record<string, string>,
    options: { includeTrackingDb?: boolean } = {}
  ): Promise<Record<string, string>> {
    const includeTrackingDb = options.includeTrackingDb ?? true
    return await this.createRuntimeEnv(
      env,
      includeTrackingDb ? this.getAppTrackingDbPath() : undefined
    )
  }

  private async runHealthCheck(force: boolean): Promise<RtkRuntimeHealthState> {
    if (this.healthCheckPromise && !force) {
      return await this.healthCheckPromise
    }

    this.healthState = {
      health: 'checking',
      checkedAt: this.healthState.checkedAt,
      source: this.healthState.source,
      failureStage: null,
      failureMessage: null
    }

    const promise = this.performHealthCheck().finally(() => {
      if (this.healthCheckPromise === promise) {
        this.healthCheckPromise = null
      }
    })

    this.healthCheckPromise = promise
    return await promise
  }

  private async performHealthCheck(): Promise<RtkRuntimeHealthState> {
    this.executionFailureCount = 0

    const candidates = this.resolveRuntimeCandidates()
    if (candidates.length === 0) {
      this.resolvedRuntime = null
      this.healthState = this.createUnhealthyState('none', 'resolve', 'RTK binary not found')
      return this.getHealthState()
    }

    let lastError: { source: RtkRuntimeSource; stage: RtkFailureStage; message: string } | null =
      null

    for (const candidate of candidates) {
      try {
        await this.verifyRuntimeCandidate(candidate)
        this.resolvedRuntime = candidate
        this.healthState = {
          health: 'healthy',
          checkedAt: this.nowImpl(),
          source: candidate.source,
          failureStage: null,
          failureMessage: null
        }
        return this.getHealthState()
      } catch (error) {
        const message = getErrorMessage(error)
        const stage = error instanceof RtkHealthCheckError ? error.stage : 'version'
        lastError = {
          source: candidate.source,
          stage,
          message
        }
        logger.warn('[RtkRuntimeService] RTK health check failed for candidate', {
          candidate,
          stage,
          error
        })
      }
    }

    this.resolvedRuntime = null
    this.healthState = this.createUnhealthyState(
      lastError?.source ?? 'none',
      lastError?.stage ?? 'resolve',
      lastError?.message ?? 'RTK health check failed'
    )
    return this.getHealthState()
  }

  private resolveRuntimeCandidates(): ResolvedRuntime[] {
    if (typeof this.runtimeHelper.refreshRuntimes === 'function') {
      this.runtimeHelper.refreshRuntimes()
    } else {
      this.runtimeHelper.initializeRuntimes()
    }

    const candidates: ResolvedRuntime[] = []
    const bundledRuntimePath = this.runtimeHelper.getRtkRuntimePath()
    if (bundledRuntimePath) {
      const bundledCommand = this.runtimeHelper.replaceWithRuntimeCommand('rtk', true, true)
      if (bundledCommand !== 'rtk') {
        candidates.push({
          command: bundledCommand,
          source: 'bundled'
        })
      } else {
        const fallbackBinary = path.join(
          bundledRuntimePath,
          process.platform === 'win32' ? 'rtk.exe' : 'rtk'
        )
        candidates.push({
          command: fallbackBinary,
          source: 'bundled'
        })
      }
    }

    candidates.push({
      command: 'rtk',
      source: 'system'
    })

    return candidates
  }

  private async verifyRuntimeCandidate(candidate: ResolvedRuntime): Promise<void> {
    const baseEnv = await this.createRuntimeEnv({}, undefined)

    const version = await this.runCommandImpl(candidate.command, ['--version'], {
      env: baseEnv,
      timeoutMs: RTK_HEALTH_TIMEOUT_MS
    })
    if (version.code !== 0) {
      throw new RtkHealthCheckError(
        'version',
        version.stderr.trim() || version.stdout.trim() || 'rtk --version failed'
      )
    }

    const rewrite = await this.runCommandImpl(candidate.command, ['rewrite', 'git status'], {
      env: baseEnv,
      timeoutMs: RTK_HEALTH_TIMEOUT_MS
    })
    if (rewrite.code !== 0 || !rewrite.stdout.trim()) {
      throw new RtkHealthCheckError(
        'rewrite',
        rewrite.stderr.trim() || rewrite.stdout.trim() || 'rtk rewrite failed'
      )
    }

    const resolvedRtk = await this.runCommandImpl('rtk', ['--version'], {
      env: baseEnv,
      timeoutMs: RTK_HEALTH_TIMEOUT_MS
    })
    if (resolvedRtk.code !== 0) {
      throw new RtkHealthCheckError(
        'smoke',
        resolvedRtk.stderr.trim() ||
          resolvedRtk.stdout.trim() ||
          'rtk is not resolvable via injected PATH'
      )
    }

    const bundledRipgrepCommand = this.runtimeHelper.replaceWithRuntimeCommand('rg', true, true)
    if (bundledRipgrepCommand !== 'rg') {
      const resolvedRg = await this.runCommandImpl('rg', ['--version'], {
        env: baseEnv,
        timeoutMs: RTK_HEALTH_TIMEOUT_MS
      })
      if (resolvedRg.code !== 0) {
        throw new RtkHealthCheckError(
          'smoke',
          resolvedRg.stderr.trim() ||
            resolvedRg.stdout.trim() ||
            'rg is not resolvable via injected PATH'
        )
      }
    }

    const tempRoot = fs.mkdtempSync(path.join(this.getPathImpl('temp'), 'deepchat-rtk-health-'))
    try {
      const healthFilePath = path.join(tempRoot, 'health.txt')
      fs.writeFileSync(healthFilePath, 'ok', 'utf-8')
      const smokeDbPath = path.join(tempRoot, 'tracking.db')
      const smokeEnv = await this.createRuntimeEnv({}, smokeDbPath)
      const smoke = await this.runCommandImpl(candidate.command, ['read', healthFilePath], {
        cwd: tempRoot,
        env: smokeEnv,
        timeoutMs: RTK_HEALTH_TIMEOUT_MS
      })
      if (smoke.code !== 0 || !smoke.stdout.trim()) {
        throw new RtkHealthCheckError(
          'smoke',
          smoke.stderr.trim() || smoke.stdout.trim() || 'rtk smoke test failed'
        )
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }

    const gainEnv = await this.createRuntimeEnv({}, this.getAppTrackingDbPath())
    const gain = await this.runCommandImpl(
      candidate.command,
      ['gain', '--all', '--format', 'json'],
      {
        env: gainEnv,
        timeoutMs: RTK_HEALTH_TIMEOUT_MS
      }
    )
    if (gain.code !== 0) {
      throw new RtkHealthCheckError(
        'gain',
        gain.stderr.trim() || gain.stdout.trim() || 'rtk gain failed'
      )
    }

    this.parseGainJson(gain.stdout)
  }

  private async createRuntimeEnv(
    baseEnv: Record<string, string>,
    dbPath?: string
  ): Promise<Record<string, string>> {
    const shellEnv = await this.getShellEnvironmentImpl()
    const env = this.runtimeHelper.prependBundledRuntimeToEnv(
      mergeCommandEnvironment({
        shellEnv,
        overrides: baseEnv
      })
    )

    if (dbPath) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      env.RTK_DB_PATH = dbPath
    }

    return env
  }

  private parseGainJson(output: string): {
    summary: UsageDashboardRtkSummary
    daily: UsageDashboardRtkDay[]
  } {
    const parsed = asRecord(JSON.parse(output))
    if (!parsed) {
      throw new Error('Invalid RTK gain JSON output')
    }

    const summaryRecord = asRecord(parsed.summary) ?? {}
    const daily = Array.isArray(parsed.daily)
      ? parsed.daily
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => entry !== null)
          .map((entry) => ({
            date: typeof entry.date === 'string' ? entry.date : '',
            commands: toNumber(entry.commands),
            inputTokens: toNumber(entry.input_tokens),
            outputTokens: toNumber(entry.output_tokens),
            savedTokens: toNumber(entry.saved_tokens),
            savingsPct: toNumber(entry.savings_pct),
            totalTimeMs: toNumber(entry.total_time_ms),
            avgTimeMs: toNumber(entry.avg_time_ms)
          }))
          .filter((entry) => entry.date)
      : []

    return {
      summary: {
        totalCommands: toNumber(summaryRecord.total_commands),
        totalInputTokens: toNumber(summaryRecord.total_input),
        totalOutputTokens: toNumber(summaryRecord.total_output),
        totalSavedTokens: toNumber(summaryRecord.total_saved),
        avgSavingsPct: toNumber(summaryRecord.avg_savings_pct),
        totalTimeMs: toNumber(summaryRecord.total_time_ms),
        avgTimeMs: toNumber(summaryRecord.avg_time_ms)
      },
      daily
    }
  }

  private recordRuntimeSuccess(): void {
    this.executionFailureCount = 0
  }

  private recordRuntimeFailure(
    stage: Extract<RtkFailureStage, 'rewrite' | 'runtime'>,
    message: string
  ): void {
    this.executionFailureCount += 1

    logger.warn('[RtkRuntimeService] RTK execution failed', {
      stage,
      failureCount: this.executionFailureCount,
      message
    })

    if (this.executionFailureCount >= RTK_CIRCUIT_BREAKER_THRESHOLD) {
      this.healthState = this.createUnhealthyState(this.healthState.source, 'runtime', message)
    }
  }

  private createUnhealthyState(
    source: RtkRuntimeSource,
    stage: RtkFailureStage,
    message: string
  ): RtkRuntimeHealthState {
    return {
      health: 'unhealthy',
      checkedAt: this.nowImpl(),
      source,
      failureStage: stage,
      failureMessage: message
    }
  }

  private isRtkCommand(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) {
      return false
    }

    const token = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)
    const firstToken = token?.[1] || token?.[2] || token?.[3] || ''
    const normalized = path.basename(firstToken).toLowerCase()
    return normalized === 'rtk' || normalized === 'rtk.exe'
  }

  private getRewriteBypassReason(command: string): string | undefined {
    if (!/\bfind(?:\.exe)?\b/i.test(command)) {
      return undefined
    }

    const unsupportedPatterns = [
      /(^|[\s(])-(?:o|a)(?=$|\s|[|)&;])/,
      /\\\(/,
      /\\\)/,
      /(^|[\s(])!(?=$|\s|[|)&;])/,
      /(^|[\s(])-not(?=$|\s|[|)&;])/,
      /(^|[\s(])-(?:exec|delete|printf|print0)(?=$|\s|[|)&;])/
    ]

    if (!unsupportedPatterns.some((pattern) => pattern.test(command))) {
      return undefined
    }

    return 'Bypassed RTK rewrite: unsupported find compound predicates or actions'
  }

  private describeBypassReason(
    configPresenter: Pick<IConfigPresenter, 'getSetting'>
  ): string | undefined {
    if (!this.getUserEnabled(configPresenter)) {
      return 'RTK is disabled in settings'
    }

    if (this.healthState.health === 'unhealthy') {
      return this.healthState.failureMessage || 'RTK is unhealthy in the current session'
    }

    if (this.healthState.health === 'checking') {
      return 'RTK health check is still running'
    }

    if (!this.resolvedRuntime) {
      return 'RTK runtime is not available'
    }

    return undefined
  }
}

export const rtkRuntimeService = new RtkRuntimeService()
