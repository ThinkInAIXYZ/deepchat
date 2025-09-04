/**
 * Presenters Type Definitions
 * Aggregates all presenter interfaces and types
 */

// LLM Provider types
export type {
  ILlmProviderPresenter,
  LLM_PROVIDER,
  LLM_PROVIDER_BASE,
  MODEL_META,
  RENDERER_MODEL_META,
  LLM_EMBEDDING_ATTRS,
  KeyStatus,
  AwsBedrockCredential,
  AWS_BEDROCK_PROVIDER,
  OllamaModel,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult
} from './llmprovider.presenter'

// Thread/Conversation types
export type {
  IThreadPresenter,
  IMessageManager,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  MESSAGE,
  MESSAGE_STATUS,
  MESSAGE_ROLE,
  MESSAGE_METADATA,
  SearchEngineTemplate,
  SearchResult
} from './thread.presenter'

// Re-export legacy types temporarily for compatibility
export * from './legacy.presenters'
