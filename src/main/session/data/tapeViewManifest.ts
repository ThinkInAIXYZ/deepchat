/** @deprecated Import ViewManifest helpers from `@/tape/domain/viewManifest`. */
export {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  hashJson,
  isCompactionRecord,
  resolveTapeViewManifestPolicy,
  stableJsonStringify,
  TAPE_VIEW_CONTEXT_BUILDER_VERSION,
  TAPE_VIEW_MANIFEST_EVENT_NAME,
  TAPE_VIEW_MANIFEST_HASH_VERSION,
  verifyTapeViewManifestHash
} from '@/tape/domain/viewManifest'

/** @deprecated Import ViewManifest types from `@/tape/domain/viewManifest`. */
export type {
  ContextSummaryCursorMetadata,
  TapeViewContextSelection,
  TapeViewManifestBuildInput,
  TapeViewManifestLookupMaps as TapeViewManifestSourceMaps,
  TapeViewManifestPolicyInput,
  TapeViewManifestPolicyResult
} from '@/tape/domain/viewManifest'
