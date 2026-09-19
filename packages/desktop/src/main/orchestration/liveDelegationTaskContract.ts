import type {
  DeepChatEvaluationRef,
  DeepChatHandoffFormatRequirement,
  DeepChatTaskWorkspaceCeiling
} from '@shared/types/task-contract'

export const LIVE_DELEGATION_REQUIRED_HANDOFF_SECTIONS = [
  'Handoff',
  'Result',
  'Evidence',
  'Changed Files',
  'Validation',
  'Unresolved'
] as const

export interface LiveDelegationTaskContractInput {
  workspace: DeepChatTaskWorkspaceCeiling
  handoffFormat: readonly DeepChatHandoffFormatRequirement[]
  predecessorEvaluationRef: DeepChatEvaluationRef | null
  maxToolEffect: 'read' | 'write'
  maxSubagentDepth: number
}

export type LegacyLiveDelegationTaskContractInput = LiveDelegationTaskContractInput & {
  creationReason: 'legacy_recovery'
}

export function createLiveDelegationTaskContractInput(
  projectDir: string | null,
  predecessorEvaluationRef: DeepChatEvaluationRef | null = null
): LiveDelegationTaskContractInput {
  return {
    workspace: projectDir ? { kind: 'path', path: projectDir } : { kind: 'runtime_default' },
    handoffFormat: [
      {
        id: 'live-delegation-required-sections',
        kind: 'required_sections',
        level: 2,
        sections: LIVE_DELEGATION_REQUIRED_HANDOFF_SECTIONS
      }
    ],
    predecessorEvaluationRef,
    maxToolEffect: 'write',
    maxSubagentDepth: 0
  }
}

export function createLegacyLiveDelegationTaskContractInput(
  projectDir: string | null
): LegacyLiveDelegationTaskContractInput {
  return {
    ...createLiveDelegationTaskContractInput(projectDir),
    handoffFormat: [],
    creationReason: 'legacy_recovery'
  }
}
