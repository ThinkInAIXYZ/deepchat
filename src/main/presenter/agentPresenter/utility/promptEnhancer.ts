interface EnhanceOptions {
  isImageGeneration?: boolean
  isAgentMode?: boolean
  agentWorkspacePath?: string | null
  platform?: NodeJS.Platform
}

export function enhanceSystemPromptWithDateTime(
  systemPrompt: string,
  options: EnhanceOptions = {}
): string {
  const { isImageGeneration = false } = options

  if (isImageGeneration) return systemPrompt

  return systemPrompt?.trim() ?? ''
}
