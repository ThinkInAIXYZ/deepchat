import type { PermissionMode } from './agent-interface'
import type { ToolExecutionContract } from './core/mcp'
import type { DeepChatPromptSectionProvenance } from './prompt-assembly'
import type { DeepChatTaskContractRef } from './task-contract'

export const DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION = 1 as const
export const DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION = 1 as const

export type DeepChatExecutionToolSource = 'agent' | 'mcp'

export interface DeepChatExecutionToolTargetIdentity {
  readonly providerVisibleName: string
  readonly source: DeepChatExecutionToolSource
  readonly serverName: string
  readonly serverId: string | null
  readonly configGeneration: number | null
  readonly bindingHash: string | null
  readonly originalName: string
}

export interface DeepChatExecutionToolCeiling {
  readonly target: DeepChatExecutionToolTargetIdentity
  readonly execution: ToolExecutionContract
}

export type DeepChatExecutionWorkspaceCeiling =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'runtime_default' }

export interface DeepChatExecutionContractRequest {
  readonly sessionId: string
  readonly messageId: string
  readonly runId: string
  readonly requestSeq: number
}

export const DEEPCHAT_EXECUTION_CONTRACT_BINDING_SCHEMA_VERSION = 1 as const

export interface DeepChatExecutionContractBinding {
  readonly schemaVersion: typeof DEEPCHAT_EXECUTION_CONTRACT_BINDING_SCHEMA_VERSION
  readonly request: DeepChatExecutionContractRequest
  readonly contractHash: string
}

export interface DeepChatExecutionContractCeilings {
  readonly tools: readonly DeepChatExecutionToolCeiling[]
  readonly workspace: DeepChatExecutionWorkspaceCeiling
  readonly maxSubagentDepth: number
}

export interface DeepChatExecutionDynamicControlSnapshot {
  readonly permissionMode: PermissionMode
  readonly requestAdmitted: boolean
  readonly cancellationRequested: boolean
}

export interface DeepChatExecutionContractProvenance {
  readonly promptSections: readonly DeepChatPromptSectionProvenance[]
  readonly providerId: string
  readonly modelId: string
  readonly promptHash: string
  readonly effectiveGenerationConfigHash: string
  readonly providerVisibleToolDefinitionsHash: string
  readonly internalExecutionPolicyHash: string
  readonly assemblerVersion: string
  readonly taskContractRef: DeepChatTaskContractRef | null
}

export interface DeepChatExecutionContract {
  readonly schemaVersion: typeof DEEPCHAT_EXECUTION_CONTRACT_SCHEMA_VERSION
  readonly hashVersion: typeof DEEPCHAT_EXECUTION_CONTRACT_HASH_VERSION
  readonly request: DeepChatExecutionContractRequest
  readonly ceilings: DeepChatExecutionContractCeilings
  readonly dynamicControlSnapshot: DeepChatExecutionDynamicControlSnapshot
  readonly provenance: DeepChatExecutionContractProvenance
  readonly contractHash: string
}
