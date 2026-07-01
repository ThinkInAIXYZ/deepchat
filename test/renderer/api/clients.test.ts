import { isReactive, reactive } from 'vue'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { HooksNotificationsSettings } from '@shared/hooksNotifications'
import { createAcpTerminalClient } from '../../../src/renderer/api/AcpTerminalClient'
import { createAppRuntimeClient } from '../../../src/renderer/api/AppRuntimeClient'
import { createBrowserClient } from '../../../src/renderer/api/BrowserClient'
import { createChatClient } from '../../../src/renderer/api/ChatClient'
import { createConfigClient } from '../../../src/renderer/api/ConfigClient'
import { createContextMenuClient } from '../../../src/renderer/api/ContextMenuClient'
import { createDatabaseSecurityClient } from '../../../src/renderer/api/DatabaseSecurityClient'
import { createDeviceClient } from '../../../src/renderer/api/DeviceClient'
import { createKnowledgeClient } from '../../../src/renderer/api/KnowledgeClient'
import { createMcpClient } from '../../../src/renderer/api/McpClient'
import { createMemoryClient } from '../../../src/renderer/api/MemoryClient'
import { createModelClient } from '../../../src/renderer/api/ModelClient'
import { createNowledgeMemClient } from '../../../src/renderer/api/NowledgeMemClient'
import { createOAuthClient } from '../../../src/renderer/api/OAuthClient'
import { createProjectClient } from '../../../src/renderer/api/ProjectClient'
import { createRemoteControlClient } from '../../../src/renderer/api/RemoteControlClient'
import { createProviderClient } from '../../../src/renderer/api/ProviderClient'
import { createSessionClient } from '../../../src/renderer/api/SessionClient'
import { createSettingsClient } from '../../../src/renderer/api/SettingsClient'
import { createShortcutClient } from '../../../src/renderer/api/ShortcutClient'
import { createSkillClient } from '../../../src/renderer/api/SkillClient'
import { createSkillSyncClient } from '../../../src/renderer/api/SkillSyncClient'
import { createToolClient } from '../../../src/renderer/api/ToolClient'
import { createWindowClient } from '../../../src/renderer/api/WindowClient'

describe('renderer api clients', () => {
  function createBridge(): DeepchatBridge {
    let addedMemoryCategory: unknown = null

    return {
      invoke: vi
        .fn()
        .mockImplementation(async (routeName: string, payload?: Record<string, unknown>) => {
          switch (routeName) {
            case 'acpTerminal.input':
              return { sent: true }
            case 'acpTerminal.kill':
              return { killed: true }
            case 'shortcut.register':
              return { registered: true }
            case 'shortcut.unregister':
              return { unregistered: true }
            case 'shortcut.destroy':
              return { destroyed: true }
            case 'config.getEntries':
              return { version: 0, values: {} }
            case 'config.updateEntries':
              return {
                version: 1,
                values: Object.fromEntries(
                  Array.isArray(payload?.changes)
                    ? payload.changes
                        .filter(
                          (change): change is { key: string; value: unknown } =>
                            Boolean(change) &&
                            typeof change === 'object' &&
                            typeof (change as { key?: unknown }).key === 'string'
                        )
                        .map((change) => [change.key, change.value])
                    : []
                )
              }
            case 'config.getSystemPrompts':
              return { prompts: [], defaultPromptId: 'empty', prompt: '' }
            case 'config.getDefaultProjectPath':
              return { path: null }
            case 'config.getKnowledgeConfigs':
              return { configs: [] }
            case 'config.setKnowledgeConfigs':
              return { configs: payload?.configs ?? [] }
            case 'config.getProxySettings':
              return { mode: 'system', customProxyUrl: '' }
            case 'config.setProxyMode':
              return { mode: payload?.mode, customProxyUrl: '' }
            case 'config.setCustomProxyUrl':
              return { mode: 'custom', customProxyUrl: payload?.url }
            case 'config.openLoggingFolder':
              return { opened: true }
            case 'config.getUpdateChannel':
              return { channel: 'stable' }
            case 'config.setUpdateChannel':
              return { channel: payload?.channel }
            case 'config.getSkillDraftSuggestions':
              return { enabled: false }
            case 'config.setSkillDraftSuggestions':
              return { enabled: payload?.enabled }
            case 'config.refreshProviderDb':
              return {
                result: {
                  status: 'updated',
                  lastUpdated: 123,
                  providersCount: 2
                }
              }
            case 'config.getHooksNotifications':
              return { config: { hooks: [] } }
            case 'config.setHooksNotifications':
              return { config: payload?.config }
            case 'config.testHookCommand':
              return {
                result: {
                  success: true,
                  durationMs: 10,
                  exitCode: 0
                }
              }
            case 'databaseSecurity.getStatus':
              return {
                status: {
                  enabled: false,
                  cipher: 'sqlcipher',
                  safeStorageAvailable: true,
                  safeStorageBackend: undefined,
                  passwordStorage: 'none',
                  manualUnlockRequired: false,
                  migrationInProgress: false,
                  lastMigrationAt: undefined
                }
              }
            case 'databaseSecurity.enable':
            case 'databaseSecurity.changePassword':
            case 'databaseSecurity.disable':
              return {
                status: {
                  enabled: routeName !== 'databaseSecurity.disable',
                  cipher: 'sqlcipher',
                  safeStorageAvailable: true,
                  safeStorageBackend: undefined,
                  passwordStorage: 'safeStorage',
                  manualUnlockRequired: false,
                  migrationInProgress: false,
                  lastMigrationAt: 123
                }
              }
            case 'databaseSecurity.repairSchema':
              return {
                report: {
                  startedAt: 1,
                  finishedAt: 2,
                  status: 'healthy',
                  backupPath: null,
                  diagnosisBeforeRepair: {
                    checkedAt: 1,
                    isHealthy: true,
                    issues: [],
                    repairableIssues: [],
                    manualIssues: []
                  },
                  diagnosisAfterRepair: {
                    checkedAt: 2,
                    isHealthy: true,
                    issues: [],
                    repairableIssues: [],
                    manualIssues: []
                  },
                  repairedIssues: [],
                  remainingIssues: []
                }
              }
            case 'config.setAcpEnabled':
              return { enabled: payload?.enabled }
            case 'config.listAcpRegistryAgents':
            case 'config.refreshAcpRegistry':
              return { agents: [] }
            case 'config.setAcpAgentEnabled':
            case 'config.setAcpAgentEnvOverride':
            case 'config.uninstallAcpRegistryAgent':
              return { ok: true }
            case 'config.ensureAcpAgentInstalled':
            case 'config.repairAcpAgent':
              return {
                installState: {
                  status: 'installed',
                  distributionType: 'npx',
                  version: '1.0.0',
                  installedAt: 123,
                  lastCheckedAt: 123,
                  installDir: null,
                  error: null
                }
              }
            case 'config.listManualAcpAgents':
              return { agents: [] }
            case 'config.addManualAcpAgent':
              return {
                agent: {
                  id: 'manual-acp',
                  name: payload?.name ?? 'Manual ACP',
                  command: payload?.command ?? 'node',
                  enabled: true,
                  source: 'manual'
                }
              }
            case 'config.updateManualAcpAgent':
              return {
                agent: {
                  id: payload?.agentId ?? 'manual-acp',
                  name: 'Manual ACP',
                  command: 'node',
                  enabled: true,
                  source: 'manual'
                }
              }
            case 'config.removeManualAcpAgent':
              return { removed: true }
            case 'config.listAgents':
              return { agents: [] }
            case 'config.createDeepChatAgent':
              return {
                agent: {
                  id: 'deepchat-new',
                  name: payload?.name ?? 'New agent',
                  type: 'deepchat',
                  enabled: true
                }
              }
            case 'config.updateDeepChatAgent':
              return {
                agent: {
                  id: payload?.agentId ?? 'deepchat',
                  name: 'Updated agent',
                  type: 'deepchat',
                  enabled: true
                }
              }
            case 'config.deleteDeepChatAgent':
              return { removed: true }
            case 'sessions.getAgents':
              return {
                agents: [
                  {
                    id: 'deepchat',
                    name: 'DeepChat',
                    type: 'deepchat',
                    enabled: true
                  }
                ]
              }
            case 'sessions.getUsageDashboard':
              return {
                dashboard: {
                  recordingStartedAt: null,
                  backfillStatus: {
                    status: 'completed',
                    startedAt: null,
                    finishedAt: null,
                    error: null,
                    updatedAt: 123
                  },
                  summary: {
                    messageCount: 1,
                    sessionCount: 1,
                    inputTokens: 10,
                    outputTokens: 20,
                    totalTokens: 30,
                    cachedInputTokens: 0,
                    cacheHitRate: 0,
                    estimatedCostUsd: null,
                    mostActiveDay: {
                      date: '2026-06-11',
                      messageCount: 1
                    }
                  },
                  calendar: [],
                  providerBreakdown: [],
                  modelBreakdown: [],
                  rtk: {
                    scope: 'deepchat',
                    enabled: true,
                    effectiveEnabled: true,
                    available: true,
                    health: 'healthy',
                    checkedAt: 123,
                    source: 'bundled',
                    failureStage: null,
                    failureMessage: null,
                    summary: {
                      totalCommands: 0,
                      totalInputTokens: 0,
                      totalOutputTokens: 0,
                      totalSavedTokens: 0,
                      avgSavingsPct: 0,
                      totalTimeMs: 0,
                      avgTimeMs: 0
                    },
                    daily: []
                  }
                }
              }
            case 'sessions.retryRtkHealthCheck':
              return { retried: true }
            case 'knowledge.isSupported':
              return { supported: true }
            case 'knowledge.getSupportedLanguages':
              return { languages: ['markdown', 'typescript'] }
            case 'knowledge.getSeparatorsForLanguage':
              return { separators: ['\n\n', '\n', ' ', ''] }
            case 'knowledge.getSupportedFileExtensions':
              return { extensions: ['md', 'txt', 'pdf'] }
            case 'knowledge.listFiles':
              return {
                files: [
                  {
                    id: 'file-1',
                    name: 'guide.md',
                    path: '/workspace/guide.md',
                    mimeType: 'text/markdown',
                    status: 'completed',
                    uploadedAt: 123,
                    metadata: {
                      size: 1024,
                      totalChunks: 3
                    }
                  }
                ]
              }
            case 'knowledge.similarityQuery':
              return {
                results: [
                  {
                    id: 'chunk-1',
                    metadata: {
                      from: 'guide.md',
                      filePath: '/workspace/guide.md',
                      content: 'hello knowledge'
                    },
                    distance: 0.1
                  }
                ]
              }
            case 'knowledge.validateFile':
              return {
                result: {
                  isSupported: true,
                  mimeType: 'text/markdown',
                  adapterType: 'text'
                }
              }
            case 'knowledge.addFile':
            case 'knowledge.reAddFile':
              return {
                result: {
                  data: {
                    id: 'file-1',
                    name: 'guide.md',
                    path: '/workspace/guide.md',
                    mimeType: 'text/markdown',
                    status: 'processing',
                    uploadedAt: 123,
                    metadata: {
                      size: 1024,
                      totalChunks: 3
                    }
                  }
                }
              }
            case 'knowledge.deleteFile':
              return { deleted: true }
            case 'knowledge.pauseAllRunningTasks':
              return { paused: true }
            case 'knowledge.resumeAllPausedTasks':
              return { resumed: true }
            case 'skillSync.scanExternalTools':
              return {
                results: [
                  {
                    toolId: 'codex',
                    toolName: 'Codex',
                    available: true,
                    skillsDir: '/tools',
                    skills: [
                      {
                        name: 'write-tests',
                        description: 'Write tests',
                        path: '/tools/write-tests.md',
                        format: 'markdown',
                        lastModified: new Date('2024-01-01T00:00:00.000Z')
                      }
                    ]
                  }
                ]
              }
            case 'skillSync.getNewDiscoveries':
              return {
                discoveries: [
                  {
                    toolId: 'codex',
                    toolName: 'Codex',
                    newSkills: [
                      {
                        name: 'write-tests',
                        description: 'Write tests',
                        path: '/tools/write-tests.md',
                        format: 'markdown',
                        lastModified: new Date('2024-01-01T00:00:00.000Z')
                      }
                    ]
                  }
                ]
              }
            case 'skillSync.acknowledgeDiscoveries':
              return { acknowledged: true }
            case 'skills.listCatalog':
              return {
                skills: [
                  {
                    name: 'write-tests',
                    description: 'Write tests',
                    path: '/tools/write-tests/SKILL.md',
                    skillRoot: '/tools/write-tests',
                    canonicalPath: '/tools/write-tests',
                    sourceType: 'created',
                    deepchatDisabled: false,
                    agentLinks: {},
                    mutable: true
                  }
                ]
              }
            case 'skills.setDisabled':
              return { saved: true }
            case 'skills.readFile':
              return { content: '---\nname: write-tests\n---\nUse tests well' }
            case 'skills.scanGitRepo':
              return {
                result: {
                  repoUrl: payload?.repoUrl,
                  repoFormat: 'single-skill',
                  skills: [
                    {
                      name: 'guizang-ppt-skill',
                      description: 'Create PPT files',
                      relativePath: 'SKILL.md',
                      conflict: false,
                      valid: true
                    }
                  ]
                }
              }
            case 'skills.installFromGit':
              return {
                results: [{ success: true, skillName: 'guizang-ppt-skill' }]
              }
            case 'skills.getSyncConfig':
              return {
                config: {
                  skillsDirectory: '/sync',
                  layout: 'multi-skill-repo',
                  lastExportAt: null,
                  lastImportAt: null
                }
              }
            case 'skills.setSyncDirectory':
              return {
                config: {
                  skillsDirectory: payload?.skillsDirectory,
                  layout: 'multi-skill-repo',
                  lastExportAt: null,
                  lastImportAt: null
                }
              }
            case 'skills.previewSyncDirectoryExport':
              return {
                preview: {
                  skillsDirectory: '/sync',
                  items: []
                }
              }
            case 'skills.executeSyncDirectoryExport':
              return {
                result: {
                  success: true,
                  exported: (payload?.skillNames as string[]).length,
                  skipped: 0,
                  failed: []
                }
              }
            case 'skills.previewSyncDirectoryImport':
              return {
                preview: {
                  skillsDirectory: '/sync',
                  items: []
                }
              }
            case 'skills.executeSyncDirectoryImport':
              return {
                result: {
                  success: true,
                  imported: (payload?.skillNames as string[]).length,
                  skipped: 0,
                  failed: []
                }
              }
            case 'skillSync.getRegisteredTools':
              return {
                tools: [
                  {
                    id: 'codex',
                    name: 'Codex',
                    skillsDir: '/tools',
                    filePattern: '*.md',
                    format: 'markdown',
                    capabilities: {
                      hasFrontmatter: true,
                      supportsName: true,
                      supportsDescription: true,
                      supportsTools: true,
                      supportsModel: true,
                      supportsSubfolders: false,
                      supportsReferences: false,
                      supportsScripts: false
                    }
                  }
                ]
              }
            case 'skillSync.scanAgents':
              return {
                agents: [
                  {
                    id: 'codex',
                    name: 'Codex',
                    skillsDir: '/tools',
                    isCustom: false,
                    supportsLinkManagement: true,
                    skillsCount: 1,
                    linkedCount: 0,
                    agentOwnedCount: 1,
                    conflictCount: 0,
                    brokenLinkCount: 0,
                    status: 'ready'
                  }
                ]
              }
            case 'skillSync.getAgentDetail':
              return {
                agent: {
                  id: payload?.agentId ?? 'codex',
                  name: 'Codex',
                  skillsDir: '/tools',
                  isCustom: false,
                  supportsLinkManagement: true,
                  skillsCount: 1,
                  linkedCount: 0,
                  agentOwnedCount: 1,
                  conflictCount: 0,
                  brokenLinkCount: 0,
                  status: 'ready',
                  skills: [
                    {
                      name: 'write-tests',
                      description: 'Write tests',
                      path: '/tools/write-tests',
                      owner: 'agent',
                      status: 'agent-owned',
                      action: 'adopt',
                      deepchat: { exists: false }
                    }
                  ]
                }
              }
            case 'skillSync.getAgentSkillDetail':
              return {
                detail: {
                  name: payload?.skillName ?? 'write-tests',
                  description: 'Write tests',
                  sourcePath: '/tools/write-tests/SKILL.md',
                  markdown: '# Write tests',
                  mutable: true
                }
              }
            case 'skillSync.previewAdoptAgentSkill':
              return {
                preview: {
                  agentId: payload?.agentId,
                  agentName: 'Codex',
                  skillName: payload?.skillName,
                  targetName: payload?.targetName ?? payload?.skillName,
                  sourcePath: '/tools/write-tests',
                  agentPath: '/tools/write-tests',
                  targetPath: '/deepchat/skills/write-tests',
                  backupRoot: '/deepchat/backups/skill-adoptions/codex/write-tests',
                  conflict: false,
                  warnings: []
                }
              }
            case 'skillSync.executeAdoptAgentSkill':
              return {
                result: {
                  success: true,
                  skillName: payload?.targetName ?? payload?.skillName,
                  targetPath: '/deepchat/skills/write-tests',
                  agentPath: '/tools/write-tests',
                  backupPath: '/deepchat/backups/skill-adoptions/codex/write-tests/op'
                }
              }
            case 'skillSync.previewLinkDeepChatSkills':
              return {
                preview: {
                  agentId: payload?.agentId,
                  agentName: 'Codex',
                  skillsDir: '/tools',
                  items: [
                    {
                      skillName: 'write-tests',
                      sourcePath: '/deepchat/skills/write-tests',
                      targetPath: '/tools/write-tests',
                      status: 'ready'
                    }
                  ]
                }
              }
            case 'skillSync.executeLinkDeepChatSkills':
              return {
                result: {
                  success: true,
                  linked: 1,
                  skipped: 0,
                  failed: []
                }
              }
            case 'skillSync.repairAgentSkillLink':
            case 'skillSync.removeAgentSkillLink':
              return {
                result: {
                  success: true,
                  skillName: payload?.skillName,
                  agentPath: '/tools/write-tests',
                  targetPath: '/deepchat/skills/write-tests'
                }
              }
            case 'skillSync.previewImport':
              return {
                previews: [
                  {
                    skill: {
                      name: 'write-tests',
                      description: 'Write tests',
                      instructions: 'Write useful tests'
                    },
                    source: {
                      name: 'write-tests',
                      description: 'Write tests',
                      path: '/tools/write-tests.md',
                      format: 'markdown',
                      lastModified: new Date('2024-01-01T00:00:00.000Z')
                    },
                    warnings: []
                  }
                ]
              }
            case 'skillSync.executeImport':
              return {
                result: {
                  success: true,
                  imported: 1,
                  exported: 0,
                  skipped: 0,
                  failed: []
                }
              }
            case 'skillSync.previewExport':
              return {
                previews: [
                  {
                    skillName: 'write-tests',
                    targetTool: 'codex',
                    targetPath: '/tools/write-tests.md',
                    convertedContent: '# Write tests',
                    warnings: []
                  }
                ]
              }
            case 'skillSync.executeExport':
              return {
                result: {
                  success: true,
                  imported: 0,
                  exported: 1,
                  skipped: 0,
                  failed: []
                }
              }
            case 'nowledgeMem.getConfig':
            case 'nowledgeMem.updateConfig':
              return {
                config: {
                  baseUrl: 'http://127.0.0.1:14242',
                  apiKey: '',
                  timeout: 30000
                }
              }
            case 'nowledgeMem.testConnection':
              return {
                result: {
                  success: true,
                  message: 'Connection successful'
                }
              }
            case 'oauth.githubCopilot.startLogin':
              return { success: true }
            case 'oauth.githubCopilot.startDeviceFlowLogin':
              return { success: false }
            case 'oauth.openaiCodex.getStatus':
              return {
                status: {
                  state: 'signed-out',
                  authenticated: false,
                  storage: 'safeStorage'
                }
              }
            case 'oauth.openaiCodex.startBrowserLogin':
              return {
                status: {
                  state: 'authenticated',
                  authenticated: true,
                  storage: 'safeStorage'
                }
              }
            case 'oauth.openaiCodex.cancelLogin':
            case 'oauth.openaiCodex.logout':
              return {
                status: {
                  state: 'signed-out',
                  authenticated: false,
                  storage: 'safeStorage'
                }
              }
            case 'mcp.router.listServers':
              return {
                servers: [
                  {
                    uuid: 'router-item-1',
                    created_at: '2026-06-11T00:00:00.000Z',
                    updated_at: '2026-06-11T00:00:00.000Z',
                    name: 'context7',
                    author_name: 'upstash',
                    title: 'Context7',
                    description: 'Fetch current docs',
                    content: 'Documentation helper',
                    server_key: 'context7',
                    config_name: 'Context7',
                    server_url: 'https://mcp.context7.com/mcp'
                  }
                ]
              }
            case 'mcp.router.installServer':
              return { installed: true }
            case 'mcp.router.getApiKey':
              return { key: 'router-key' }
            case 'mcp.router.setApiKey':
              return { saved: true }
            case 'mcp.router.isServerInstalled':
              return { installed: false }
            case 'mcp.router.updateServersAuth':
              return { updated: true }
            case 'remoteControl.listChannels':
              return {
                channels: [
                  {
                    id: 'telegram',
                    type: 'builtin',
                    implemented: true,
                    titleKey: 'settings.remote.telegram.title',
                    descriptionKey: 'settings.remote.telegram.description',
                    supportsPairing: true,
                    supportsNotifications: false
                  }
                ]
              }
            case 'remoteControl.getChannelSettings':
            case 'remoteControl.saveChannelSettings':
              return {
                settings: payload?.settings ?? {
                  botToken: 'telegram-token',
                  remoteEnabled: true,
                  defaultAgentId: 'deepchat',
                  defaultWorkdir: ''
                }
              }
            case 'remoteControl.getChannelStatus':
            case 'remoteControl.getTelegramStatus':
              return {
                status: {
                  channel: 'telegram',
                  enabled: true,
                  state: 'running',
                  pollOffset: 1,
                  bindingCount: 0,
                  allowedUserCount: 1,
                  lastError: null,
                  botUser: null
                }
              }
            case 'remoteControl.getWeixinIlinkStatus':
              return {
                status: {
                  channel: 'weixin-ilink',
                  enabled: false,
                  state: 'disabled',
                  bindingCount: 0,
                  accountCount: 0,
                  connectedAccountCount: 0,
                  lastError: null,
                  accounts: []
                }
              }
            case 'remoteControl.getChannelBindings':
              return { bindings: [] }
            case 'remoteControl.removeChannelBinding':
            case 'remoteControl.removeChannelPrincipal':
            case 'remoteControl.removeWeixinIlinkAccount':
              return { removed: true }
            case 'remoteControl.getChannelPairingSnapshot':
              return {
                snapshot: {
                  pairCode: null,
                  pairCodeExpiresAt: null,
                  allowedUserIds: [123]
                }
              }
            case 'remoteControl.createChannelPairCode':
              return {
                code: '654321',
                expiresAt: 123456
              }
            case 'remoteControl.clearChannelPairCode':
              return { cleared: true }
            case 'remoteControl.startWeixinIlinkLogin':
              return {
                session: {
                  sessionKey: 'weixin-session',
                  loginUrl: null,
                  messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
                }
              }
            case 'remoteControl.waitForWeixinIlinkLogin':
              return {
                result: {
                  connected: true,
                  account: null,
                  messageKey: 'settings.remote.weixinIlink.loginConnected'
                }
              }
            case 'remoteControl.restartWeixinIlinkAccount':
              return { restarted: true }
            case 'providers.list':
            case 'providers.listSummaries':
              return { providers: [] }
            case 'providers.getRateLimitStatus':
              return {
                status: {
                  config: { enabled: false, qpsLimit: 1 },
                  currentQps: 0,
                  queueLength: 0,
                  lastRequestTime: 0
                }
              }
            case 'providers.getKeyStatus':
              return {
                status: {
                  remainNum: 42,
                  limit_remaining: '42',
                  usage: '8'
                }
              }
            case 'providers.updateRateLimit':
              return {
                config: {
                  enabled: payload?.enabled,
                  qpsLimit: payload?.qpsLimit
                }
              }
            case 'providers.getEmbeddingDimensions':
              return {
                result: {
                  data: {
                    dimensions: 1536,
                    normalized: true
                  }
                }
              }
            case 'providers.syncModelScopeMcpServers':
              return {
                result: {
                  success: true,
                  message: 'ok',
                  synced: 1,
                  imported: 1,
                  skipped: 0,
                  errors: []
                }
              }
            case 'providers.runAcpDebugAction':
              return {
                result: {
                  status: 'ok',
                  sessionId: 'debug-session',
                  events: []
                }
              }
            case 'providers.refreshModels':
              return { success: true }
            case 'providers.import.apply':
              return {
                summary: {
                  imported: 0,
                  created: 0,
                  updated: 0,
                  skipped: 0,
                  overwritten: 0,
                  models: 0
                },
                results: []
              }
            case 'models.getConfig':
              return {
                config: {
                  maxTokens: 4096,
                  contextLength: 128000,
                  temperature: 1,
                  vision: true,
                  functionCall: true,
                  reasoning: false,
                  type: 'chat'
                }
              }
            case 'models.setConfig':
              return { config: payload?.config ?? {} }
            case 'models.getCapabilities':
              return {
                capabilities: {
                  supportsReasoning: true,
                  reasoningPortrait: null,
                  thinkingBudgetRange: null,
                  supportsSearch: null,
                  searchDefaults: null,
                  supportsTemperatureControl: true,
                  temperatureCapability: true
                }
              }
            case 'browser.updateCurrentWindowBounds':
              return { updated: true }
            case 'browser.clearSandboxData':
              return { cleared: true }
            case 'window.closeSettings':
              return { closed: true }
            case 'window.focusMain':
              return { focused: true }
            case 'window.notifySettingsReady':
              return { notified: true }
            case 'window.consumePendingSettingsProviderInstall':
              return {
                preview: {
                  kind: 'builtin',
                  id: 'deepseek',
                  baseUrl: 'https://api.deepseek.com',
                  apiKey: 'sk-secret',
                  maskedApiKey: 'sk-s...cret',
                  iconModelId: 'deepseek-chat',
                  willOverwrite: true
                }
              }
            case 'window.requeuePendingSettingsProviderInstall':
              return { queued: true }
            case 'window.startGuidedOnboarding':
              return { started: true, focused: true }
            case 'device.selectFiles':
              return { canceled: false, filePaths: ['/workspace/skill.zip'] }
            case 'device.resetDataByType':
              return { reset: true }
            case 'project.listRecent':
              return { projects: [] }
            case 'project.listEnvironments':
              return { environments: [] }
            case 'project.reorderEnvironments':
            case 'project.archiveEnvironment':
            case 'project.restoreEnvironment':
              return { updated: true }
            case 'project.removeEnvironment':
              return { clearedSessionIds: [] }
            case 'project.pathExists':
              return { exists: true }
            case 'project.selectDirectory':
              return { path: '/workspace' }
            case 'tools.listDefinitions':
              return { tools: [] }
            case 'memory.add':
              addedMemoryCategory = payload?.category ?? null
              return { result: { action: 'created', memoryId: 'mem-added' } }
            case 'memory.getHealth':
              return {
                health: {
                  totalRows: 1,
                  byKind: { episodic: 0, semantic: 1, reflection: 0, persona: 0, working: 0 },
                  byCategory: {
                    user_preference: 0,
                    project_fact: 1,
                    task_outcome: 0,
                    heuristic: 0,
                    anti_pattern: 0,
                    uncategorized: 0
                  },
                  byStatus: {
                    pending_embedding: 0,
                    embedded: 1,
                    error: 0,
                    fts_only: 0,
                    archived: 0,
                    conflicted: 0
                  },
                  embeddings: { pending: 0, error: 0, ftsOnly: 0, stale: 0 },
                  lifecycle: { archiveCandidates: 0, archived: 0 },
                  conflicts: { conflicted: 0, challenged: 0 },
                  access: { topAccessed: [], neverAccessed: 1 },
                  quality: { importanceAvg: 0.6, importanceMedian: 0.6, confidenceAvg: null },
                  maintenance: {
                    completed: 0,
                    skipped: 0,
                    failed: 0,
                    scanLimit: 200,
                    recentFailures: []
                  }
                }
              }
            case 'memory.getLifecycle':
              return {
                lifecycles: [
                  {
                    memoryId: payload?.memoryId ?? 'mem-1',
                    kind: 'semantic',
                    status: 'embedded',
                    recallable: true,
                    decayTier: 'fresh',
                    recall: {
                      weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
                      similarity: 0.3,
                      similaritySource: 'baseline',
                      recency: 1,
                      importance: 0.5,
                      confidenceFactor: 1,
                      importanceFloor: 0.075,
                      final: 0.48,
                      flooredByImportance: false,
                      halfLifeMs: 14 * 24 * 60 * 60 * 1000
                    },
                    forget: {
                      anchorAt: 1000,
                      ageDays: 0,
                      halfLifeDays: 30,
                      decayScore: 1,
                      materializedDecay: null,
                      materializedStale: true
                    },
                    archiveEligibility: {
                      eligible: false,
                      oldEnough: false,
                      decayedEnough: false,
                      neverAccessed: true,
                      active: true,
                      exempt: false,
                      exemptReasons: [],
                      gaps: {}
                    }
                  }
                ]
              }
            case 'memory.getArchiveCandidateLifecyclePreview':
              return {
                preview: {
                  lifecycles: [
                    {
                      memoryId: 'mem-1',
                      kind: 'semantic',
                      status: 'embedded',
                      recallable: true,
                      decayTier: 'fresh',
                      recall: {
                        weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
                        similarity: 0.3,
                        similaritySource: 'baseline',
                        recency: 1,
                        importance: 0.5,
                        confidenceFactor: 1,
                        importanceFloor: 0.075,
                        final: 0.48,
                        flooredByImportance: false,
                        halfLifeMs: 14 * 24 * 60 * 60 * 1000
                      },
                      forget: {
                        anchorAt: 1000,
                        ageDays: 0,
                        halfLifeDays: 30,
                        decayScore: 1,
                        materializedDecay: null,
                        materializedStale: true
                      },
                      archiveEligibility: {
                        eligible: false,
                        oldEnough: false,
                        decayedEnough: false,
                        neverAccessed: true,
                        active: true,
                        exempt: false,
                        exemptReasons: [],
                        gaps: {}
                      }
                    }
                  ],
                  previewLimit: 25,
                  scanLimit: 200,
                  scanned: 1,
                  previewTruncated: false,
                  scanTruncated: false
                }
              }
            case 'memory.list':
              return {
                memories: [
                  {
                    id: 'mem-added',
                    agentId: payload?.agentId ?? 'agent-1',
                    kind: 'semantic',
                    category: typeof addedMemoryCategory === 'string' ? addedMemoryCategory : null,
                    content: 'repo uses pnpm',
                    importance: 0.6,
                    status: 'embedded',
                    sourceSession: null,
                    sourceEntryIds: null,
                    supersededBy: null,
                    createdAt: 1000
                  }
                ]
              }
            default:
              return {}
          }
        }),
      on: vi.fn(() => vi.fn())
    }
  }

  it('routes ACP terminal commands and events through the shared registry names', async () => {
    const bridge = createBridge()
    const client = createAcpTerminalClient(bridge)
    const listener = vi.fn()

    await client.sendInput('hello\n')
    await client.kill()
    client.onStarted(listener)
    client.onOutput(listener)
    client.onExited(listener)
    client.onError(listener)
    client.onExternalDependenciesRequired(listener)

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'acpTerminal.input', { data: 'hello\n' })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'acpTerminal.kill', {})
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'acpTerminal.started', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'acpTerminal.output', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'acpTerminal.exited', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(4, 'acpTerminal.error', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(
      5,
      'acpTerminal.externalDependenciesRequired',
      listener
    )
  })

  it('routes context menu events through the shared registry names', () => {
    const bridge = createBridge()
    const client = createContextMenuClient(bridge)
    const listener = vi.fn()

    client.onTranslateRequested(listener)
    client.onAskAiRequested(listener)

    expect(bridge.on).toHaveBeenNthCalledWith(1, 'contextMenu.translateRequested', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'contextMenu.askAiRequested', listener)
  })

  it('routes app runtime events through the shared registry names', () => {
    const bridge = createBridge()
    const client = createAppRuntimeClient(bridge)
    const listener = vi.fn()

    client.onStartDeeplink(listener)
    client.onMcpInstallRequested(listener)
    client.onGuidedOnboardingStartRequested(listener)
    client.onWindowFocused(listener)
    client.onWindowBlurred(listener)
    client.onShortcutRequested(listener)
    client.onDataResetCompleteDev(listener)
    client.onSystemNotificationClicked(listener)

    expect(bridge.on).toHaveBeenNthCalledWith(1, 'appRuntime.startDeeplinkRequested', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'appRuntime.mcpInstallRequested', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(
      3,
      'appRuntime.guidedOnboardingStartRequested',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(4, 'appRuntime.windowFocused', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(5, 'appRuntime.windowBlurred', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(6, 'appRuntime.shortcutRequested', listener)
    expect(bridge.on).toHaveBeenNthCalledWith(
      7,
      'appRuntime.dataResetCompleteDev',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(8, 'appRuntime.systemNotificationClicked', listener)
  })

  it('routes shortcut runtime commands through the shared registry names', async () => {
    const bridge = createBridge()
    const client = createShortcutClient(bridge)

    await client.registerShortcuts()
    await client.unregisterShortcuts()
    await client.destroy()

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'shortcut.register', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'shortcut.unregister', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'shortcut.destroy', {})
  })

  it('routes settings calls through the shared registry names', async () => {
    const bridge = createBridge()
    const client = createSettingsClient(bridge)

    await client.getSnapshot(['fontSizeLevel'])
    await client.getSystemFonts()
    await client.update([{ key: 'fontSizeLevel', value: 3 }])
    await client.openSettings({ routeName: 'settings-display', section: 'fonts' })
    client.onChanged(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'settings.getSnapshot', {
      keys: ['fontSizeLevel']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'settings.listSystemFonts', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'settings.update', {
      changes: [{ key: 'fontSizeLevel', value: 3 }]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'system.openSettings', {
      routeName: 'settings-display',
      section: 'fonts'
    })
    expect(bridge.on).toHaveBeenCalledWith('settings.changed', expect.any(Function))
  })

  it('routes sessions.steerPendingInput through the registry name', async () => {
    const bridge = createBridge()
    const sessionClient = createSessionClient(bridge)

    await sessionClient.steerPendingInput('session-1', 'item-1')

    expect(bridge.invoke).toHaveBeenCalledWith('sessions.steerPendingInput', {
      sessionId: 'session-1',
      itemId: 'item-1'
    })
  })

  it('routes session and chat calls through the shared registry names', async () => {
    const bridge = createBridge()
    const sessionClient = createSessionClient(bridge)
    const chatClient = createChatClient(bridge)
    const providerClient = createProviderClient(bridge)

    await sessionClient.create({
      agentId: 'deepchat',
      message: 'hello'
    })
    await sessionClient.restore('session-1', 100)
    await sessionClient.listMessagesPage('session-1', {
      cursor: { orderSeq: 10, id: 'message-10' },
      limit: 50
    })
    await sessionClient.list({ includeSubagents: true })
    await sessionClient.activate('session-1')
    await sessionClient.deactivate()
    await sessionClient.getActive()
    sessionClient.onUpdated(vi.fn())
    sessionClient.onCompactionChanged(vi.fn())
    sessionClient.onAcpModesReady(vi.fn())
    sessionClient.onAcpCommandsReady(vi.fn())
    sessionClient.onAcpConfigOptionsReady(vi.fn())
    await chatClient.sendMessage('session-1', 'follow up')
    await chatClient.steerActiveTurn('session-1', 'refine active answer')
    await chatClient.stopStream({ requestId: 'message-1' })
    await chatClient.respondToolInteraction({
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })
    await providerClient.listModels('openai')
    await providerClient.testConnection({
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    chatClient.onStreamUpdated(vi.fn())
    chatClient.onStreamCompleted(vi.fn())
    chatClient.onStreamFailed(vi.fn())
    chatClient.onPlanUpdated(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'sessions.create', {
      agentId: 'deepchat',
      message: 'hello'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'sessions.restore', {
      sessionId: 'session-1',
      limit: 100
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'sessions.listMessagesPage', {
      sessionId: 'session-1',
      cursor: { orderSeq: 10, id: 'message-10' },
      limit: 50
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'sessions.list', {
      includeSubagents: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'sessions.activate', {
      sessionId: 'session-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'sessions.deactivate', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'sessions.getActive', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'chat.sendMessage', {
      sessionId: 'session-1',
      content: 'follow up'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'chat.steerActiveTurn', {
      sessionId: 'session-1',
      content: 'refine active answer'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'chat.stopStream', {
      requestId: 'message-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'chat.respondToolInteraction', {
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'providers.listModels', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'providers.testConnection', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'sessions.updated', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(
      2,
      'sessions.compaction.changed',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'sessions.acp.modes.ready', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(
      4,
      'sessions.acp.commands.ready',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(
      5,
      'sessions.acp.configOptions.ready',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(6, 'chat.stream.updated', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(7, 'chat.stream.completed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(8, 'chat.stream.failed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(9, 'chat.plan.updated', expect.any(Function))
  })

  it('routes memory client calls through the shared registry names', async () => {
    const bridge = createBridge()
    const memoryClient = createMemoryClient(bridge)

    await memoryClient.list('agent-1')
    await memoryClient.getStatus('agent-1')
    await memoryClient.remove('agent-1', 'mem-1')
    await memoryClient.clear('agent-1')
    await memoryClient.restore('agent-1', 'mem-1')
    await memoryClient.listPersonaVersions('agent-1')
    await memoryClient.rollbackPersona('agent-1', 'ver-1')
    await memoryClient.listPersonaDrafts('agent-1')
    await memoryClient.approvePersonaDraft('agent-1', 'draft-1')
    await memoryClient.rejectPersonaDraft('agent-1', 'draft-1')
    await memoryClient.setPersonaAnchor('agent-1', 'ver-1', true)
    await memoryClient.add('agent-1', {
      content: 'repo uses pnpm',
      category: 'project_fact'
    })
    const categorizedMemories = await memoryClient.list('agent-1')
    await memoryClient.add('agent-1', { content: 'plain note' })
    const health = await memoryClient.getHealth('agent-1')
    const lifecycles = await memoryClient.getLifecycle('agent-1', 'mem-1')
    const archiveCandidatePreview =
      await memoryClient.getArchiveCandidateLifecyclePreview('agent-1')
    const off = memoryClient.onUpdated(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'memory.list', { agentId: 'agent-1' })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'memory.getStatus', { agentId: 'agent-1' })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'memory.delete', {
      agentId: 'agent-1',
      memoryId: 'mem-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'memory.clear', { agentId: 'agent-1' })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'memory.restore', {
      agentId: 'agent-1',
      memoryId: 'mem-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'memory.listPersonaVersions', {
      agentId: 'agent-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'memory.rollbackPersona', {
      agentId: 'agent-1',
      versionId: 'ver-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'memory.listPersonaDrafts', {
      agentId: 'agent-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'memory.approvePersonaDraft', {
      agentId: 'agent-1',
      draftId: 'draft-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'memory.rejectPersonaDraft', {
      agentId: 'agent-1',
      draftId: 'draft-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'memory.setPersonaAnchor', {
      agentId: 'agent-1',
      versionId: 'ver-1',
      anchored: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'memory.add', {
      agentId: 'agent-1',
      content: 'repo uses pnpm',
      category: 'project_fact',
      importance: undefined
    })
    expect(bridge.invoke.mock.calls[11][1]).not.toHaveProperty('kind')
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'memory.list', { agentId: 'agent-1' })
    expect(categorizedMemories[0].category).toBe('project_fact')
    expect(bridge.invoke).toHaveBeenNthCalledWith(14, 'memory.add', {
      agentId: 'agent-1',
      content: 'plain note',
      importance: undefined
    })
    expect(bridge.invoke.mock.calls[13][1]).not.toHaveProperty('category')
    expect(bridge.invoke).toHaveBeenNthCalledWith(15, 'memory.getHealth', { agentId: 'agent-1' })
    expect(health.totalRows).toBe(1)
    expect(bridge.invoke).toHaveBeenNthCalledWith(16, 'memory.getLifecycle', {
      agentId: 'agent-1',
      memoryId: 'mem-1'
    })
    expect(lifecycles[0].memoryId).toBe('mem-1')
    expect(bridge.invoke).toHaveBeenNthCalledWith(
      17,
      'memory.getArchiveCandidateLifecyclePreview',
      {
        agentId: 'agent-1'
      }
    )
    expect(archiveCandidatePreview.lifecycles[0].memoryId).toBe('mem-1')
    expect(bridge.on).toHaveBeenCalledWith('memory.updated', expect.any(Function))
    expect(typeof off).toBe('function')
  })

  it('routes agent dashboard calls through the shared registry names', async () => {
    const bridge = createBridge()
    const sessionClient = createSessionClient(bridge)

    await sessionClient.getAgents()
    await sessionClient.getUsageDashboard()
    await sessionClient.retryRtkHealthCheck()

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'sessions.getAgents', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'sessions.getUsageDashboard', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'sessions.retryRtkHealthCheck', {})
  })

  it('routes phase2 config, provider, and model calls through the shared registry names', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)
    const providerClient = createProviderClient(bridge)
    const modelClient = createModelClient(bridge)
    const knowledgeConfig = {
      id: 'knowledge-1',
      description: 'Local docs',
      embedding: new Proxy(
        {
          providerId: 'openai',
          modelId: 'text-embedding-3-small'
        },
        {}
      ),
      dimensions: 1536,
      normalized: true,
      fragmentsNumber: 6,
      enabled: true
    }

    await configClient.getSetting('input_chatMode')
    await configClient.setSetting('preferredModel', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    await configClient.getSetting('assistantModel')
    await configClient.setSetting('assistantModel', {
      providerId: 'openai',
      modelId: 'gpt-5.4-mini'
    })
    await configClient.getSetting('maxFileSize')
    await configClient.setSetting('maxFileSize', 30 * 1024 * 1024)
    await configClient.getSystemPrompts()
    await configClient.getDefaultProjectPath()
    await configClient.getKnowledgeConfigs()
    await configClient.setKnowledgeConfigs([knowledgeConfig])
    configClient.onLanguageChanged(vi.fn())
    configClient.onCustomPromptsChanged(vi.fn())

    await providerClient.getProviderSummaries()
    await providerClient.getProviderRateLimitStatus('openai')
    await providerClient.getKeyStatus('openai')
    await providerClient.updateProviderRateLimit('openai', true, 2)
    await providerClient.refreshModels('openai')
    providerClient.onProvidersChanged(vi.fn())
    providerClient.onRateLimitEvent(vi.fn())

    await modelClient.getModelConfig('gpt-5.4', 'openai')
    await modelClient.setModelConfig('gpt-5.4', 'openai', {
      maxTokens: 4096,
      contextLength: 128000,
      temperature: 1,
      vision: true,
      functionCall: true,
      reasoning: false,
      type: 'chat'
    })
    await modelClient.getCapabilities('openai', 'gpt-5.4')
    modelClient.onModelsChanged(vi.fn())
    modelClient.onModelStatusChanged(vi.fn())
    modelClient.onModelConfigChanged(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'config.getEntries', {
      keys: ['input_chatMode']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'config.updateEntries', {
      changes: [
        {
          key: 'preferredModel',
          value: {
            providerId: 'openai',
            modelId: 'gpt-5.4'
          }
        }
      ]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'config.getEntries', {
      keys: ['assistantModel']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'config.updateEntries', {
      changes: [
        {
          key: 'assistantModel',
          value: {
            providerId: 'openai',
            modelId: 'gpt-5.4-mini'
          }
        }
      ]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'config.getEntries', {
      keys: ['maxFileSize']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'config.updateEntries', {
      changes: [
        {
          key: 'maxFileSize',
          value: 30 * 1024 * 1024
        }
      ]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'config.getSystemPrompts', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'config.getDefaultProjectPath', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'config.getKnowledgeConfigs', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'config.setKnowledgeConfigs', {
      configs: [
        {
          id: 'knowledge-1',
          description: 'Local docs',
          embedding: {
            providerId: 'openai',
            modelId: 'text-embedding-3-small'
          },
          dimensions: 1536,
          normalized: true,
          fragmentsNumber: 6,
          enabled: true
        }
      ]
    })
    expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls[9][1].configs[0]).not.toBe(
      knowledgeConfig
    )
    expect(
      (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls[9][1].configs[0].embedding
    ).not.toBe(knowledgeConfig.embedding)
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'providers.listSummaries', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'providers.getRateLimitStatus', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'providers.getKeyStatus', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(14, 'providers.updateRateLimit', {
      providerId: 'openai',
      enabled: true,
      qpsLimit: 2
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(15, 'providers.refreshModels', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(16, 'models.getConfig', {
      modelId: 'gpt-5.4',
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(17, 'models.setConfig', {
      modelId: 'gpt-5.4',
      providerId: 'openai',
      config: {
        maxTokens: 4096,
        contextLength: 128000,
        temperature: 1,
        vision: true,
        functionCall: true,
        reasoning: false,
        type: 'chat'
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(18, 'models.getCapabilities', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'config.language.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(
      2,
      'config.customPrompts.changed',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'providers.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(
      4,
      'providers.rateLimit.configUpdated',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(
      5,
      'providers.rateLimit.requestQueued',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(
      6,
      'providers.rateLimit.requestExecuted',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(7, 'models.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(8, 'models.status.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(9, 'models.config.changed', expect.any(Function))
  })

  it('routes config proxy, logging, update channel, skill draft, provider DB, and hooks calls', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)

    await configClient.getProxySettings()
    await configClient.getProxyMode()
    await configClient.setProxyMode('custom')
    await configClient.getCustomProxyUrl()
    await configClient.setCustomProxyUrl('http://127.0.0.1:7890')
    await configClient.openLoggingFolder()
    await configClient.getUpdateChannel()
    await configClient.setUpdateChannel('beta')
    await configClient.getSkillDraftSuggestionsEnabled()
    await configClient.setSkillDraftSuggestionsEnabled(true)
    await configClient.refreshProviderDb(true)
    await configClient.getHooksNotificationsConfig()
    const hooksConfig = reactive<HooksNotificationsSettings>({
      hooks: [
        {
          id: 'hook-1',
          name: 'Hook 1',
          enabled: true,
          command: 'echo test',
          events: ['SessionStart']
        }
      ]
    })
    await configClient.setHooksNotificationsConfig(hooksConfig)
    await configClient.testHookCommand('hook-1')

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'config.getProxySettings', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'config.getProxySettings', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'config.setProxyMode', {
      mode: 'custom'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'config.getProxySettings', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'config.setCustomProxyUrl', {
      url: 'http://127.0.0.1:7890'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'config.openLoggingFolder', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'config.getUpdateChannel', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'config.setUpdateChannel', {
      channel: 'beta'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'config.getSkillDraftSuggestions', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'config.setSkillDraftSuggestions', {
      enabled: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'config.refreshProviderDb', {
      force: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'config.getHooksNotifications', {})
    const hooksPayload = vi.mocked(bridge.invoke).mock.calls[12]?.[1] as {
      config: HooksNotificationsSettings
    }
    expect(isReactive(hooksPayload.config)).toBe(false)
    expect(isReactive(hooksPayload.config.hooks)).toBe(false)
    expect(isReactive(hooksPayload.config.hooks[0])).toBe(false)
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'config.setHooksNotifications', {
      config: {
        hooks: [
          {
            id: 'hook-1',
            name: 'Hook 1',
            enabled: true,
            command: 'echo test',
            events: ['SessionStart']
          }
        ]
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(14, 'config.testHookCommand', {
      hookId: 'hook-1'
    })
  })

  it('routes DeepChat agent config calls through the shared registry names', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)

    await configClient.listAgents({ agentType: 'deepchat' })
    await configClient.createDeepChatAgent({
      name: 'Writer',
      enabled: true,
      config: {
        systemPrompt: 'Write clearly',
        permissionMode: 'default'
      }
    })
    await configClient.updateDeepChatAgent('writer', {
      name: 'Writer Pro',
      enabled: false
    })
    await configClient.deleteDeepChatAgent('writer')

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'config.listAgents', {
      agentType: 'deepchat'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'config.createDeepChatAgent', {
      name: 'Writer',
      enabled: true,
      config: {
        systemPrompt: 'Write clearly',
        permissionMode: 'default'
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'config.updateDeepChatAgent', {
      agentId: 'writer',
      updates: {
        name: 'Writer Pro',
        enabled: false
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'config.deleteDeepChatAgent', {
      agentId: 'writer'
    })
  })

  it('serializes settings save payloads before invoking the config bridge', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)
    const shortcutKeys = new Proxy(
      {
        toggleWindow: 'CommandOrControl+K'
      },
      {}
    )
    const promptParameters = new Proxy(
      [
        {
          name: 'topic',
          description: 'Topic',
          required: true
        }
      ],
      {}
    )
    const customPrompt = new Proxy(
      {
        id: 'prompt-1',
        name: 'Writer',
        description: 'Write clearly',
        content: 'Write about {{topic}}',
        parameters: promptParameters,
        enabled: true
      },
      {}
    )
    const customPromptUpdate = new Proxy(
      {
        description: 'Updated',
        parameters: promptParameters
      },
      {}
    )
    const systemPrompt = new Proxy(
      {
        id: 'system-1',
        name: 'System',
        content: 'Be concise'
      },
      {}
    )
    const modelSelection = new Proxy(
      {
        providerId: 'openai',
        modelId: 'gpt-4.1'
      },
      {}
    )
    const deepChatAgentInput = new Proxy(
      {
        name: 'Writer Agent',
        enabled: true,
        config: new Proxy(
          {
            assistantModel: modelSelection
          },
          {}
        )
      },
      {}
    )

    await configClient.setShortcutKey(shortcutKeys)
    await configClient.addCustomPrompt(customPrompt)
    await configClient.updateCustomPrompt('prompt-1', customPromptUpdate)
    await configClient.setCustomPrompts(new Proxy([customPrompt], {}))
    await configClient.addSystemPrompt(systemPrompt)
    await configClient.updateSystemPrompt('system-1', new Proxy({ content: 'Updated' }, {}))
    await configClient.setSystemPrompts(new Proxy([systemPrompt], {}))
    await configClient.createDeepChatAgent(deepChatAgentInput)
    await configClient.updateDeepChatAgent(
      'writer',
      new Proxy(
        {
          config: new Proxy(
            {
              visionModel: modelSelection
            },
            {}
          )
        },
        {}
      )
    )

    const calls = (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls
    for (const [, payload] of calls) {
      expect(() => structuredClone(payload)).not.toThrow()
    }

    expect(calls[0]).toEqual([
      'config.setShortcutKeys',
      {
        shortcuts: {
          toggleWindow: 'CommandOrControl+K'
        }
      }
    ])
    expect(calls[1][1].prompt).toEqual({
      id: 'prompt-1',
      name: 'Writer',
      description: 'Write clearly',
      content: 'Write about {{topic}}',
      parameters: [
        {
          name: 'topic',
          description: 'Topic',
          required: true
        }
      ],
      enabled: true
    })
    expect(calls[1][1].prompt).not.toBe(customPrompt)
    expect(calls[1][1].prompt.parameters).not.toBe(promptParameters)
    expect(calls[7][1]).toEqual({
      name: 'Writer Agent',
      enabled: true,
      config: {
        assistantModel: {
          providerId: 'openai',
          modelId: 'gpt-4.1'
        }
      }
    })
    expect(calls[8][1]).toEqual({
      agentId: 'writer',
      updates: {
        config: {
          visionModel: {
            providerId: 'openai',
            modelId: 'gpt-4.1'
          }
        }
      }
    })
  })

  it('routes ACP config calls through the shared registry names', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)

    await configClient.setAcpEnabled(true)
    await configClient.listAcpRegistryAgents()
    await configClient.refreshAcpRegistry(true)
    await configClient.setAcpAgentEnabled('codex-acp', true)
    await configClient.setAcpAgentEnvOverride('codex-acp', { KEY: 'value' })
    await configClient.ensureAcpAgentInstalled('codex-acp')
    await configClient.repairAcpAgent('codex-acp')
    await configClient.uninstallAcpRegistryAgent('codex-acp')
    await configClient.listManualAcpAgents()
    await configClient.addManualAcpAgent({
      name: 'Manual ACP',
      command: 'node',
      enabled: true
    })
    await configClient.updateManualAcpAgent('manual-acp', { enabled: false })
    await configClient.removeManualAcpAgent('manual-acp')

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'config.setAcpEnabled', {
      enabled: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'config.listAcpRegistryAgents', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'config.refreshAcpRegistry', {
      force: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'config.setAcpAgentEnabled', {
      agentId: 'codex-acp',
      enabled: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'config.setAcpAgentEnvOverride', {
      agentId: 'codex-acp',
      env: { KEY: 'value' }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'config.ensureAcpAgentInstalled', {
      agentId: 'codex-acp'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'config.repairAcpAgent', {
      agentId: 'codex-acp'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'config.uninstallAcpRegistryAgent', {
      agentId: 'codex-acp'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'config.listManualAcpAgents', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'config.addManualAcpAgent', {
      name: 'Manual ACP',
      command: 'node',
      enabled: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'config.updateManualAcpAgent', {
      agentId: 'manual-acp',
      updates: { enabled: false }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'config.removeManualAcpAgent', {
      agentId: 'manual-acp'
    })
  })

  it('serializes browser bounds updates before invoking the bridge', async () => {
    const bridge = createBridge()
    const browserClient = createBrowserClient(bridge)
    const reactiveBounds = new Proxy(
      {
        x: 12,
        y: 34,
        width: 320,
        height: 180
      },
      {}
    )

    await browserClient.updateCurrentWindowBounds('session-1', reactiveBounds, false)

    expect(bridge.invoke).toHaveBeenCalledWith('browser.updateCurrentWindowBounds', {
      sessionId: 'session-1',
      bounds: {
        x: 12,
        y: 34,
        width: 320,
        height: 180
      },
      visible: false
    })
    expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls[0][1].bounds).not.toBe(
      reactiveBounds
    )
  })

  it('routes browser sandbox clearing through the shared registry name', async () => {
    const bridge = createBridge()
    const browserClient = createBrowserClient(bridge)

    await expect(browserClient.clearSandboxData()).resolves.toBe(true)

    expect(bridge.invoke).toHaveBeenCalledWith('browser.clearSandboxData', {})
  })

  it('routes database security operations through the shared registry names', async () => {
    const bridge = createBridge()
    const databaseSecurityClient = createDatabaseSecurityClient(bridge)

    await databaseSecurityClient.getStatus()
    await databaseSecurityClient.enable('new-password')
    await databaseSecurityClient.changePassword('old-password', 'new-password')
    await databaseSecurityClient.disable('old-password')
    const repairReport = await databaseSecurityClient.repairSchema()

    expect(repairReport.status).toBe('healthy')
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'databaseSecurity.getStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'databaseSecurity.enable', {
      password: 'new-password'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'databaseSecurity.changePassword', {
      currentPassword: 'old-password',
      newPassword: 'new-password'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'databaseSecurity.disable', {
      currentPassword: 'old-password'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'databaseSecurity.repairSchema', {})
  })

  it('routes settings window calls through the shared registry names', async () => {
    const bridge = createBridge()
    const windowClient = createWindowClient(bridge)

    await windowClient.closeSettings()
    await windowClient.focusMainWindow()
    await windowClient.notifySettingsReady()
    const preview = await windowClient.consumePendingSettingsProviderInstall()
    expect(preview).not.toBeNull()
    if (!preview) {
      throw new Error('Expected pending provider install preview')
    }
    await windowClient.requeuePendingSettingsProviderInstall(preview)
    await windowClient.startGuidedOnboarding()

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'window.closeSettings', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'window.focusMain', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'window.notifySettingsReady', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(
      4,
      'window.consumePendingSettingsProviderInstall',
      {}
    )
    expect(bridge.invoke).toHaveBeenNthCalledWith(
      5,
      'window.requeuePendingSettingsProviderInstall',
      {
        preview
      }
    )
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'window.startGuidedOnboarding', {})
  })

  it('routes provider runtime utility calls through the shared registry names', async () => {
    const bridge = createBridge()
    const providerClient = createProviderClient(bridge)

    await providerClient.getEmbeddingDimensions('openai', 'text-embedding-3-small')
    await providerClient.syncModelScopeMcpServers('modelscope', {
      page_number: 1,
      page_size: 50
    })
    await providerClient.runAcpDebugAction({
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {},
      webContentsId: 999
    })
    providerClient.onAcpDebugEvent(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'providers.getEmbeddingDimensions', {
      providerId: 'openai',
      modelId: 'text-embedding-3-small'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'providers.syncModelScopeMcpServers', {
      providerId: 'modelscope',
      syncOptions: {
        page_number: 1,
        page_size: 50
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'providers.runAcpDebugAction', {
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {},
      sessionId: undefined,
      workdir: undefined,
      methodName: undefined
    })
    expect(bridge.on).toHaveBeenCalledWith('providers.acp.debug.event', expect.any(Function))
  })

  it('routes knowledge calls and events through the shared registry names', async () => {
    const bridge = createBridge()
    const knowledgeClient = createKnowledgeClient(bridge)

    await knowledgeClient.isSupported()
    await knowledgeClient.getSupportedLanguages()
    await knowledgeClient.getSeparatorsForLanguage('markdown')
    await knowledgeClient.getSupportedFileExtensions()
    await knowledgeClient.listFiles('knowledge-1')
    await knowledgeClient.similarityQuery('knowledge-1', 'hello')
    await knowledgeClient.validateFile('/workspace/guide.md')
    await knowledgeClient.addFile('knowledge-1', '/workspace/guide.md')
    await knowledgeClient.deleteFile('knowledge-1', 'file-1')
    await knowledgeClient.reAddFile('knowledge-1', 'file-1')
    await knowledgeClient.pauseAllRunningTasks('knowledge-1')
    await knowledgeClient.resumeAllPausedTasks('knowledge-1')
    knowledgeClient.onFileUpdated(vi.fn())
    knowledgeClient.onFileProgress(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'knowledge.isSupported', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'knowledge.getSupportedLanguages', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'knowledge.getSeparatorsForLanguage', {
      language: 'markdown'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'knowledge.getSupportedFileExtensions', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'knowledge.listFiles', {
      knowledgeBaseId: 'knowledge-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'knowledge.similarityQuery', {
      knowledgeBaseId: 'knowledge-1',
      query: 'hello'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'knowledge.validateFile', {
      filePath: '/workspace/guide.md'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'knowledge.addFile', {
      knowledgeBaseId: 'knowledge-1',
      filePath: '/workspace/guide.md'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'knowledge.deleteFile', {
      knowledgeBaseId: 'knowledge-1',
      fileId: 'file-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'knowledge.reAddFile', {
      knowledgeBaseId: 'knowledge-1',
      fileId: 'file-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'knowledge.pauseAllRunningTasks', {
      knowledgeBaseId: 'knowledge-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'knowledge.resumeAllPausedTasks', {
      knowledgeBaseId: 'knowledge-1'
    })
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'knowledge.file.updated', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'knowledge.file.progress', expect.any(Function))
  })

  it('routes skill sync calls and events through the shared registry names', async () => {
    const bridge = createBridge()
    const skillSyncClient = createSkillSyncClient(bridge)
    const importPreview = {
      skill: {
        name: 'write-tests',
        description: 'Write tests',
        instructions: 'Write useful tests'
      },
      source: {
        name: 'write-tests',
        description: 'Write tests',
        path: '/tools/write-tests.md',
        format: 'markdown',
        lastModified: new Date('2024-01-01T00:00:00.000Z')
      },
      warnings: []
    }
    const exportPreview = {
      skillName: 'write-tests',
      targetTool: 'codex',
      targetPath: '/tools/write-tests.md',
      convertedContent: '# Write tests',
      warnings: []
    }

    await skillSyncClient.scanExternalTools()
    await skillSyncClient.getNewDiscoveries()
    await skillSyncClient.acknowledgeDiscoveries()
    await skillSyncClient.getRegisteredTools()
    await skillSyncClient.scanAgents()
    await skillSyncClient.getAgentDetail('codex')
    await skillSyncClient.getAgentSkillDetail('codex', 'write-tests')
    await skillSyncClient.previewAdoptAgentSkill({ agentId: 'codex', skillName: 'write-tests' })
    await skillSyncClient.executeAdoptAgentSkill({ agentId: 'codex', skillName: 'write-tests' })
    await skillSyncClient.previewLinkDeepChatSkills({
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    await skillSyncClient.executeLinkDeepChatSkills({
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    await skillSyncClient.repairAgentSkillLink({ agentId: 'codex', skillName: 'write-tests' })
    await skillSyncClient.removeAgentSkillLink({ agentId: 'codex', skillName: 'write-tests' })
    await skillSyncClient.previewImport('codex', ['write-tests'])
    await skillSyncClient.executeImport([importPreview], { 'write-tests': 'overwrite' })
    await skillSyncClient.previewExport(['write-tests'], 'codex', { inclusion: 'always' })
    await skillSyncClient.executeExport([exportPreview], { 'write-tests': 'overwrite' })
    skillSyncClient.onDiscoveriesChanged(vi.fn())
    skillSyncClient.onScanStarted(vi.fn())
    skillSyncClient.onScanCompleted(vi.fn())
    skillSyncClient.onImportStarted(vi.fn())
    skillSyncClient.onImportProgress(vi.fn())
    skillSyncClient.onImportCompleted(vi.fn())
    skillSyncClient.onExportStarted(vi.fn())
    skillSyncClient.onExportProgress(vi.fn())
    skillSyncClient.onExportCompleted(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'skillSync.scanExternalTools', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'skillSync.getNewDiscoveries', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'skillSync.acknowledgeDiscoveries', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'skillSync.getRegisteredTools', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'skillSync.scanAgents', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'skillSync.getAgentDetail', {
      agentId: 'codex'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'skillSync.getAgentSkillDetail', {
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'skillSync.previewAdoptAgentSkill', {
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'skillSync.executeAdoptAgentSkill', {
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'skillSync.previewLinkDeepChatSkills', {
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'skillSync.executeLinkDeepChatSkills', {
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'skillSync.repairAgentSkillLink', {
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'skillSync.removeAgentSkillLink', {
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(14, 'skillSync.previewImport', {
      toolId: 'codex',
      skillNames: ['write-tests']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(15, 'skillSync.executeImport', {
      previews: [importPreview],
      strategies: { 'write-tests': 'overwrite' }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(16, 'skillSync.previewExport', {
      skillNames: ['write-tests'],
      targetToolId: 'codex',
      options: { inclusion: 'always' }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(17, 'skillSync.executeExport', {
      previews: [exportPreview],
      strategies: { 'write-tests': 'overwrite' }
    })
    expect(bridge.on).toHaveBeenNthCalledWith(
      1,
      'skillSync.discoveries.changed',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'skillSync.scan.started', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'skillSync.scan.completed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(4, 'skillSync.import.started', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(5, 'skillSync.import.progress', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(6, 'skillSync.import.completed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(7, 'skillSync.export.started', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(8, 'skillSync.export.progress', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(9, 'skillSync.export.completed', expect.any(Function))
  })

  it('routes GitHub Copilot OAuth calls through the shared registry names', async () => {
    const bridge = createBridge()
    const oauthClient = createOAuthClient(bridge)

    const loginResult = await oauthClient.startGitHubCopilotLogin('github-copilot')
    const deviceFlowResult = await oauthClient.startGitHubCopilotDeviceFlowLogin('github-copilot')

    expect(loginResult).toBe(true)
    expect(deviceFlowResult).toBe(false)
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'oauth.githubCopilot.startLogin', {
      providerId: 'github-copilot'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'oauth.githubCopilot.startDeviceFlowLogin', {
      providerId: 'github-copilot'
    })
  })

  it('routes OpenAI Codex OAuth calls through the shared registry names', async () => {
    const bridge = createBridge()
    const oauthClient = createOAuthClient(bridge)
    const listener = vi.fn()

    const status = await oauthClient.getOpenAICodexStatus()
    const browserStatus = await oauthClient.startOpenAICodexBrowserLogin()
    const cancelStatus = await oauthClient.cancelOpenAICodexLogin()
    const logoutStatus = await oauthClient.logoutOpenAICodex()
    oauthClient.onOpenAICodexStatusChanged(listener)

    expect(status.state).toBe('signed-out')
    expect(browserStatus.authenticated).toBe(true)
    expect(cancelStatus.state).toBe('signed-out')
    expect(logoutStatus.state).toBe('signed-out')
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'oauth.openaiCodex.getStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'oauth.openaiCodex.startBrowserLogin', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'oauth.openaiCodex.cancelLogin', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'oauth.openaiCodex.logout', {})
    expect(bridge.on).toHaveBeenCalledWith('oauth.openaiCodex.statusChanged', expect.any(Function))
  })

  it('routes NowledgeMem calls through the shared registry names', async () => {
    const bridge = createBridge()
    const nowledgeMemClient = createNowledgeMemClient(bridge)

    await nowledgeMemClient.getConfig()
    await nowledgeMemClient.updateConfig({
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'secret',
      timeout: 45000
    })
    const testResult = await nowledgeMemClient.testConnection()

    expect(testResult).toEqual({
      success: true,
      message: 'Connection successful'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'nowledgeMem.getConfig', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'nowledgeMem.updateConfig', {
      config: {
        baseUrl: 'http://127.0.0.1:14242',
        apiKey: 'secret',
        timeout: 45000
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'nowledgeMem.testConnection', {})
  })

  it('routes skill file reads through the shared registry name', async () => {
    const bridge = createBridge()
    const skillClient = createSkillClient(bridge)

    const content = await skillClient.readSkillFile('write-tests')

    expect(content).toBe('---\nname: write-tests\n---\nUse tests well')
    expect(bridge.invoke).toHaveBeenCalledWith('skills.readFile', {
      name: 'write-tests'
    })
  })

  it('routes skill management catalog calls through shared registry names', async () => {
    const bridge = createBridge()
    const skillClient = createSkillClient(bridge)

    const skills = await skillClient.getUnifiedSkillCatalog()
    await skillClient.setSkillDisabled('write-tests', true)
    await skillClient.scanGitSkillRepo('https://github.com/op7418/guizang-ppt-skill')
    await skillClient.installFromGit({
      repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
      skillNames: ['guizang-ppt-skill'],
      strategy: 'rename'
    })
    await skillClient.getSkillsSyncConfig()
    await skillClient.setSkillsSyncDirectory('/sync')
    await skillClient.previewSyncDirectoryExport({ skillNames: ['write-tests'] })
    await skillClient.executeSyncDirectoryExport({ skillNames: ['write-tests'] })
    await skillClient.previewSyncDirectoryImport()
    await skillClient.executeSyncDirectoryImport({
      skillNames: ['write-tests'],
      strategy: 'overwrite'
    })

    expect(skills).toEqual([
      expect.objectContaining({
        name: 'write-tests',
        deepchatDisabled: false
      })
    ])
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'skills.listCatalog', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'skills.setDisabled', {
      name: 'write-tests',
      disabled: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'skills.scanGitRepo', {
      repoUrl: 'https://github.com/op7418/guizang-ppt-skill'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'skills.installFromGit', {
      repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
      skillNames: ['guizang-ppt-skill'],
      strategy: 'rename'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'skills.getSyncConfig', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'skills.setSyncDirectory', {
      skillsDirectory: '/sync'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'skills.previewSyncDirectoryExport', {
      skillNames: ['write-tests']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'skills.executeSyncDirectoryExport', {
      skillNames: ['write-tests']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'skills.previewSyncDirectoryImport', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'skills.executeSyncDirectoryImport', {
      skillNames: ['write-tests'],
      strategy: 'overwrite'
    })
  })

  it('routes MCP Router marketplace calls through the shared registry names', async () => {
    const bridge = createBridge()
    const mcpClient = createMcpClient(bridge)

    const listResult = await mcpClient.listMcpRouterServers(1, 20)
    const key = await mcpClient.getMcpRouterApiKey()
    await mcpClient.setMcpRouterApiKey('new-router-key')
    await mcpClient.updateMcpRouterServersAuth('new-router-key')
    const installed = await mcpClient.isServerInstalled('mcprouter', 'context7')
    const installResult = await mcpClient.installMcpRouterServer('context7')

    expect(listResult.servers).toEqual([
      expect.objectContaining({
        server_key: 'context7',
        title: 'Context7'
      })
    ])
    expect(key).toBe('router-key')
    expect(installed).toBe(false)
    expect(installResult).toBe(true)
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'mcp.router.listServers', {
      page: 1,
      limit: 20
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'mcp.router.getApiKey', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'mcp.router.setApiKey', {
      key: 'new-router-key'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'mcp.router.updateServersAuth', {
      apiKey: 'new-router-key'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'mcp.router.isServerInstalled', {
      source: 'mcprouter',
      sourceId: 'context7'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'mcp.router.installServer', {
      serverKey: 'context7'
    })
  })

  it('routes remote control calls through the shared registry names', async () => {
    const bridge = createBridge()
    const remoteControlClient = createRemoteControlClient(bridge)

    await remoteControlClient.listRemoteChannels()
    await remoteControlClient.getChannelSettings('telegram')
    await remoteControlClient.saveChannelSettings('telegram', {
      botToken: 'telegram-token',
      remoteEnabled: true,
      defaultAgentId: 'deepchat',
      defaultWorkdir: ''
    })
    await remoteControlClient.getChannelStatus('telegram')
    await remoteControlClient.getChannelBindings('telegram')
    await remoteControlClient.removeChannelBinding('telegram', 'telegram:100:0')
    await remoteControlClient.removeChannelPrincipal('telegram', '123')
    await remoteControlClient.getChannelPairingSnapshot('telegram')
    await remoteControlClient.createChannelPairCode('telegram')
    await remoteControlClient.clearChannelPairCode('telegram')
    await remoteControlClient.getTelegramStatus()
    await remoteControlClient.getWeixinIlinkStatus()
    await remoteControlClient.startWeixinIlinkLogin({ force: true })
    await remoteControlClient.waitForWeixinIlinkLogin({
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })
    await remoteControlClient.removeWeixinIlinkAccount('account-1')
    await remoteControlClient.restartWeixinIlinkAccount('account-1')

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'remoteControl.listChannels', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'remoteControl.getChannelSettings', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'remoteControl.saveChannelSettings', {
      channel: 'telegram',
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        defaultAgentId: 'deepchat',
        defaultWorkdir: ''
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'remoteControl.getChannelStatus', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'remoteControl.getChannelBindings', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'remoteControl.removeChannelBinding', {
      channel: 'telegram',
      endpointKey: 'telegram:100:0'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'remoteControl.removeChannelPrincipal', {
      channel: 'telegram',
      principalId: '123'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'remoteControl.getChannelPairingSnapshot', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'remoteControl.createChannelPairCode', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'remoteControl.clearChannelPairCode', {
      channel: 'telegram'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'remoteControl.getTelegramStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'remoteControl.getWeixinIlinkStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'remoteControl.startWeixinIlinkLogin', {
      force: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(14, 'remoteControl.waitForWeixinIlinkLogin', {
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(15, 'remoteControl.removeWeixinIlinkAccount', {
      accountId: 'account-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(16, 'remoteControl.restartWeixinIlinkAccount', {
      accountId: 'account-1'
    })
  })

  it('routes project and tool calls through the shared registry names', async () => {
    const bridge = createBridge()
    const deviceClient = createDeviceClient(bridge)
    const projectClient = createProjectClient(bridge)
    const toolClient = createToolClient(bridge)

    await deviceClient.selectFiles({ filters: [{ name: 'ZIP Files', extensions: ['zip'] }] })
    await deviceClient.resetDataByType('chat')
    await projectClient.listRecent(8)
    await projectClient.listEnvironments('archived')
    await projectClient.reorderEnvironments(['/workspace', '/other'])
    await projectClient.archiveEnvironment('/workspace')
    await projectClient.restoreEnvironment('/workspace')
    await projectClient.removeEnvironment('/workspace')
    await projectClient.pathExists('/workspace')
    await projectClient.selectDirectory()
    const unsubscribe = projectClient.onEnvironmentsChanged(() => undefined)
    await toolClient.getAllToolDefinitions({ chatMode: 'agent' })

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'device.selectFiles', {
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'device.resetDataByType', {
      resetType: 'chat'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'project.listRecent', {
      limit: 8
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'project.listEnvironments', {
      status: 'archived'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'project.reorderEnvironments', {
      paths: ['/workspace', '/other']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'project.archiveEnvironment', {
      path: '/workspace'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'project.restoreEnvironment', {
      path: '/workspace'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'project.removeEnvironment', {
      path: '/workspace'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'project.pathExists', {
      path: '/workspace'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'project.selectDirectory', {})
    expect(bridge.on).toHaveBeenCalledWith('project:environments-changed', expect.any(Function))
    expect(unsubscribe).toEqual(expect.any(Function))
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'tools.listDefinitions', {
      chatMode: 'agent'
    })
  })

  it('serializes provider import selections before invoking the bridge', async () => {
    const bridge = createBridge()
    const providerClient = createProviderClient(bridge)
    const providerIds = new Proxy(['hermes:custom'], {})
    const providerOptions = new Proxy(
      {
        'hermes:custom': new Proxy(
          {
            targetApiType: 'anthropic' as const
          },
          {}
        )
      },
      {}
    )

    await providerClient.applyProviderImports('scan-1', [
      {
        sourceId: 'hermes',
        providerIds,
        providerOptions
      }
    ])

    const payload = (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      selections: Array<{
        providerIds: string[]
        providerOptions?: Record<string, { targetApiType?: string }>
      }>
    }
    expect(bridge.invoke).toHaveBeenCalledWith('providers.import.apply', {
      sessionId: 'scan-1',
      selections: [
        {
          sourceId: 'hermes',
          providerIds: ['hermes:custom'],
          providerOptions: {
            'hermes:custom': {
              targetApiType: 'anthropic'
            }
          }
        }
      ]
    })
    expect(payload.selections[0].providerIds).not.toBe(providerIds)
    expect(payload.selections[0].providerOptions).not.toBe(providerOptions)
    expect(() => structuredClone(payload)).not.toThrow()
  })

  it('subscribes to browser activity events', () => {
    const bridge = createBridge()
    const browserClient = createBrowserClient(bridge)
    const listener = vi.fn()

    browserClient.onActivityChanged(listener)

    expect(bridge.on).toHaveBeenCalledWith('browser.activity.changed', listener)
  })
})
