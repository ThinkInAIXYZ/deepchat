type PlatformName = 'macOS' | 'Windows' | 'Linux' | 'Unknown'

function formatCurrentDateTime(): string {
  return new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false
  })
}

function formatPlatformName(platform: NodeJS.Platform): PlatformName {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return 'Unknown'
}

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
  const {
    isImageGeneration = false,
    isAgentMode = false,
    agentWorkspacePath,
    platform = process.platform
  } = options

  if (isImageGeneration) return systemPrompt

  const trimmedPrompt = systemPrompt?.trim() ?? ''

  const runtimeLines: string[] = [`## Runtime Context - Today is ${formatCurrentDateTime()}`]
  const platformName = formatPlatformName(platform)
  if (platformName !== 'Unknown') {
    runtimeLines.push(`- You are running on ${platformName}`)
  }

  const normalizedWorkspace = agentWorkspacePath?.trim()
  if (isAgentMode && normalizedWorkspace) {
    runtimeLines.push(
      `- Current working directory: ${normalizedWorkspace} (All file operations and shell commands will be executed relative to this directory)`
    )
  }

  const runtimeBlock = runtimeLines.join('\n')

  return trimmedPrompt ? `${trimmedPrompt}\n${runtimeBlock}` : runtimeBlock
}
