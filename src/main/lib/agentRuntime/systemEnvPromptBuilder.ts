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
}

export interface RuntimeCapabilitiesPromptOptions {
  hasYoBrowser?: boolean
  hasExec?: boolean
  hasProcess?: boolean
}

const SYSTEM_ENV_SLOW_STEP_MS = 500
const AGENTS_READ_BUDGET_MS = 200
const AGENTS_CACHE_TTL_MS = 30_000

type AgentsCacheEntry = {
  content: string
  refreshedAt: number
  pending?: Promise<string>
}

const agentsInstructionsCache = new Map<string, AgentsCacheEntry>()

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

function isGitRepository(workdir: string): boolean {
  let current = path.resolve(workdir)
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return true
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

async function readAgentsInstructionsFromDisk(sourcePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(sourcePath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT' || nodeError.code === 'ENOTDIR') {
      return ''
    }

    logger.warn('[SystemEnvPromptBuilder] Failed to read AGENTS.md', {
      sourcePath,
      code: nodeError.code,
      message: error instanceof Error ? error.message : String(error)
    })
    return ''
  }
}

function refreshAgentsInstructions(sourcePath: string, fallback: AgentsCacheEntry | undefined) {
  const pending = readAgentsInstructionsFromDisk(sourcePath).then((content) => {
    agentsInstructionsCache.set(sourcePath, {
      content,
      refreshedAt: Date.now()
    })
    return content
  })

  agentsInstructionsCache.set(sourcePath, {
    content: fallback?.content ?? '',
    refreshedAt: fallback?.refreshedAt ?? 0,
    pending
  })

  return pending
}

async function waitForAgentsInstructions(
  sourcePath: string,
  pending: Promise<string>,
  fallback: string
): Promise<string> {
  let timeout: NodeJS.Timeout | undefined
  const result = await Promise.race([
    pending.then((content) => ({ content })),
    new Promise<{ timedOut: true }>((resolve) => {
      timeout = setTimeout(() => resolve({ timedOut: true }), AGENTS_READ_BUDGET_MS)
    })
  ])

  if (timeout) {
    clearTimeout(timeout)
  }

  if ('timedOut' in result) {
    logger.warn('[SystemEnvPromptBuilder] AGENTS.md read deferred', {
      sourcePath,
      budgetMs: AGENTS_READ_BUDGET_MS
    })
    return fallback
  }

  return result.content
}

async function readAgentsInstructions(sourcePath: string): Promise<string> {
  const cached = agentsInstructionsCache.get(sourcePath)
  const now = Date.now()
  if (cached && now - cached.refreshedAt < AGENTS_CACHE_TTL_MS) {
    return cached.content
  }

  if (cached?.pending) {
    return cached.content
  }

  const pending = refreshAgentsInstructions(sourcePath, cached)
  if (cached) {
    return cached.content
  }

  return waitForAgentsInstructions(sourcePath, pending, '')
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

export async function buildSystemEnvPrompt(
  options: BuildSystemEnvPromptOptions = {}
): Promise<string> {
  const now = options.now ?? new Date()
  const platform = options.platform ?? process.platform
  const workdir = resolveWorkdir(options.workdir)
  const agentsFilePath = options.agentsFilePath
    ? path.resolve(options.agentsFilePath)
    : path.join(workdir, 'AGENTS.md')
  let stepStartedAt = Date.now()
  const agentsContent = await readAgentsInstructions(agentsFilePath)
  logSlowSystemEnvStep('read-agents', stepStartedAt)
  stepStartedAt = Date.now()
  const { modelName, exactModelId } = resolveModelIdentity(
    options.providerId,
    options.modelId,
    options.modelLookup
  )
  logSlowSystemEnvStep('model-identity', stepStartedAt)
  stepStartedAt = Date.now()
  const isGitRepo = isGitRepository(workdir)
  logSlowSystemEnvStep('git-detect', stepStartedAt)

  const promptLines = [
    `You are powered by the model named ${modelName}.`,
    `The exact model ID is ${exactModelId}`,
    `Here is some useful information about the environment you are running in:`,
    '<env>',
    `Working directory: ${workdir}`,
    `Is directory a git repo: ${isGitRepo ? 'yes' : 'no'}`,
    `Platform: ${platform}`,
    `Today's date: ${now.toDateString()}`,
    '</env>'
  ]

  if (agentsContent.trim().length > 0) {
    promptLines.push(`Instructions from: ${agentsFilePath}\n`, agentsContent)
  }

  return promptLines.join('\n')
}
