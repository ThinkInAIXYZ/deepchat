import { ArtifactsServer } from './artifactsServer'
import { FileSystemServer } from './filesystem'
import { BochaSearchServer } from './bochaSearchServer'
import { BraveSearchServer } from './braveSearchServer'
import { ImageServer } from './imageServer'
import { PowerpackServer } from './powerpackServer'
import { DifyKnowledgeServer } from './difyKnowledgeServer'
import { RagflowKnowledgeServer } from './ragflowKnowledgeServer'
import { FastGptKnowledgeServer } from './fastGptKnowledgeServer'
import { DeepResearchServer } from './deepResearchServer'
import { AutoPromptingServer } from './autoPromptingServer'
import { ConversationSearchServer } from './conversationSearchServer'
import { MeetingServer } from './meetingServer'
import { BuiltinKnowledgeServer } from './builtinKnowledgeServer'
import { BuiltinKnowledgeConfig } from '@shared/presenter'
import { AppleServer } from './appleServer'

export function getInMemoryServer(
  serverName: string,
  args: string[],
  env?: Record<string, unknown>
) {
  switch (serverName) {
    case 'buildInFileSystem':
      return new FileSystemServer(args)
    case 'Artifacts':
      return new ArtifactsServer()
    case 'bochaSearch':
      return new BochaSearchServer(env)
    case 'braveSearch':
      return new BraveSearchServer(env)
    case 'deepResearch':
      return new DeepResearchServer(env)
    case 'imageServer':
      return new ImageServer(args[0], args[1])
    case 'powerpack':
      return new PowerpackServer(env)
    case 'difyKnowledge':
      return new DifyKnowledgeServer(
        env as {
          configs: {
            apiKey: string
            endpoint: string
            datasetId: string
            description: string
            enabled: boolean
          }[]
        }
      )
    case 'ragflowKnowledge':
      return new RagflowKnowledgeServer(
        env as {
          configs: {
            apiKey: string
            endpoint: string
            datasetIds: string[]
            description: string
            enabled: boolean
          }[]
        }
      )
    case 'fastGptKnowledge':
      return new FastGptKnowledgeServer(
        env as {
          configs: {
            apiKey: string
            endpoint: string
            datasetId: string
            description: string
            enabled: boolean
          }[]
        }
      )
    case 'builtinKnowledge':
      return new BuiltinKnowledgeServer(
        env as {
          configs: BuiltinKnowledgeConfig[]
        }
      )
    case 'deepchat-inmemory/deep-research-server':
      return new DeepResearchServer(env)
    case 'deepchat-inmemory/auto-prompting-server':
      return new AutoPromptingServer()
    case 'deepchat-inmemory/conversation-search-server':
      return new ConversationSearchServer()
    case 'deepchat-inmemory/meeting-server':
      return new MeetingServer()
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
