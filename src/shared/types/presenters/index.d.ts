/**
 * Presenters Type Definitions
 * Aggregates all presenter interfaces and types
 */

// LLM Provider types
export type {
  AcpConfigOption,
  AcpConfigOptionValue,
  AcpConfigState,
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

// Session types
export type {
  SessionStatus,
  SessionConfig,
  SessionBindings,
  WorkspaceContext,
  Session,
  CreateSessionOptions,
  CreateSessionParams,
  CreateChildSessionParams,
  ISessionPresenter
} from './session.presenter'

// Search types
export type { ISearchPresenter } from './search.presenter'

// Exporter types
export type { IConversationExporter, NowledgeMemConfig } from './exporter.presenter'

export type * from './agent-provider'

// Generic Workspace types (for all Agent modes)
export type {
  SidePanelTab,
  WorkspaceNavSection,
  WorkspaceFileNode,
  WorkspaceViewMode,
  WorkspaceFilePreviewKind,
  WorkspaceFileMetadata,
  WorkspaceFilePreview,
  WorkspaceGitChangeType,
  WorkspaceGitFileChange,
  WorkspaceGitState,
  WorkspaceGitDiff,
  WorkspaceInvalidationKind,
  WorkspaceInvalidationSource,
  WorkspaceInvalidationEvent,
  IWorkspacePresenter
} from './workspace'

// Tool Presenter types
export type { IToolPresenter } from './tool.presenter'

// New agent architecture types
export type { INewAgentPresenter } from './new-agent.presenter'
export type { IProjectPresenter } from './project.presenter'
export type {
  FeishuPairingSnapshot,
  FeishuRemoteBindingSummary,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  IRemoteControlPresenter,
  RemoteBindingKind,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelSettings,
  RemoteChannelStatus,
  RemotePairingSnapshot,
  RemoteRuntimeState,
  TelegramHookSettings,
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus,
  TelegramStreamMode
} from './remote-control.presenter'

// Re-export legacy types temporarily for compatibility
export * from './legacy.presenters'
