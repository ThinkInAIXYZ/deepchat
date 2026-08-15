import type {
  DeepChatLoopTapePort,
  NestedExecutionJournalWriter,
  TapeEffectiveUserMessageSourceReader,
  TapeExecutionViewManifestReader,
  TapeIncarnationReader,
  TapeRunViewManifestReader,
  TapeSkillMaterializationReader,
  TapeSkillMaterializationWriter
} from '../ports/capabilities'

export type SkillContextTapePort = TapeIncarnationReader &
  TapeSkillMaterializationWriter &
  TapeSkillMaterializationReader &
  TapeEffectiveUserMessageSourceReader &
  TapeRunViewManifestReader

export type SkillExecutionAuthorityTapePort = TapeExecutionViewManifestReader &
  TapeIncarnationReader &
  TapeSkillMaterializationReader

export function createSkillContextTapePort(source: SkillContextTapePort): SkillContextTapePort {
  return Object.freeze({
    getTapeIncarnationId: (sessionId: string) => source.getTapeIncarnationId(sessionId),
    materializeSkillContexts: (
      inputs: Parameters<SkillContextTapePort['materializeSkillContexts']>[0]
    ) => source.materializeSkillContexts(inputs),
    readSkillMaterialization: (
      ref: Parameters<SkillContextTapePort['readSkillMaterialization']>[0]
    ) => source.readSkillMaterialization(ref),
    getEffectiveUserMessageSourceEntryId: (sessionId: string, messageId: string) =>
      source.getEffectiveUserMessageSourceEntryId(sessionId, messageId),
    getLatestViewManifestByRunBinding: (
      input: Parameters<SkillContextTapePort['getLatestViewManifestByRunBinding']>[0]
    ) => source.getLatestViewManifestByRunBinding(input)
  })
}

export function createSkillExecutionAuthorityTapePort(
  source: SkillExecutionAuthorityTapePort
): SkillExecutionAuthorityTapePort {
  return Object.freeze({
    getViewManifestByExecutionBinding: (
      input: Parameters<SkillExecutionAuthorityTapePort['getViewManifestByExecutionBinding']>[0]
    ) => source.getViewManifestByExecutionBinding(input),
    getTapeIncarnationId: (sessionId: string) => source.getTapeIncarnationId(sessionId),
    readSkillMaterialization: (
      ref: Parameters<SkillExecutionAuthorityTapePort['readSkillMaterialization']>[0]
    ) => source.readSkillMaterialization(ref)
  })
}

export function createDeepChatLoopTapePort(
  source: Omit<DeepChatLoopTapePort, keyof NestedExecutionJournalWriter>,
  nestedExecutionJournal: NestedExecutionJournalWriter
): DeepChatLoopTapePort {
  return Object.freeze({
    ensureSessionTapeReady: (...args: Parameters<DeepChatLoopTapePort['ensureSessionTapeReady']>) =>
      source.ensureSessionTapeReady(...args),
    getViewManifestSourceMaps: (
      ...args: Parameters<DeepChatLoopTapePort['getViewManifestSourceMaps']>
    ) => source.getViewManifestSourceMaps(...args),
    listViewManifestsByMessage: (
      ...args: Parameters<DeepChatLoopTapePort['listViewManifestsByMessage']>
    ) => source.listViewManifestsByMessage(...args),
    listViewManifestsByMessageRequest: (
      ...args: Parameters<DeepChatLoopTapePort['listViewManifestsByMessageRequest']>
    ) => source.listViewManifestsByMessageRequest(...args),
    getViewManifestByExecutionBinding: (
      input: Parameters<DeepChatLoopTapePort['getViewManifestByExecutionBinding']>[0]
    ) => source.getViewManifestByExecutionBinding(input),
    assertSkillRequestAuthority: (
      input: Parameters<DeepChatLoopTapePort['assertSkillRequestAuthority']>[0]
    ) => source.assertSkillRequestAuthority(input),
    appendViewManifest: (manifest: Parameters<DeepChatLoopTapePort['appendViewManifest']>[0]) =>
      source.appendViewManifest(manifest),
    commitToolSurfaceView: (input: Parameters<DeepChatLoopTapePort['commitToolSurfaceView']>[0]) =>
      source.commitToolSurfaceView(input),
    appendToolFact: (input: Parameters<DeepChatLoopTapePort['appendToolFact']>[0]) =>
      source.appendToolFact(input),
    getTapeIncarnationId: (sessionId: string) => source.getTapeIncarnationId(sessionId),
    appendSkillViewResultFact: (
      input: Parameters<DeepChatLoopTapePort['appendSkillViewResultFact']>[0]
    ) => source.appendSkillViewResultFact(input),
    recoverRuntimeSkillViewContexts: (
      input: Parameters<DeepChatLoopTapePort['recoverRuntimeSkillViewContexts']>[0]
    ) => source.recoverRuntimeSkillViewContexts(input),
    appendProviderAttempt: (input: Parameters<DeepChatLoopTapePort['appendProviderAttempt']>[0]) =>
      source.appendProviderAttempt(input),
    getMaxProviderAttemptRequestSeq: (
      ...args: Parameters<DeepChatLoopTapePort['getMaxProviderAttemptRequestSeq']>
    ) => source.getMaxProviderAttemptRequestSeq(...args),
    commitRunStarted: (input: Parameters<DeepChatLoopTapePort['commitRunStarted']>[0]) =>
      source.commitRunStarted(input),
    commitDispatch: (input: Parameters<DeepChatLoopTapePort['commitDispatch']>[0]) =>
      source.commitDispatch(input),
    commitToolOutcome: (input: Parameters<DeepChatLoopTapePort['commitToolOutcome']>[0]) =>
      source.commitToolOutcome(input),
    commitNestedDispatch: (input: Parameters<DeepChatLoopTapePort['commitNestedDispatch']>[0]) =>
      nestedExecutionJournal.commitNestedDispatch(input),
    commitNestedToolOutcome: (
      input: Parameters<DeepChatLoopTapePort['commitNestedToolOutcome']>[0]
    ) => nestedExecutionJournal.commitNestedToolOutcome(input),
    commitRunTerminal: (input: Parameters<DeepChatLoopTapePort['commitRunTerminal']>[0]) =>
      source.commitRunTerminal(input)
  })
}
