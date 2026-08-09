import { createHash } from 'node:crypto'
import { CommandPermissionCache } from './commandPermissionCache'
import type {
  CommandShellDialect,
  CommandShellProfile,
  ResolvedCommandShell
} from '@shared/commandShell'

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

const SAFE_COMMANDS: Record<CommandShellDialect, ReadonlySet<string>> = {
  posix: new Set([
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
  ]),
  powershell: new Set([
    'cat',
    'compare-object',
    'dir',
    'echo',
    'get-childitem',
    'get-content',
    'get-location',
    'ls',
    'measure-object',
    'pwd',
    'select-string',
    'sort-object',
    'write-output'
  ]),
  cmd: new Set(['cd', 'dir', 'echo', 'fc', 'find', 'findstr', 'type', 'ver', 'where'])
}

const GIT_BASH_COMMANDS_REQUIRING_APPROVAL = new Set(['diff', 'find', 'sort', 'uniq'])

const POSIX_DESTRUCTIVE_PATTERN =
  /\brm\s+-rf\b|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;|\bchmod\s+777\s+\//
const POWERSHELL_DESTRUCTIVE_PATTERN =
  /\b(remove-item|rm|ri|del|erase|rd|rmdir)\b(?=[^\r\n]*(?:-recurse|-r\b))(?=[^\r\n]*(?:-force|-fo\b))|\b(format-volume|remove-partition|clear-disk|stop-computer|invoke-expression|iex)\b/i
const CMD_DESTRUCTIVE_PATTERN =
  /\b(del|erase|rd|rmdir|format|diskpart|shutdown)\b|\breg(?:\.exe)?\s+delete\b/i
const POSIX_NETWORK_PATTERN = /\b(curl|wget|nc|netcat|telnet)\b/
const POWERSHELL_NETWORK_PATTERN =
  /\b(invoke-webrequest|iwr|invoke-restmethod|irm|start-bitstransfer|curl|wget)\b/i
const CMD_NETWORK_PATTERN = /\b(curl|ftp|telnet|bitsadmin|certutil)\b/i
const SHELL_CONTROL_CHARS = new Set([';', '|', '&', '<', '>', '\r', '\n'])
const RISKY_COMMANDS =
  /\b(rm|rmdir|mv|chmod|chown|sudo|doas|su|docker|podman|kubectl|remove-item|move-item|set-acl|start-process|cmd|powershell|pwsh|call|start)\b/
const BUILD_COMMANDS =
  /\b(git\s+(pull|push|checkout|switch|merge)|npm|pnpm|yarn|bun|pip|pip3|cargo|make|gradle|mvn)\b/

const SUGGESTION_KEYS: Record<CommandRiskLevel, string> = {
  low: 'components.messageBlockPermissionRequest.suggestion.low',
  medium: 'components.messageBlockPermissionRequest.suggestion.medium',
  high: 'components.messageBlockPermissionRequest.suggestion.high',
  critical: 'components.messageBlockPermissionRequest.suggestion.critical'
}

type CommandShellIdentity = Pick<ResolvedCommandShell, 'profile' | 'dialect'>

function hasPosixControlSyntax(command: string): boolean {
  let quote: "'" | '"' | null = null

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote === "'") {
      if (character === "'") quote = null
      continue
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null
        continue
      }
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === '`' || (character === '$' && command[index + 1] === '(')) {
        return true
      }
      continue
    }

    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (
      character === '`' ||
      (character === '$' && command[index + 1] === '(') ||
      SHELL_CONTROL_CHARS.has(character)
    ) {
      return true
    }
  }

  return false
}

function hasPowerShellControlSyntax(command: string): boolean {
  let quote: "'" | '"' | null = null

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote === "'") {
      if (character !== "'") continue
      if (command[index + 1] === "'") {
        index += 1
      } else {
        quote = null
      }
      continue
    }

    if (quote === '"') {
      if (character === '`') {
        index += 1
        continue
      }
      if (character === '"') {
        quote = null
        continue
      }
      if (character === '$' && command[index + 1] === '(') return true
      continue
    }

    if (character === '`') {
      index += 1
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (
      SHELL_CONTROL_CHARS.has(character) ||
      ((character === '$' || character === '@') && command[index + 1] === '(') ||
      (character === '@' && command[index + 1] === '{') ||
      character === '(' ||
      character === ')' ||
      character === '{' ||
      character === '}'
    ) {
      return true
    }
  }

  return false
}

function hasCmdControlSyntax(command: string): boolean {
  let quoted = false
  let pendingPercentExpansion = false
  let pendingDelayedExpansion = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (character === '^') {
      return true
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (character === '%') {
      if (pendingPercentExpansion) return true
      pendingPercentExpansion = true
      continue
    }
    if (character === '!') {
      if (pendingDelayedExpansion) return true
      pendingDelayedExpansion = true
      continue
    }
    if (!quoted && (SHELL_CONTROL_CHARS.has(character) || character === '(' || character === ')')) {
      return true
    }
  }

  return false
}

function hasShellControlSyntax(command: string, dialect: CommandShellDialect): boolean {
  switch (dialect) {
    case 'posix':
      return hasPosixControlSyntax(command)
    case 'powershell':
      return hasPowerShellControlSyntax(command)
    case 'cmd':
      return hasCmdControlSyntax(command)
  }
}

function matchesDestructivePattern(command: string, dialect: CommandShellDialect): boolean {
  switch (dialect) {
    case 'posix':
      return POSIX_DESTRUCTIVE_PATTERN.test(command)
    case 'powershell':
      return POWERSHELL_DESTRUCTIVE_PATTERN.test(command)
    case 'cmd':
      return CMD_DESTRUCTIVE_PATTERN.test(command)
  }
}

function matchesNetworkPattern(command: string, dialect: CommandShellDialect): boolean {
  switch (dialect) {
    case 'posix':
      return POSIX_NETWORK_PATTERN.test(command)
    case 'powershell':
      return POWERSHELL_NETWORK_PATTERN.test(command)
    case 'cmd':
      return CMD_NETWORK_PATTERN.test(command)
  }
}

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function extractBaseCommandValue(command: string): string {
  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) return ''

  let index = 0
  while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
    index += 1
  }

  return tokens[index] ?? ''
}

function isImplicitlySafeCommand(
  command: string,
  baseCommand: string,
  dialect: CommandShellDialect,
  profile: CommandShellProfile
): boolean {
  const normalizedBaseCommand = dialect === 'posix' ? baseCommand : baseCommand.toLowerCase()
  if (!SAFE_COMMANDS[dialect].has(normalizedBaseCommand)) return false

  if (profile !== 'git-bash') return true

  // Bash expansion makes argument-level side-effect detection incomplete. Keep the new profile
  // fail-closed while preserving the legacy POSIX policy unchanged.
  return !(
    GIT_BASH_COMMANDS_REQUIRING_APPROVAL.has(normalizedBaseCommand) ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(command.trim())
  )
}

function extractCommandSignatureValue(command: string, dialect: CommandShellDialect): string {
  const trimmed = command.trim()
  if (hasShellControlSyntax(trimmed, dialect)) {
    const digest = createHash('sha256').update(trimmed).digest('hex')
    return `shell:${digest}`
  }

  const tokens = tokenizeCommand(trimmed)
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

export function namespaceCommandSignature(profile: CommandShellProfile, signature: string): string {
  return `${profile}:${signature}`
}

export function isCommandSignatureForProfile(
  signature: string,
  profile: CommandShellProfile
): boolean {
  return signature.startsWith(`${profile}:`) && signature.length > profile.length + 1
}

export function buildCommandPermissionSignature(
  command: string,
  commandShell: CommandShellIdentity
): string {
  return namespaceCommandSignature(
    commandShell.profile,
    extractCommandSignatureValue(command, commandShell.dialect)
  )
}

export class CommandPermissionRequiredError extends Error {
  readonly permissionRequest: {
    toolName: string
    serverName: string
    permissionType: 'command'
    description: string
    command?: string
    commandSignature?: string
    shellProfile?: CommandShellProfile
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

export class CommandPermissionService {
  private readonly cache: CommandPermissionCache

  constructor(cache?: CommandPermissionCache) {
    this.cache = cache ?? new CommandPermissionCache()
  }

  getCache(): CommandPermissionCache {
    return this.cache
  }

  approve(conversationId: string, signature: string, isSession: boolean): string | null {
    return this.cache.approve(conversationId, signature, isSession)
  }

  revokeOnce(conversationId: string, signature: string, oneShotGrantId: string): boolean {
    return this.cache.revokeOnce(conversationId, signature, oneShotGrantId)
  }

  isApproved(conversationId: string, signature: string, oneShotGrantId?: string): boolean {
    return this.cache.isApproved(conversationId, signature, oneShotGrantId)
  }

  clearConversation(conversationId: string): void {
    this.cache.clearConversation(conversationId)
  }

  cloneConversation(sourceConversationId: string, targetConversationId: string): void {
    this.cache.cloneConversation(sourceConversationId, targetConversationId)
  }

  clearAll(): void {
    this.cache.clearAll()
  }

  checkPermission(
    conversationId: string | undefined,
    command: string,
    commandShell: CommandShellIdentity,
    oneShotGrantId?: string
  ): CommandPermissionCheckResult {
    const trimmed = command.trim()
    const baseCommand = this.extractBaseCommand(trimmed)
    const signature = buildCommandPermissionSignature(trimmed, commandShell)
    const risk = this.assessCommandRisk(trimmed, commandShell.dialect, commandShell.profile)

    if (!trimmed || !baseCommand) {
      return {
        allowed: false,
        signature,
        baseCommand,
        risk,
        reason: 'invalid'
      }
    }

    if (
      isImplicitlySafeCommand(trimmed, baseCommand, commandShell.dialect, commandShell.profile) &&
      risk.level !== 'critical'
    ) {
      return {
        allowed: true,
        signature,
        baseCommand,
        risk,
        reason: 'whitelist'
      }
    }

    if (conversationId && this.cache.isApproved(conversationId, signature, oneShotGrantId)) {
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

  private assessCommandRisk(
    command: string,
    dialect: CommandShellDialect,
    profile: CommandShellProfile
  ): CommandRiskAssessment {
    if (!command.trim()) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (matchesDestructivePattern(command, dialect)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (matchesNetworkPattern(command, dialect)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    if (hasShellControlSyntax(command, dialect)) {
      return { level: 'critical', suggestion: SUGGESTION_KEYS.critical }
    }

    const baseCommand = this.extractBaseCommand(command)
    if (isImplicitlySafeCommand(command, baseCommand, dialect, profile)) {
      return { level: 'low', suggestion: SUGGESTION_KEYS.low }
    }

    const normalizedCommand = dialect === 'posix' ? command : command.toLowerCase()
    if (RISKY_COMMANDS.test(normalizedCommand)) {
      return { level: 'high', suggestion: SUGGESTION_KEYS.high }
    }

    if (BUILD_COMMANDS.test(normalizedCommand)) {
      return { level: 'medium', suggestion: SUGGESTION_KEYS.medium }
    }

    return { level: 'medium', suggestion: SUGGESTION_KEYS.medium }
  }

  hasShellControlSyntax(command: string, dialect: CommandShellDialect): boolean {
    return hasShellControlSyntax(command, dialect)
  }

  extractBaseCommand(command: string): string {
    return extractBaseCommandValue(command)
  }

  buildCommandInfo(command: string, commandShell: CommandShellIdentity): CommandInfo {
    const risk = this.assessCommandRisk(command, commandShell.dialect, commandShell.profile)
    const signature = buildCommandPermissionSignature(command, commandShell)
    const baseCommand = this.extractBaseCommand(command)
    return {
      command,
      riskLevel: risk.level,
      suggestion: risk.suggestion,
      signature,
      baseCommand
    }
  }
}

export type RiskLevel = CommandRiskLevel
export type PermissionCheckResult = CommandPermissionCheckResult
