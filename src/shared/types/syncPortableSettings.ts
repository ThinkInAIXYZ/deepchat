/** Portable chat preferences; device paths, security switches and local UI state stay local. */
export const SYNC_PORTABLE_SETTINGS = [
  'defaultModel',
  'assistantModel',
  'defaultVisionModel',
  'preferredModel',
  'default_system_prompt',
  'autoCompactionEnabled',
  'autoCompactionTriggerThreshold',
  'autoCompactionRetainRecentPairs',
  'copyWithCotEnabled'
] as const
