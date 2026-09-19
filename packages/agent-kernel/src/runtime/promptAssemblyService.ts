import type { MCPToolDefinition } from '@deepchat/shared/types/core/mcp'
import type { DeepChatPromptAssembly } from '@deepchat/shared/types/prompt-assembly'
import { toAppSessionId } from '../collab/agent-shared/agentSessionIds.js'
import type { DeepChatAgentInstance } from '../instance/deepChatAgentInstance.js'
import type { SessionScopeRegistry } from '../instance/deepChatAgentRuntime.js'
import type { MemoryPromptContributor } from '../memory/memoryPromptContributor.js'
import type {
  BasePromptAssembler,
  PostCompactionPromptAssembler
} from '../loop/ports.js'
import {
  buildSystemPromptAssemblyWithSkills,
  buildSystemPromptWithSkills,
  type SystemPromptBuilderDependencies
} from '../resources/systemPromptBuilder.js'
import { buildContextCheckpoint } from './contextContributions.js'
import { logSlowPreStreamStep } from './preStreamWatchdog.js'
import type { SessionIdentityService } from './sessionIdentityService.js'
import type { DeepChatToolResolver } from './toolResolver.js'
import type { ResolvedCommandShell } from '@deepchat/shared/commandShell'

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
    commandShell: ResolvedCommandShell,
    activeSkillNamesOverride: string[] | undefined,
    resourceInstance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance,
    routingContext: {
      sessionActiveSkillNamesOverride?: string[]
      sessionSkillBodiesOverride?: readonly Readonly<{ name: string; content: string }>[]
      contextLength?: number
    } = {}
  ): Promise<string> {
    return await buildSystemPromptWithSkills(this.builderDependencies, {
      sessionId,
      basePrompt,
      toolDefinitions,
      activeSkillNamesOverride,
      ...routingContext,
      ...(routingContext.sessionSkillBodiesOverride
        ? {
            sessionSkillBodiesOverride: routingContext.sessionSkillBodiesOverride.map((skill) => ({
              ...skill
            }))
          }
        : {}),
      orchestrationPolicy: this.deps.orchestrationPolicy.resolveOrchestrationPolicy(sessionId),
      commandShell,
      resourceInstance
    })
  }

  async buildWithProvenance(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[],
    commandShell: ResolvedCommandShell,
    activeSkillNamesOverride?: string[],
    resourceInstance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance,
    routingContext: {
      sessionActiveSkillNamesOverride?: string[]
      sessionSkillBodiesOverride?: readonly Readonly<{ name: string; content: string }>[]
      contextLength?: number
    } = {}
  ): Promise<DeepChatPromptAssembly> {
    return await buildSystemPromptAssemblyWithSkills(this.builderDependencies, {
      sessionId,
      basePrompt,
      toolDefinitions,
      activeSkillNamesOverride,
      ...routingContext,
      ...(routingContext.sessionSkillBodiesOverride
        ? {
            sessionSkillBodiesOverride: routingContext.sessionSkillBodiesOverride.map((skill) => ({
              ...skill
            }))
          }
        : {}),
      orchestrationPolicy: this.deps.orchestrationPolicy.resolveOrchestrationPolicy(sessionId),
      commandShell,
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
          input.commandShell,
          [...input.activeSkillNames],
          expectedInstance,
          {
            sessionActiveSkillNamesOverride: [...input.sessionActiveSkillNames],
            sessionSkillBodiesOverride: input.sessionSkillBodiesOverride,
            contextLength: input.contextLength
          }
        ),
      assembleWithProvenance: async (input) =>
        await this.buildWithProvenance(
          input.sessionId,
          input.configuredPrompt,
          [...input.toolDefinitions],
          input.commandShell,
          [...input.activeSkillNames],
          expectedInstance,
          {
            sessionActiveSkillNamesOverride: [...input.sessionActiveSkillNames],
            sessionSkillBodiesOverride: input.sessionSkillBodiesOverride,
            contextLength: input.contextLength
          }
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
          messageSkillActiveTurnContext: null,
          memoryIncluded: Boolean(contribution.memory.content),
          directivesIncluded: Boolean(contribution.directives.content)
        }
      }
    }
  }
}
