import type { AcpAgentInstallState, AcpRegistryDistribution } from '@shared/types/acp'
import type { AgentAvatar, DeepChatAgentConfig } from '@shared/types/agent-interface'

export interface AgentDescriptorBase {
  id: string
  kind: 'deepchat' | 'acp'
  name: string
  enabled: boolean
  protected: boolean
  description: string | null
  icon: string | null
  avatar: AgentAvatar | null
}

export interface DeepChatAgentDescriptor extends AgentDescriptorBase {
  kind: 'deepchat'
  source: 'builtin' | 'manual'
  config: DeepChatAgentConfig
}

interface AcpAgentDescriptorBase extends AgentDescriptorBase {
  kind: 'acp'
  source: 'manual' | 'registry'
}

export interface AcpManualAgentDescriptor extends AcpAgentDescriptorBase {
  source: 'manual'
  launch: {
    command: string
    args: string[]
    env: Record<string, string>
  }
}

export interface AcpRegistryReference {
  id: string
  version: string
  distribution: AcpRegistryDistribution
}

export interface AcpRegistryAgentDescriptor extends AcpAgentDescriptorBase {
  source: 'registry'
  registry: AcpRegistryReference
  installState: AcpAgentInstallState | null
}

export type AcpAgentDescriptor = AcpManualAgentDescriptor | AcpRegistryAgentDescriptor
export type AgentDescriptor = DeepChatAgentDescriptor | AcpAgentDescriptor

export interface AgentCatalogRecord extends AgentDescriptorBase {
  source: 'builtin' | 'manual' | 'registry'
  config: DeepChatAgentConfig | null
  installState: AcpAgentInstallState | null
}
