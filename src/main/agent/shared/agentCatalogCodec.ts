import type { AcpAgentInstallState } from '@shared/types/acp'
import type { AgentAvatar, DeepChatAgentConfig } from '@shared/types/agent-interface'
import type { AgentRow } from '@/agent/data/tables/agents'
import type { AcpRegistryReference, AgentCatalogRecord, AgentDescriptor } from './agentDescriptors'

type StoredAgentState = {
  installState?: AcpAgentInstallState | null
}

type StoredAcpManualConfig = {
  command?: unknown
  args?: unknown
  env?: unknown
}

type RuntimeAgentRow = Omit<AgentRow, 'agent_type' | 'source'> & {
  agent_type: string
  source: string
}

export type AgentUnavailableReason =
  | 'unknown-kind'
  | 'invalid-source'
  | 'invalid-config'
  | 'missing-manual-command'
  | 'missing-registry-reference'

export class AgentNotFoundError extends Error {
  readonly code = 'AGENT_NOT_FOUND'

  constructor(readonly agentId: string) {
    super(`Agent not found: ${agentId}`)
    this.name = 'AgentNotFoundError'
  }
}

export class AgentUnavailableError extends Error {
  readonly code = 'AGENT_UNAVAILABLE'

  constructor(
    readonly agentId: string,
    readonly reason: AgentUnavailableReason,
    readonly kind?: string,
    readonly field?: 'agent_type' | 'source' | 'config_json' | 'state_json'
  ) {
    super(`Agent "${agentId}" is unavailable: ${reason}`)
    this.name = 'AgentUnavailableError'
  }
}

export interface ExecutableAgentDecodeContext {
  resolveDeepChatConfig(agentId: string): DeepChatAgentConfig | null
  resolveRegistryReference(agentId: string): AcpRegistryReference | null
}

function parseJson<T>(raw?: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function decodeCommon(row: RuntimeAgentRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    protected: row.protected === 1,
    description: row.description,
    icon: row.icon,
    avatar: parseJson<AgentAvatar>(row.avatar_json)
  }
}

export function decodeAgentCatalogRow(row: AgentRow): AgentCatalogRecord {
  const state = parseJson<StoredAgentState>(row.state_json)
  return {
    ...decodeCommon(row),
    kind: row.agent_type,
    source: row.source,
    config: row.agent_type === 'deepchat' ? parseJson<DeepChatAgentConfig>(row.config_json) : null,
    installState: row.agent_type === 'acp' ? (state?.installState ?? null) : null
  }
}

export function decodeExecutableAgentDescriptor(
  row: RuntimeAgentRow,
  context: ExecutableAgentDecodeContext
): AgentDescriptor {
  const common = decodeCommon(row)

  if (row.agent_type === 'deepchat') {
    if (row.source !== 'builtin' && row.source !== 'manual') {
      throw new AgentUnavailableError(row.id, 'invalid-source', row.agent_type, 'source')
    }
    const config = context.resolveDeepChatConfig(row.id)
    if (!config) {
      throw new AgentUnavailableError(row.id, 'invalid-config', row.agent_type, 'config_json')
    }
    return { ...common, kind: 'deepchat', source: row.source, config }
  }

  if (row.agent_type !== 'acp') {
    throw new AgentUnavailableError(row.id, 'unknown-kind', row.agent_type, 'agent_type')
  }

  if (row.source === 'manual') {
    const config = parseJson<StoredAcpManualConfig>(row.config_json)
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new AgentUnavailableError(row.id, 'invalid-config', row.agent_type, 'config_json')
    }
    if (typeof config.command !== 'string' || !config.command.trim()) {
      throw new AgentUnavailableError(
        row.id,
        'missing-manual-command',
        row.agent_type,
        'config_json'
      )
    }
    if (
      (config.args !== undefined &&
        (!Array.isArray(config.args) || !config.args.every((arg) => typeof arg === 'string'))) ||
      (config.env !== undefined &&
        (typeof config.env !== 'object' ||
          config.env === null ||
          Array.isArray(config.env) ||
          !Object.values(config.env).every((value) => typeof value === 'string')))
    ) {
      throw new AgentUnavailableError(row.id, 'invalid-config', row.agent_type, 'config_json')
    }
    return {
      ...common,
      kind: 'acp',
      source: 'manual',
      launch: {
        command: config.command.trim(),
        args: (config.args as string[] | undefined) ?? [],
        env: (config.env as Record<string, string> | undefined) ?? {}
      }
    }
  }

  if (row.source === 'registry') {
    const registry = context.resolveRegistryReference(row.id)
    if (!registry) {
      throw new AgentUnavailableError(row.id, 'missing-registry-reference', row.agent_type)
    }
    return {
      ...common,
      kind: 'acp',
      source: 'registry',
      registry,
      installState: parseJson<StoredAgentState>(row.state_json)?.installState ?? null
    }
  }

  throw new AgentUnavailableError(row.id, 'invalid-source', row.agent_type, 'source')
}
