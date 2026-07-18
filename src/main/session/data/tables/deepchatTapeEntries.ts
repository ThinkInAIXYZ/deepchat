/** @deprecated Import the SQLite Tape store from `@/tape/infrastructure/sqlite/tapeEntryStore`. */
export {
  buildDeepChatTapeFtsMatch,
  buildDeepChatTapeLikeSearchPredicate,
  DeepChatTapeEntriesTable,
  normalizeDeepChatTapeReadSources,
  serializeDeepChatTapeReadSources,
  SUMMARY_ANCHOR_NAMES,
  TAPE_INCARNATION_META_KEY
} from '@/tape/infrastructure/sqlite/tapeEntryStore'

/** @deprecated Import SQLite Tape types from `@/tape/infrastructure/sqlite/tapeEntryStore`. */
export type {
  DeepChatTapeAppendInput,
  DeepChatTapeEntryKind,
  DeepChatTapeEntryRow,
  DeepChatTapeMutationProjection,
  DeepChatTapeReadSource,
  DeepChatTapeSearchInput,
  DeepChatTapeSourceInput,
  DeepChatTapeSourceType
} from '@/tape/infrastructure/sqlite/tapeEntryStore'
