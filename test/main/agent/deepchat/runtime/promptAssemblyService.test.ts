import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  PromptAssemblyService,
  type PromptAssemblyServiceDependencies
} from '@/agent/deepchat/runtime/promptAssemblyService'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const SESSION_ID = 'session'

const buildSystemPromptWithSkills = vi.hoisted(() =>
  vi.fn(async () => 'assembled system prompt')
)

vi.mock('@/agent/deepchat/resources/systemPromptBuilder', () => ({
  buildSystemPromptWithSkills
}))

function createHarness(
  memoryContent: string | null = 'recalled memory',
  directiveContent: string | null = null
) {
  const runtime = new DeepChatAgentRuntime()
  const contribute = vi.fn(async () => ({
    memory: {
      content: memoryContent,
      manifest: null,
      anchorEntryId: null
    },
    directives: {
      content: directiveContent,
      manifest: null,
      anchorEntryId: null
    }
  }))
  const deps = {
    registry: runtime,
    providerSettings: {},
    skillSettings: {},
    skillService: {},
    providerCatalogPort: {},
    toolService: {},
    identity: { isAcpBackedSubagentSession: vi.fn(() => false) },
    orchestrationPolicy: { resolveOrchestrationPolicy: vi.fn(() => 'explicit') },
    projectDir: { resolveProjectDir: vi.fn(() => '/workspace') },
    memoryPromptContributor: { contribute }
  } as unknown as PromptAssemblyServiceDependencies

  return { contribute, deps, runtime, service: new PromptAssemblyService(deps) }
}

describe('PromptAssemblyService', () => {
  it('defaults the resource instance to the hydrated session instance', async () => {
    const { runtime, service } = createHarness()
    buildSystemPromptWithSkills.mockClear()

    await service.build(SESSION_ID, 'base', [], POSIX_COMMAND_SHELL, undefined)

    expect(buildSystemPromptWithSkills.mock.calls[0][1]).toMatchObject({
      sessionId: SESSION_ID,
      basePrompt: 'base',
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: runtime.getHydrated(toAppSessionId(SESSION_ID))
    })
  })

  it('fences the bound assembler against a replaced runtime instance', async () => {
    const { runtime, service } = createHarness()
    buildSystemPromptWithSkills.mockClear()
    const stale = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    runtime.evict(toAppSessionId(SESSION_ID))
    runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    buildSystemPromptWithSkills.mockImplementationOnce(async (dependencies: any, input: any) => {
      dependencies.assertCurrent(input.sessionId, input.resourceInstance)
      return 'assembled system prompt'
    })

    await expect(
      service
        .createBasePromptAssembler(stale)
        .assemble({
          sessionId: SESSION_ID,
          configuredPrompt: 'base',
          toolDefinitions: [],
          activeSkillNames: [],
          commandShell: POSIX_COMMAND_SHELL
        })
    ).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
  })

  it('binds the base assembler to the expected instance and copies its inputs', async () => {
    const { runtime, service } = createHarness()
    buildSystemPromptWithSkills.mockClear()
    const instance = runtime.getOrHydrate(toAppSessionId('other'))
    const toolDefinitions = [] as never[]
    const activeSkillNames = ['skill-a']

    const assembled = await service.createBasePromptAssembler(instance).assemble({
      sessionId: SESSION_ID,
      configuredPrompt: 'base',
      toolDefinitions,
      activeSkillNames,
      commandShell: POSIX_COMMAND_SHELL
    })

    expect(assembled).toBe('assembled system prompt')
    const input = buildSystemPromptWithSkills.mock.calls[0][1] as any
    expect(input.resourceInstance).toBe(instance)
    expect(input.commandShell).toBe(POSIX_COMMAND_SHELL)
    expect(input.activeSkillNamesOverride).toEqual(activeSkillNames)
    expect(input.activeSkillNamesOverride).not.toBe(activeSkillNames)
    expect(input.toolDefinitions).not.toBe(toolDefinitions)
  })

  it('reports memory inclusion from the contributed content', async () => {
    const withMemory = createHarness('recalled memory')
    await expect(
      withMemory.service.createPostCompactionPromptAssembler().assemble({
        memorySession: { sessionId: toAppSessionId(SESSION_ID) },
        summaryText: 'summary',
        reconstructionAnchor: null,
        memoryQuery: 'query'
      })
    ).resolves.toMatchObject({ memoryIncluded: true })

    const withoutMemory = createHarness(null)
    await expect(
      withoutMemory.service.createPostCompactionPromptAssembler().assemble({
        memorySession: { sessionId: toAppSessionId(SESSION_ID) },
        summaryText: 'summary',
        reconstructionAnchor: null,
        memoryQuery: 'query'
      })
    ).resolves.toMatchObject({ memoryIncluded: false })
  })

  it('reports directive inclusion independently from recalled memory', async () => {
    const harness = createHarness(null, 'trusted directive')
    await expect(
      harness.service.createPostCompactionPromptAssembler().assemble({
        memorySession: { sessionId: toAppSessionId(SESSION_ID) },
        summaryText: null,
        reconstructionAnchor: null,
        memoryQuery: 'query'
      })
    ).resolves.toMatchObject({
      memoryIncluded: false,
      directivesIncluded: true,
      directives: { content: 'trusted directive' }
    })
  })
})
