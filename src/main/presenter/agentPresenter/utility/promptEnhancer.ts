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

  const contextFileLines: string[] = []
  if (!isImageGeneration) {
    contextFileLines.push('')
    contextFileLines.push('## Context Files')
    contextFileLines.push('Large tool outputs are saved to context files. When you see:')
    contextFileLines.push('`[Bash output in context: id] (size)` - Bash command output')
    contextFileLines.push('`[Tool output in context: id] (size)` - Terminal/MCP tool output')
    contextFileLines.push('')
    contextFileLines.push('Use these tools to read the full content:')
    contextFileLines.push('- `context_list()` - List all context files')
    contextFileLines.push(
      '- `context_tail(id="id", lines=200)` - Read last N lines (check errors first)'
    )
    contextFileLines.push('- `context_grep(id="id", pattern="text")` - Search for text')
    contextFileLines.push('- `context_read(id="id", offset=0, limit=8192)` - Read in chunks')
    contextFileLines.push('')
    contextFileLines.push(
      'Example: If you see `[Bash output in context: abcde] (14.1KB)`, check the end:'
    )
    contextFileLines.push('> context_tail(id="abcde", lines=200)')
  }

  const contextFileBlock = contextFileLines.length > 0 ? contextFileLines.join('\n') : ''

  return trimmedPrompt
    ? `${trimmedPrompt}\n${runtimeBlock}${contextFileBlock}`
    : `${runtimeBlock}${contextFileBlock}`
}
