import * as fs from 'node:fs'
import path from 'node:path'
import { presenter } from '@/presenter'

export interface BuildSystemEnvPromptOptions {
  providerId?: string
  modelId?: string
  workdir?: string | null
  platform?: NodeJS.Platform
  now?: Date
  agentsFilePath?: string
}

function resolveModelDisplayName(providerId: string, modelId: string): string | undefined {
  try {
    const models = presenter.configPresenter?.getProviderModels?.(providerId) || []
    const match = models.find((model) => model.id === modelId)
    if (match?.name) {
      return match.name
    }

    const customModels = presenter.configPresenter?.getCustomModels?.(providerId) || []
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
  modelId?: string
): {
  modelName: string
  exactModelId: string
} {
  const trimmedProviderId = providerId?.trim() || 'unknown-provider'
  const trimmedModelId = modelId?.trim() || 'unknown-model'
  const displayName = resolveModelDisplayName(trimmedProviderId, trimmedModelId)

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
    return `[SystemEnvPromptBuilder] AGENTS.md not found or unreadable: ${error instanceof Error ? error.message : String(error)}`
  }
}

export function buildRuntimeCapabilitiesPrompt(): string {
  return [
    '## Runtime Capabilities',
    '- YoBrowser tools are available for browser automation when needed.',
    '- Use exec(background: true) to start long-running terminal commands.',
    '- Use process(list|poll|log|write|kill|remove) to manage background terminal sessions.',
    '- Before launching another long-running command, prefer process action "list" to inspect existing sessions.'
  ].join('\n')
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
  const { modelName } = resolveModelIdentity(options.providerId, options.modelId)

  return [
    `You are powered by the model named ${modelName}.`,
    `## Here is some useful information about the environment you are running in:`,
    `Working directory: ${workdir}`,
    `Is directory a git repo: ${isGitRepository(workdir) ? 'yes' : 'no'}`,
    `Platform: ${platform}`,
    `Today's date: ${now.toDateString()}`,
    `Instructions from: ${agentsFilePath} \n`,
    agentsContent
  ].join('\n')
}
