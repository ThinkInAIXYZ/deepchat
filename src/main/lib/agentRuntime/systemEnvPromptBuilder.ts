import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'node:path'
import logger from '@shared/logger'
import type { ProviderCatalogPort } from '@/presenter/runtimePorts'

export interface BuildSystemEnvPromptOptions {
  providerId?: string
  modelId?: string
  workdir?: string | null
  platform?: NodeJS.Platform
  now?: Date
  agentsFilePath?: string
  modelLookup?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  signal?: AbortSignal
  deadlineAt?: number
}

export interface SystemEnvPromptSnapshot {
  readonly prompt: string
  readonly revision: string
}

export interface RuntimeCapabilitiesPromptOptions {
  hasYoBrowser?: boolean
  hasExec?: boolean
  hasProcess?: boolean
}

const SYSTEM_ENV_SLOW_STEP_MS = 500
const AGENTS_READ_BUDGET_MS = 200
const AGENTS_CACHE_TTL_MS = 30_000

type SourceEntry<T> = {
  hasLastKnownGood: boolean
  lastKnownGood?: T
  pending?: Promise<void>
  settledAt: number
  nextAttemptAt: number
}

const agentsInstructionsCache = new Map<string, SourceEntry<string | null>>()
const gitRepositoryMarkerCache = new Map<string, SourceEntry<boolean>>()

function logSlowSystemEnvStep(step: string, startedAt: number): void {
  const elapsed = Date.now() - startedAt
  if (elapsed < SYSTEM_ENV_SLOW_STEP_MS) {
    return
  }

  logger.warn(`[SystemEnvPromptBuilder] step slow step=${step} elapsed=${elapsed}ms`)
}

function resolveModelDisplayName(
  providerId: string,
  modelId: string,
  modelLookup?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
): string | undefined {
  try {
    const models = modelLookup?.getProviderModels(providerId) || []
    const match = models.find((model) => model.id === modelId)
    if (match?.name) {
      return match.name
    }

    const customModels = modelLookup?.getCustomModels(providerId) || []
    const customMatch = customModels.find((model) => model.id === modelId)
    if (customMatch?.name) {
      return customMatch.name
    }
  } catch (error) {
    console.warn(
      `[SystemEnvPromptBuilder] Failed to resolve model display name for ${providerId}/${modelId}:`,
      error
    )
  }

  return undefined
}

function resolveModelIdentity(
  providerId?: string,
  modelId?: string,
  modelLookup?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
): {
  modelName: string
  exactModelId: string
} {
  const trimmedProviderId = providerId?.trim() || 'unknown-provider'
  const trimmedModelId = modelId?.trim() || 'unknown-model'
  const displayName = resolveModelDisplayName(trimmedProviderId, trimmedModelId, modelLookup)

  return {
    modelName: displayName || trimmedModelId,
    exactModelId: `${trimmedProviderId}/${trimmedModelId}`
  }
}

function resolveWorkdir(workdir?: string | null): string {
  const normalized = workdir?.trim()
  if (normalized) {
    return path.resolve(normalized)
  }
  return process.cwd()
}

async function readGitRepositoryMarkerPresent(workdir: string): Promise<boolean> {
  let current = path.resolve(workdir)
  while (true) {
    try {
      await fs.promises.access(path.join(current, '.git'))
      return true
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT' && nodeError.code !== 'ENOTDIR') {
        throw error
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

async function readAgentsInstructionsFromDisk(sourcePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(sourcePath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT' || nodeError.code === 'ENOTDIR') {
      return null
    }
    throw error
  }
}

function createSourceEntry<T>(): SourceEntry<T> {
  return {
    hasLastKnownGood: false,
    settledAt: 0,
    nextAttemptAt: 0
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    signal.throwIfAborted()
  }
}

async function waitForPending(
  pending: Promise<void>,
  signal: AbortSignal | undefined,
  deadlineAt: number
): Promise<boolean> {
  throwIfAborted(signal)
  const remainingMs = Math.max(0, deadlineAt - Date.now())
  if (remainingMs === 0) {
    return false
  }

  return new Promise<boolean>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined
    let finished = false
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (settled: boolean) => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      resolve(settled)
    }
    const onAbort = () => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      reject(signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    timeout = setTimeout(() => finish(false), remainingMs)
    pending.then(
      () => finish(true),
      () => finish(true)
    )
  })
}

function startAgentsInstructionsRefresh(
  sourcePath: string,
  entry: SourceEntry<string | null>
): Promise<void> {
  const pending = (async () => {
    try {
      entry.lastKnownGood = await readAgentsInstructionsFromDisk(sourcePath)
      entry.hasLastKnownGood = true
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      logger.warn('[SystemEnvPromptBuilder] Failed to read AGENTS.md', {
        sourcePath,
        code: nodeError.code,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      entry.settledAt = Date.now()
      entry.nextAttemptAt = entry.settledAt + AGENTS_CACHE_TTL_MS
      entry.pending = undefined
    }
  })()
  entry.pending = pending
  return pending
}

function startGitRepositoryMarkerRefresh(
  workdir: string,
  entry: SourceEntry<boolean>
): Promise<void> {
  const pending = (async () => {
    try {
      entry.lastKnownGood = await readGitRepositoryMarkerPresent(workdir)
      entry.hasLastKnownGood = true
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      logger.warn('[SystemEnvPromptBuilder] Failed to inspect git repository marker', {
        workdir,
        code: nodeError.code,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      entry.settledAt = Date.now()
      entry.nextAttemptAt = entry.settledAt + AGENTS_CACHE_TTL_MS
      entry.pending = undefined
    }
  })()
  entry.pending = pending
  return pending
}

async function readAgentsInstructions(
  sourcePath: string,
  signal: AbortSignal | undefined,
  deadlineAt: number,
  waitBudgetMs: number
): Promise<string> {
  throwIfAborted(signal)
  let entry = agentsInstructionsCache.get(sourcePath)
  if (!entry) {
    entry = createSourceEntry<string | null>()
    agentsInstructionsCache.set(sourcePath, entry)
  }

  const now = Date.now()
  if (!entry.pending && now >= entry.nextAttemptAt) {
    startAgentsInstructionsRefresh(sourcePath, entry)
  }

  if (entry.hasLastKnownGood) {
    return entry.lastKnownGood ?? ''
  }

  if (entry.pending && !(await waitForPending(entry.pending, signal, deadlineAt))) {
    logger.warn('[SystemEnvPromptBuilder] AGENTS.md read deferred', {
      sourcePath,
      budgetMs: waitBudgetMs
    })
  }

  return entry.hasLastKnownGood ? (entry.lastKnownGood ?? '') : ''
}

async function readGitRepositoryMarker(
  workdir: string,
  signal: AbortSignal | undefined,
  deadlineAt: number
): Promise<boolean> {
  throwIfAborted(signal)
  let entry = gitRepositoryMarkerCache.get(workdir)
  if (!entry) {
    entry = createSourceEntry<boolean>()
    gitRepositoryMarkerCache.set(workdir, entry)
  }

  const now = Date.now()
  if (!entry.pending && now >= entry.nextAttemptAt) {
    startGitRepositoryMarkerRefresh(workdir, entry)
  }

  if (entry.hasLastKnownGood) {
    return entry.lastKnownGood ?? false
  }

  if (entry.pending) {
    await waitForPending(entry.pending, signal, deadlineAt)
  }

  return entry.hasLastKnownGood ? (entry.lastKnownGood ?? false) : false
}

export function buildRuntimeCapabilitiesPrompt(
  options: RuntimeCapabilitiesPromptOptions = {
    hasYoBrowser: true,
    hasExec: true,
    hasProcess: true
  }
): string {
  const lines = ['## Runtime Capabilities']

  if (options.hasYoBrowser) {
    lines.push('- YoBrowser tools are available for browser automation when needed.')
  }
  if (options.hasExec) {
    lines.push(
      '- Use exec(background: true) to explicitly detach long-running terminal commands; foreground exec may also return a running session after its yield window.'
    )
  }
  if (options.hasProcess) {
    lines.push(
      '- Use process(list|poll|log|write|kill|remove) to manage background terminal sessions.'
    )
  }
  if (options.hasExec && options.hasProcess) {
    lines.push(
      '- Before launching another long-running command, prefer process action "list" to inspect existing sessions.'
    )
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

export async function buildSystemEnvPromptSnapshot(
  options: BuildSystemEnvPromptOptions = {}
): Promise<SystemEnvPromptSnapshot> {
  throwIfAborted(options.signal)
  const lookupStartedAt = Date.now()
  const deadlineAt = Math.min(
    options.deadlineAt ?? lookupStartedAt + AGENTS_READ_BUDGET_MS,
    lookupStartedAt + AGENTS_READ_BUDGET_MS
  )
  const waitBudgetMs = Math.max(0, deadlineAt - lookupStartedAt)
  const now = options.now ?? new Date()
  const platform = options.platform ?? process.platform
  const workdir = resolveWorkdir(options.workdir)
  const agentsFilePath = options.agentsFilePath
    ? path.resolve(options.agentsFilePath)
    : path.join(workdir, 'AGENTS.md')
  let stepStartedAt = Date.now()
  const [agentsContent, gitRepositoryMarkerPresent] = await Promise.all([
    readAgentsInstructions(agentsFilePath, options.signal, deadlineAt, waitBudgetMs),
    readGitRepositoryMarker(workdir, options.signal, deadlineAt)
  ])
  throwIfAborted(options.signal)
  logSlowSystemEnvStep('read-sources', stepStartedAt)
  stepStartedAt = Date.now()
  const { modelName, exactModelId } = resolveModelIdentity(
    options.providerId,
    options.modelId,
    options.modelLookup
  )
  logSlowSystemEnvStep('model-identity', stepStartedAt)

  const promptLines = [
    `You are powered by the model named ${modelName}.`,
    `The exact model ID is ${exactModelId}`,
    `Here is some useful information about the environment you are running in:`,
    '<env>',
    `Working directory: ${workdir}`,
    `Is directory a git repo: ${gitRepositoryMarkerPresent ? 'yes' : 'no'}`,
    `Platform: ${platform}`,
    `Today's date: ${now.toDateString()}`,
    '</env>'
  ]

  if (agentsContent.trim().length > 0) {
    promptLines.push(`Instructions from: ${agentsFilePath}\n`, agentsContent)
  }

  const prompt = promptLines.join('\n')
  return {
    prompt,
    revision: createHash('sha256').update(prompt, 'utf8').digest('hex')
  }
}

export async function buildSystemEnvPrompt(
  options: BuildSystemEnvPromptOptions = {}
): Promise<string> {
  return (await buildSystemEnvPromptSnapshot(options)).prompt
}
