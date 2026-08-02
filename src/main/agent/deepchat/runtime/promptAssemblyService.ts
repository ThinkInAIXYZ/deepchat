import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { MemoryPromptContributor } from '@/agent/deepchat/memory/memoryPromptContributor'
import type {
  BasePromptAssembler,
  PostCompactionPromptAssembler
} from '@/agent/deepchat/loop/ports'
import {
  buildSystemPromptWithSkills,
  type SystemPromptBuilderDependencies
} from '@/agent/deepchat/resources/systemPromptBuilder'
import { buildContextCheckpoint } from './contextContributions'
import { logSlowPreStreamStep } from './preStreamWatchdog'
import type { SessionIdentityService } from './sessionIdentityService'
import type { DeepChatToolResolver } from './toolResolver'

export interface PromptAssemblyProjectDirPort {
  resolveProjectDir(
    sessionId: string,
    projectDir: string | null | undefined,
    expectedInstance: DeepChatAgentInstance
  ): string | null
}

export interface PromptAssemblyServiceDependencies
  extends Pick<
    SystemPromptBuilderDependencies,
    'providerSettings' | 'skillSettings' | 'skillService' | 'providerCatalogPort' | 'toolService'
  > {
  registry: SessionScopeRegistry
  identity: Pick<SessionIdentityService, 'isAcpBackedSubagentSession'>
  orchestrationPolicy: Pick<DeepChatToolResolver, 'resolveOrchestrationPolicy'>
  projectDir: PromptAssemblyProjectDirPort
  memoryPromptContributor: MemoryPromptContributor
}

export class PromptAssemblyService {
  private readonly builderDependencies: SystemPromptBuilderDependencies

  constructor(private readonly deps: PromptAssemblyServiceDependencies) {
    this.builderDependencies = {
      providerSettings: deps.providerSettings,
      skillSettings: deps.skillSettings,
      skillService: deps.skillService,
      providerCatalogPort: deps.providerCatalogPort,
      toolService: deps.toolService,
      assertCurrent: (sessionId, instance) =>
        deps.registry.scopeFor(toAppSessionId(sessionId), instance).assertCurrent(),
      isAcpBackedSubagentSession: (sessionId, providerId) =>
        deps.identity.isAcpBackedSubagentSession(sessionId, providerId),
      resolveProjectDir: (sessionId, projectDir, instance) =>
        deps.projectDir.resolveProjectDir(sessionId, projectDir, instance),
      logSlowStep: logSlowPreStreamStep
    }
  }

  async build(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[],
    activeSkillNamesOverride?: string[],
    resourceInstance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
  ): Promise<string> {
    return await buildSystemPromptWithSkills(this.builderDependencies, {
      sessionId,
      basePrompt,
      toolDefinitions,
      activeSkillNamesOverride,
      orchestrationPolicy: this.deps.orchestrationPolicy.resolveOrchestrationPolicy(sessionId),
      resourceInstance
    })
  }

  createBasePromptAssembler(expectedInstance: DeepChatAgentInstance): BasePromptAssembler {
    return {
      assemble: async (input) =>
        await this.build(
          input.sessionId,
          input.configuredPrompt,
          [...input.toolDefinitions],
          [...input.activeSkillNames],
          expectedInstance
        )
    }
  }

  createPostCompactionPromptAssembler(): PostCompactionPromptAssembler {
    return {
      assemble: async (input) => {
        const contribution = await this.deps.memoryPromptContributor.contribute({
          session: input.memorySession,
          query: input.memoryQuery,
          messageId: input.memoryMessageId
        })
        return {
          checkpoint: buildContextCheckpoint(input.summaryText, input.reconstructionAnchor),
          memory: contribution.memory,
          directives: contribution.directives,
          memoryIncluded: Boolean(contribution.memory.content),
          directivesIncluded: Boolean(contribution.directives.content)
        }
      }
    }
  }
}
