/**
 * Presenters Type Definitions
 * Aggregates all presenter interfaces and types
 */

// LLM Provider types
export type {
  ProviderRuntimePort,
  LLM_PROVIDER,
  LLM_PROVIDER_BASE,
  MODEL_META,
  RateLimitQueueSnapshot,
  RENDERER_MODEL_META,
  StandaloneImageGenerationResult,
  StandaloneVideoGenerationResult,
  LLM_EMBEDDING_ATTRS,
  KeyStatus,
  AwsBedrockCredential,
  AWS_BEDROCK_PROVIDER,
  VERTEX_PROVIDER,
  DefaultModelSetting,
  IModelConfig,
  ModelConfig,
  ModelConfigSource,
  OllamaModel,
  ProgressResponse,
  ProviderModelConfigs,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult
} from '../provider'

export type {
  AcpAgentConfig,
  AcpAgentEnvOverride,
  AcpAgentInstallState,
  AcpAgentInstallStatus,
  AcpAgentProfile,
  AcpAgentSource,
  AcpAgentState,
  AcpBuiltinAgent,
  AcpBuiltinAgentId,
  AcpConfigOption,
  AcpConfigOptionValue,
  AcpConfigState,
  AcpCustomAgent,
  AcpDebugActionType,
  AcpDebugEventEntry,
  AcpDebugEventKind,
  AcpDebugRequest,
  AcpDebugRunResult,
  AcpLegacyBuiltinAgentId,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpRegistryBinaryDistribution,
  AcpRegistryDistribution,
  AcpRegistryDistributionType,
  AcpRegistryPackageDistribution,
  AcpResolvedLaunchSpec,
  AcpSessionEntity,
  AcpSessionUpsertPayload,
  AcpStoreData,
  AcpTurnFinishPayload,
  AcpTurnStartPayload,
  AcpTurnStatus,
  AcpWorkdirInfo,
  AgentProcessHandle,
  AgentProcessStatus,
  AgentProviderMetadata,
  AgentSessionLifecycleStatus,
  AgentSessionState
} from '../acp'

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

// Search types
export type { ISearchPresenter } from './search.presenter'

// Exporter types
export type { IConversationExporter, NowledgeMemConfig } from './exporter.presenter'

export type { FileServicePort, FileMetaData, FileOperation } from '../file'
export type * from '../mcp'

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
  WorkspaceWatchHealth,
  WorkspaceWatchMode,
  WorkspaceWatchStatusReason,
  WorkspaceWatchStatusEvent,
  ResolveMarkdownLinkedFileInput,
  WorkspaceLinkedFileResolution,
  WorkspaceServicePort
} from '../workspace'

// Tool runtime types
export type { ToolServicePort } from '../tool'

export type {
  FloatingChatWindowLike,
  IShortcutPresenter,
  ITabPresenter,
  IWindowPresenter,
  IYoBrowserPresenter,
  ShortcutKey,
  ShortcutKeySetting,
  TabCreateOptions,
  TabData
} from '../desktop'

// New agent architecture types
export type { IProjectPresenter } from './project.presenter'
export type {
  ChannelSettingsMap,
  DiscordPairingSnapshot,
  DiscordRemoteBindingSummary,
  DiscordRemoteSettings,
  DiscordRemoteStatus,
  FeishuPairingSnapshot,
  FeishuAuthResult,
  FeishuAuthSession,
  FeishuAuthStartInput,
  FeishuAuthWaitInput,
  FeishuBrand,
  FeishuInstallResult,
  FeishuInstallSession,
  FeishuInstallStartInput,
  FeishuInstallWaitInput,
  FeishuRemoteBindingSummary,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  RemoteServicePort,
  PairableRemoteChannel,
  QQBotPairingSnapshot,
  QQBotRemoteBindingSummary,
  QQBotRemoteSettings,
  QQBotRemoteStatus,
  RemoteBindingKind,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelId,
  RemoteChannelSettings,
  RemoteChannelStatus,
  RemotePairingSnapshot,
  RemoteRuntimeState,
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus,
  TelegramStreamMode,
  WeixinIlinkAccountStatus,
  WeixinIlinkAccountSummary,
  WeixinIlinkLoginResult,
  WeixinIlinkLoginSession,
  WeixinIlinkRemoteSettings,
  WeixinIlinkRemoteStatus
} from './remote-service'

// Compatibility presenter types that still await finer-grained extraction.
export * from './core.presenter'
