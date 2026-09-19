import type {
  ExecutionJournalAuditReader,
  ExecutionJournalRecoveryReader,
  ExecutionJournalWriter,
  TapeAnchorReader,
  TapeAnchorWriter,
  TapeCompactionModelCallReader,
  TapeCompactionModelCallWriter,
  TapeContextOccupancyReader,
  TapeEffectiveUserMessageSourceReader,
  TapeExecutionViewManifestReader,
  TapeIncarnationReader,
  TapeInspectionReader,
  TapeLifecycleAdmin,
  TapeMessageFactWriter,
  TapeNonContextEntryReader,
  TapeProjectionHeadReader,
  TapeProviderAttemptReader,
  TapeProviderAttemptWriter,
  TapeReconciliationPort,
  TapeRunViewManifestReader,
  TapeRuntimeSkillViewContextReader,
  TapeSessionInspectionReader,
  TapeSkillMaterializationReader,
  TapeSkillMaterializationWriter,
  TapeSkillRequestAuthorityReader,
  TapeSkillViewResultFactWriter,
  TapeToolFactWriter,
  TapeToolSurfaceViewReader,
  TapeToolSurfaceViewWriter,
  TapeViewManifestReader,
  TapeViewManifestWriter
} from '../tape/ports/capabilities.js'

/**
 * Every Tape capability the composed facade offers to consumers, named for kernel dependency
 * declarations. The host composition exposes its facade under this structural type so a consumer
 * can only reach what a port declares.
 */
export type TapeStorePort = TapeToolFactWriter &
  TapeMessageFactWriter &
  TapeProjectionHeadReader &
  TapeProviderAttemptReader &
  TapeProviderAttemptWriter &
  TapeCompactionModelCallReader &
  TapeCompactionModelCallWriter &
  TapeContextOccupancyReader &
  TapeNonContextEntryReader &
  TapeReconciliationPort &
  TapeViewManifestReader &
  TapeEffectiveUserMessageSourceReader &
  TapeExecutionViewManifestReader &
  TapeSkillRequestAuthorityReader &
  TapeRunViewManifestReader &
  TapeViewManifestWriter &
  TapeToolSurfaceViewReader &
  TapeToolSurfaceViewWriter &
  TapeAnchorReader &
  TapeAnchorWriter &
  TapeInspectionReader &
  TapeSessionInspectionReader &
  TapeLifecycleAdmin &
  ExecutionJournalWriter &
  ExecutionJournalAuditReader &
  ExecutionJournalRecoveryReader &
  TapeIncarnationReader &
  TapeSkillViewResultFactWriter &
  TapeRuntimeSkillViewContextReader &
  TapeSkillMaterializationWriter &
  TapeSkillMaterializationReader
