import { ArtifactsServer } from './artifactsServer'
import { FileSystemServer } from './filesystem'
import { BochaSearchServer } from './bochaSearchServer'
import { BraveSearchServer } from './braveSearchServer'
import { ImageServer } from './imageServer'
import { PowerpackServer } from './powerpackServer'
import { DifyKnowledgeServer } from './difyKnowledgeServer'
import { RagflowKnowledgeServer } from './ragflowKnowledgeServer'
import { FastGptKnowledgeServer } from './fastGptKnowledgeServer'
import { CustomPromptsServer } from './customPromptsServer'
import { DeepResearchServer } from './deepResearchServer'
import { TemplatePromptServer } from './templatePromptServer'

export function getInMemoryServer(
  serverName: string,
  args: string[],
  env?: Record<string, unknown>
) {
  switch (serverName) {
    case 'TemplatePromptServer':
      return new TemplatePromptServer()
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
      return new PowerpackServer()
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
    case 'deepchat-inmemory/custom-prompts-server':
      return new CustomPromptsServer()
    case 'deepchat-inmemory/deep-research-server':
      return new DeepResearchServer(env)
    default:
      throw new Error(`Unknown in-memory server: ${serverName}`)
  }
}
