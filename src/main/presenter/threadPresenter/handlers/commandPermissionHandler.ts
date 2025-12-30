export type CommandRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface CommandRiskAssessment {
  level: CommandRiskLevel
  suggestion: string
}

export interface CommandInfo {
  command: string
  riskLevel: CommandRiskLevel
  suggestion: string
  signature?: string
  baseCommand?: string
}

export interface CommandPermissionCheckResult {
  allowed: boolean
  signature: string
  baseCommand: string
  risk: CommandRiskAssessment
  reason: 'whitelist' | 'session' | 'permission' | 'invalid'
}

const SAFE_COMMANDS = new Set([
  'ls',
  'pwd',
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'diff',
  'find',
  'sort',
  'uniq'
])

const DESTRUCTIVE_PATTERN = /\brm\s+-rf\b|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;|\bchmod\s+777\s+\//
const NETWORK_PATTERN = /\b(curl|wget|nc|netcat|telnet)\b/
const CHAINING_PATTERN = /&&|\|\||;|\$\(|`|\|/
const RISKY_COMMANDS = /\b(rm|rmdir|mv|chmod|chown|sudo|doas|su|docker|podman|kubectl)\b/
const BUILD_COMMANDS =
  /\b(git\s+(pull|push|checkout|switch|merge)|npm|pnpm|yarn|bun|pip|pip3|cargo|make|gradle|mvn)\b/

const SUGGESTION_KEYS: Record<CommandRiskLevel, string> = {
  low: 'components.messageBlockPermissionRequest.suggestion.low',
  medium: 'components.messageBlockPermissionRequest.suggestion.medium',
  high: 'components.messageBlockPermissionRequest.suggestion.high',
  critical: 'components.messageBlockPermissionRequest.suggestion.critical'
}

export class CommandPermissionRequiredError extends Error {
  readonly permissionRequest: {
    toolName: string
    serverName: string
    permissionType: 'command'
    description: string
    command?: string
    commandSignature?: string
    commandInfo?: CommandInfo
    conversationId?: string
  }
  readonly responseContent: string

  constructor(
    responseContent: string,
    permissionRequest: CommandPermissionRequiredError['permissionRequest']
  ) {
    super('Command permission required')
    this.responseContent = responseContent
    this.permissionRequest = permissionRequest
  }
}

export class CommandPermissionCache {
  private sessionCache = new Map<string, Set<string>>()
  private onceCache = new Map<string, Set<string>>()

  approve(conversationId: string, signature: string, isSession: boolean): void {
    if (!conversationId || !signature) return
    const targetCache = isSession ? this.sessionCache : this.onceCache
    const existing = targetCache.get(conversationId) ?? new Set<string>()
    existing.add(signature)
    targetCache.set(conversationId, existing)
  }

  isApproved(conversationId: string, signature: string): boolean {
    if (!conversationId || !signature) return false
    const sessionAllowed = this.sessionCache.get(conversationId)?.has(signature) ?? false
    if (sessionAllowed) return true

    const onceSet = this.onceCache.get(conversationId)
    if (!onceSet?.has(signature)) {
      return false
    }

    onceSet.delete(signature)
    if (onceSet.size === 0) {
      this.onceCache.delete(conversationId)
    }
    return true
  }

  clearConversation(conversationId: string): void {
    this.sessionCache.delete(conversationId)
    this.onceCache.delete(conversationId)
  }

  clearAll(): void {
    this.sessionCache.clear()
    this.onceCache.clear()
  }
}

export class CommandPermissionHandler {
  private readonly cache: CommandPermissionCache

  constructor(cache?: CommandPermissionCache) {
    this.cache = cache ?? new CommandPermissionCache()
  }

  getCache(): CommandPermissionCache {
    return this.cache
  }

  approve(conversationId: string, signature: string, isSession: boolean): void {
    this.cache.approve(conversationId, signature, isSession)
  }

  isApproved(conversationId: string, signature: string): boolean {
    return this.cache.isApproved(conversationId, signature)
  }

  clearConversation(conversationId: string): void {
    this.cache.clearConversation(conversationId)
  }

  clearAll(): void {
    this.cache.clearAll()
  }

  checkPermission(
    conversationId: string | undefined,
    command: string
  ): CommandPermissionCheckResult {
    const trimmed = command.trim()
    const baseCommand = this.extractBaseCommand(trimmed)
    const signature = this.extractCommandSignature(trimmed)
    const risk = this.assessCommandRisk(trimmed)

    if (!trimmed || !baseCommand) {
      return {
        allowed: false,
        signature,
        baseCommand,
        risk,
        reason: 'invalid'
      }
    }

    if (SAFE_COMMANDS.has(baseCommand) && risk.level !== 'critical') {
      return {
        allowed: true,
        signature,
        baseCommand,
        risk,
        reason: 'whitelist'
      }
    }

    if (conversationId && this.cache.isApproved(conversationId, signature)) {
      return {
        allowed: true,
        signature,
        baseCommand,
        risk,
        reason: 'session'
      }
    }

    return {
      allowed: false,
      signature,
      baseCommand,
      risk,
      reason: 'permission'
    }
  }

  assessCommandRisk(command: string): CommandRiskAssessment {
    if (!command.trim()) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (DESTRUCTIVE_PATTERN.test(command)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (NETWORK_PATTERN.test(command)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (CHAINING_PATTERN.test(command)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    const baseCommand = this.extractBaseCommand(command)
    if (SAFE_COMMANDS.has(baseCommand)) {
      return { level: 'low', suggestion: SUGGESTION_KEYS.low }
    }

    if (RISKY_COMMANDS.test(command)) {
      return { level: 'high', suggestion: SUGGESTION_KEYS.high }
    }

    if (BUILD_COMMANDS.test(command)) {
      return { level: 'medium', suggestion: SUGGESTION_KEYS.medium }
    }

    return { level: 'medium', suggestion: SUGGESTION_KEYS.medium }
  }

  extractBaseCommand(command: string): string {
    const tokens = this.tokenize(command)
    if (tokens.length === 0) return ''

    let index = 0
    while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
      index += 1
    }

    return tokens[index] ?? ''
  }

  extractCommandSignature(command: string): string {
    const tokens = this.tokenize(command)
    if (tokens.length === 0) return ''

    let index = 0
    while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
      index += 1
    }

    const trimmedTokens = tokens.slice(index)
    if (trimmedTokens.length === 0) return ''

    const signatureTokens = [trimmedTokens[0]]
    if (trimmedTokens.length >= 2) {
      signatureTokens.push(trimmedTokens[1])
    }
    if (trimmedTokens.length >= 3 && trimmedTokens[1]?.startsWith('-')) {
      signatureTokens.push(trimmedTokens[2])
    }
    return signatureTokens.join(' ')
  }

  buildCommandInfo(command: string): CommandInfo {
    const risk = this.assessCommandRisk(command)
    const signature = this.extractCommandSignature(command)
    const baseCommand = this.extractBaseCommand(command)
    return {
      command,
      riskLevel: risk.level,
      suggestion: risk.suggestion,
      signature,
      baseCommand
    }
  }

  private tokenize(command: string): string[] {
    return command.trim().split(/\s+/).filter(Boolean)
  }
}
