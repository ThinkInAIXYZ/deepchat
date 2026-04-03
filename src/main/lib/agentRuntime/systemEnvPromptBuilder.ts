import * as fs from 'node:fs'
import path from 'node:path'
import logger from '@shared/logger'
import type { ConfigQueryPort } from '@/presenter/runtimePorts'

export interface BuildSystemEnvPromptOptions {
  providerId?: string
  modelId?: string
  workdir?: string | null
  platform?: NodeJS.Platform
  now?: Date
  agentsFilePath?: string
  modelLookup?: Pick<ConfigQueryPort, 'getProviderModels' | 'getCustomModels'>
}

export interface RuntimeCapabilitiesPromptOptions {
  hasYoBrowser?: boolean
  hasExec?: boolean
  hasProcess?: boolean
}

function resolveModelDisplayName(
  providerId: string,
  modelId: string,
  modelLookup?: Pick<ConfigQueryPort, 'getProviderModels' | 'getCustomModels'>
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
  modelLookup?: Pick<ConfigQueryPort, 'getProviderModels' | 'getCustomModels'>
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

async function readAgentsInstructions(sourcePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(sourcePath, 'utf8')
  } catch (error) {
    logger.warn('[SystemEnvPromptBuilder] Failed to read AGENTS.md', {
      sourcePath,
      error
    })
    return ''
  }
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
  const agentsContent = await readAgentsInstructions(agentsFilePath)
  const { modelName, exactModelId } = resolveModelIdentity(
    options.providerId,
    options.modelId,
    options.modelLookup
  )

  const promptLines = [
    `You are powered by the model named ${modelName}.`,
    `The exact model ID is ${exactModelId}`,
    `## Here is some useful information about the environment you are running in:`,
    `Working directory: ${workdir}`,
    `Is directory a git repo: ${isGitRepository(workdir) ? 'yes' : 'no'}`,
    `Platform: ${platform}`,
    `Today's date: ${now.toDateString()}`
  ]

  if (agentsContent.trim().length > 0) {
    promptLines.push(`Instructions from: ${agentsFilePath}\n`, agentsContent)
  }

  return promptLines.join('\n')
}
