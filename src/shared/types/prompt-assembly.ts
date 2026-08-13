export const DEEPCHAT_PROMPT_SECTION_KINDS = [
  'configured_prompt',
  'runtime_capabilities',
  'system_environment',
  'agents_instructions',
  'skills_metadata',
  'pinned_skills',
  'tooling',
  'orchestration_policy',
  'permission_rules',
  'verification_policy',
  'attachment_safety',
  'effective_system_prompt'
] as const

export type DeepChatPromptSectionKind = (typeof DEEPCHAT_PROMPT_SECTION_KINDS)[number]

export const DEEPCHAT_PROMPT_SECTION_INCLUSIONS = ['included', 'omitted', 'degraded'] as const

export type DeepChatPromptSectionInclusion = (typeof DEEPCHAT_PROMPT_SECTION_INCLUSIONS)[number]

export const DEEPCHAT_PROMPT_SOURCE_FRESHNESS_VALUES = [
  'fresh',
  'cached',
  'deferred',
  'missing',
  'read_error'
] as const

export type DeepChatPromptSourceFreshness = (typeof DEEPCHAT_PROMPT_SOURCE_FRESHNESS_VALUES)[number]

export const DEEPCHAT_PROMPT_DEGRADATION_CODES = [
  'agents_file_deferred',
  'agents_file_missing',
  'agents_file_read_error',
  'skill_agent_unavailable',
  'skill_metadata_unavailable',
  'skill_catalog_shortened',
  'skill_catalog_omitted',
  'active_skills_unavailable',
  'pinned_skill_unavailable',
  'environment_build_failed',
  'tooling_build_failed',
  'prompt_projection_mismatch',
  'legacy_prompt_provenance'
] as const

export type DeepChatPromptDegradationCode = (typeof DEEPCHAT_PROMPT_DEGRADATION_CODES)[number]

export interface DeepChatPromptSectionProvenance {
  readonly kind: DeepChatPromptSectionKind
  readonly sourceRef: string
  readonly inclusion: DeepChatPromptSectionInclusion
  readonly contentHash?: string
  readonly freshness?: DeepChatPromptSourceFreshness
  readonly degradationCodes?: readonly DeepChatPromptDegradationCode[]
}

export interface DeepChatPromptAssemblySection extends DeepChatPromptSectionProvenance {
  readonly content: string
  readonly separatorBefore?: '\n' | '\n\n'
}

export interface DeepChatPromptAssembly {
  readonly prompt: string
  readonly sections: readonly DeepChatPromptAssemblySection[]
}
