import { ArtifactsServer } from './artifactsServer'
// FileSystemServer has been removed - filesystem capabilities are now provided via Agent tools
import { BochaSearchServer } from './bochaSearchServer'
import { BraveSearchServer } from './braveSearchServer'
import { DifyKnowledgeServer } from './difyKnowledgeServer'
import { RagflowKnowledgeServer } from './ragflowKnowledgeServer'
import { FastGptKnowledgeServer } from './fastGptKnowledgeServer'
import { DeepResearchServer } from './deepResearchServer'
import { AutoPromptingServer } from './autoPromptingServer'
import { ConversationSearchServer } from './conversationSearchServer'
import { BuiltinKnowledgeServer } from './builtinKnowledgeServer'
import { AppleServer } from './appleServer'
import type { SessionDatabase } from '@/session/data/database'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import type { SessionTranscript } from '@/session/data/transcript'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { ConfigServicePort } from '@shared/presenter'
import type { KnowledgeSearchPort } from '@shared/types/knowledge'

export type InMemoryServerFactory = (
  serverName: string,
  args: string[],
  env?: Record<string, unknown>
) => ReturnType<typeof buildInMemoryServer>

type InMemoryServerDependencies = {
  sqlitePresenter: SessionDatabase
  sessions: Pick<AppSessionService, 'get'>
  transcript: Pick<SessionTranscript, 'getMessages'>
  settings: Pick<SessionSettingsStore, 'get'>
  configService: Pick<ConfigServicePort, 'getCustomPrompts' | 'getKnowledgeConfigs' | 'getLanguage'>
  knowledgeService: KnowledgeSearchPort
}

function buildInMemoryServer(
  dependencies: InMemoryServerDependencies,
  serverName: string,
  _args: string[],
  env?: Record<string, unknown>
) {
  switch (serverName) {
    // buildInFileSystem has been removed - filesystem capabilities are now provided via Agent tools
    case 'Artifacts':
      return new ArtifactsServer()
    case 'bochaSearch':
      return new BochaSearchServer(env)
    case 'braveSearch':
      return new BraveSearchServer(env)
    case 'deepResearch':
      return new DeepResearchServer(env, dependencies.configService)
    case 'difyKnowledge':
      return new DifyKnowledgeServer(env)
    case 'ragflowKnowledge':
      return new RagflowKnowledgeServer(env)
    case 'fastGptKnowledge':
      return new FastGptKnowledgeServer(env)
    case 'builtinKnowledge':
      return new BuiltinKnowledgeServer(dependencies.configService, dependencies.knowledgeService)
    case 'deepchat-inmemory/deep-research-server':
      return new DeepResearchServer(env, dependencies.configService)
    case 'deepchat-inmemory/auto-prompting-server':
      return new AutoPromptingServer(dependencies.configService)
    case 'deepchat-inmemory/conversation-search-server':
      return new ConversationSearchServer(
        dependencies.sqlitePresenter,
        dependencies.sessions,
        dependencies.transcript,
        dependencies.settings
      )
    case 'deepchat/apple-server':
      // 只在 macOS 上创建 AppleServer
      if (process.platform !== 'darwin') {
        throw new Error('Apple Server is only supported on macOS')
      }
      return new AppleServer()
    default:
      throw new Error(`Unknown in-memory server: ${serverName}`)
  }
}

export const createInMemoryServerFactory =
  (dependencies: InMemoryServerDependencies): InMemoryServerFactory =>
  (serverName, args, env) =>
    buildInMemoryServer(dependencies, serverName, args, env)
