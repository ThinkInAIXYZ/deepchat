import * as fs from 'node:fs'
import path from 'node:path'
import logger from '@shared/logger'
import type {
  DeepChatPromptAssembly,
  DeepChatPromptDegradationCode,
  DeepChatPromptSourceFreshness
} from '@shared/types/prompt-assembly'
import { formatCommandShellPromptLine, type ResolvedCommandShell } from '@shared/commandShell'
import type { ProviderCatalogPort } from '@/provider/ports'
import { assemblePromptSections, createPromptAssemblySection } from './promptAssembly'

export interface BuildSystemEnvPromptOptions {
  providerId?: string
  modelId?: string
  workdir?: string | null
  platform?: NodeJS.Platform
  now?: Date
  agentsFilePath?: string
  commandShell: ResolvedCommandShell
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

type AgentsReadState = 'fresh' | 'missing' | 'read_error'

type SettledAgentsRead = {
  content: string
  state: AgentsReadState
}

type AgentsInstructionsResult = {
  content: string
  freshness: DeepChatPromptSourceFreshness
  degradationCodes?: readonly DeepChatPromptDegradationCode[]
}

type AgentsCacheEntry = {
  settled?: SettledAgentsRead
  refreshedAt: number
  pending?: Promise<SettledAgentsRead>
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

async function readAgentsInstructionsFromDisk(sourcePath: string): Promise<SettledAgentsRead> {
  try {
    return {
      content: await fs.promises.readFile(sourcePath, 'utf8'),
      state: 'fresh'
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT' || nodeError.code === 'ENOTDIR') {
      return { content: '', state: 'missing' }
    }

    logger.warn('[SystemEnvPromptBuilder] Failed to read AGENTS.md', {
      sourcePath,
      code: nodeError.code,
      message: error instanceof Error ? error.message : String(error)
    })
    return { content: '', state: 'read_error' }
  }
}

function refreshAgentsInstructions(sourcePath: string, fallback: AgentsCacheEntry | undefined) {
  const pending = readAgentsInstructionsFromDisk(sourcePath).then((settled) => {
    agentsInstructionsCache.set(sourcePath, {
      settled,
      refreshedAt: Date.now()
    })
    return settled
  })

  agentsInstructionsCache.set(sourcePath, {
    ...(fallback?.settled ? { settled: fallback.settled } : {}),
    refreshedAt: fallback?.refreshedAt ?? 0,
    pending
  })

  return pending
}

async function waitForAgentsInstructions(
  sourcePath: string,
  pending: Promise<SettledAgentsRead>,
  fallback: SettledAgentsRead | undefined
): Promise<AgentsInstructionsResult> {
  let timeout: NodeJS.Timeout | undefined
  const result = await Promise.race([
    pending.then((settled) => ({ settled })),
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
    return {
      content: fallback?.content ?? '',
      freshness: 'deferred',
      degradationCodes: ['agents_file_deferred']
    }
  }

  return projectAgentsInstructions(result.settled, 'fresh')
}

function projectAgentsInstructions(
  settled: SettledAgentsRead,
  freshness: 'fresh' | 'cached'
): AgentsInstructionsResult {
  if (settled.state === 'missing') {
    return {
      content: settled.content,
      freshness: 'missing',
      degradationCodes: ['agents_file_missing']
    }
  }
  if (settled.state === 'read_error') {
    return {
      content: settled.content,
      freshness: 'read_error',
      degradationCodes: ['agents_file_read_error']
    }
  }
  return { content: settled.content, freshness }
}

async function readAgentsInstructions(sourcePath: string): Promise<AgentsInstructionsResult> {
  const cached = agentsInstructionsCache.get(sourcePath)
  const now = Date.now()
  if (cached?.settled && now - cached.refreshedAt < AGENTS_CACHE_TTL_MS) {
    return projectAgentsInstructions(cached.settled, 'cached')
  }

  if (cached?.pending) {
    return cached.settled
      ? projectAgentsInstructions(cached.settled, 'cached')
      : {
          content: '',
          freshness: 'deferred',
          degradationCodes: ['agents_file_deferred']
        }
  }

  const pending = refreshAgentsInstructions(sourcePath, cached)
  if (cached?.settled) {
    return projectAgentsInstructions(cached.settled, 'cached')
  }

  return waitForAgentsInstructions(sourcePath, pending, undefined)
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

export async function buildSystemEnvPromptAssembly(
  options: BuildSystemEnvPromptOptions
): Promise<DeepChatPromptAssembly> {
  const now = options.now ?? new Date()
  const platform = options.platform ?? process.platform
  const workdir = resolveWorkdir(options.workdir)
  const agentsFilePath = options.agentsFilePath
    ? path.resolve(options.agentsFilePath)
    : path.join(workdir, 'AGENTS.md')
  let stepStartedAt = Date.now()
  const agentsInstructions = await readAgentsInstructions(agentsFilePath)
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

  const environmentContent = [
    `You are powered by the model named ${modelName}.`,
    `The exact model ID is ${exactModelId}`,
    `Here is some useful information about the environment you are running in:`,
    '<env>',
    `Working directory: ${workdir}`,
    `Is directory a git repo: ${isGitRepo ? 'yes' : 'no'}`,
    `Platform: ${platform}`,
    formatCommandShellPromptLine(options.commandShell),
    `Today's date: ${now.toDateString()}`,
    '</env>'
  ].join('\n')
  const agentsContent = agentsInstructions.content.trim()
    ? `Instructions from: ${agentsFilePath}\n\n${agentsInstructions.content}`
    : ''

  return assemblePromptSections([
    createPromptAssemblySection({
      kind: 'system_environment',
      sourceRef: 'runtime:environment',
      content: environmentContent
    }),
    createPromptAssemblySection({
      kind: 'agents_instructions',
      sourceRef: 'workspace:AGENTS.md',
      content: agentsContent,
      separatorBefore: '\n',
      freshness: agentsInstructions.freshness,
      degradationCodes: agentsInstructions.degradationCodes,
      normalize: 'trim_end'
    })
  ])
}

export async function buildSystemEnvPrompt(
  options: BuildSystemEnvPromptOptions
): Promise<string> {
  return (await buildSystemEnvPromptAssembly(options)).prompt
}
