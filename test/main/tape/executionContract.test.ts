import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelType } from '@shared/model'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import {
  assemblePromptSections,
  createPromptAssemblySection
} from '@/agent/deepchat/resources/promptAssembly'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import {
  ExecutionContractError,
  MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS,
  MAX_EXECUTION_CONTRACT_BINDING_BYTES,
  MAX_EXECUTION_CONTRACT_TOOLS,
  assertExecutionContractAllowsDispatch,
  buildEffectiveGenerationConfigHash,
  buildExecutionContract,
  buildExecutionContractBinding,
  buildProviderVisibleToolDefinitionsHash,
  executionContractMatchesBinding,
  isDeepChatExecutionContract,
  isDeepChatExecutionContractBinding,
  isToolEffectWithinCeiling,
  meetToolEffects,
  parseExecutionContractBinding,
  type BuildExecutionContractInput
} from '@/tape/domain/executionContract'
import { buildTaskContract } from '@/tape/domain/taskContract'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const SERVER_ID = '22222222-2222-4222-8222-222222222222'
const BINDING_HASH = 'a'.repeat(64)

function agentTool(
  name: string,
  execution: MCPToolDefinition['execution'] = TOOL_EXECUTION.read.parallel
): MCPToolDefinition {
  return {
    source: 'agent',
    execution,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'agent-filesystem',
      icons: '',
      description: 'Agent tools'
    }
  }
}

function mcpTool(
  overrides: {
    name?: string
    serverId?: string
    execution?: MCPToolDefinition['execution']
  } = {}
): MCPToolDefinition {
  const name = overrides.name ?? 'remote_read'
  return {
    source: 'mcp',
    execution: overrides.execution ?? TOOL_EXECUTION.write,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: { optional: undefined } }
    },
    server: {
      name: 'remote',
      icons: '',
      description: 'Remote tools',
      id: overrides.serverId ?? SERVER_ID,
      configGeneration: 3,
      bindingHash: BINDING_HASH
    },
    raw: {
      name: 'read',
      inputSchema: { type: 'object', properties: {} }
    }
  }
}

function buildInput(
  overrides: Partial<BuildExecutionContractInput> = {}
): BuildExecutionContractInput {
  const promptAssembly = assemblePromptSections([
    createPromptAssemblySection({
      kind: 'configured_prompt',
      sourceRef: 'session:generation-settings.system-prompt',
      content: 'Keep this secret body out of the contract.'
    }),
    createPromptAssemblySection({
      kind: 'agents_instructions',
      sourceRef: 'workspace:AGENTS.md',
      content: '',
      freshness: 'missing',
      degradationCodes: ['agents_file_missing']
    })
  ])
  return {
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq: 2
    },
    promptAssembly,
    providerMessages: [
      { role: 'system', content: promptAssembly.prompt },
      { role: 'user', content: 'Hello' }
    ],
    tools: [mcpTool(), agentTool('read')],
    providerId: 'provider-1',
    modelId: 'model-1',
    modelConfig: {
      maxTokens: 4096,
      contextLength: 32_768,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: ModelType.Chat,
      conversationId: 'session-1'
    },
    temperature: 0.2,
    maxTokens: 2048,
    workspace: { kind: 'path', path: '/workspace/project/' },
    maxSubagentDepth: 1,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'deepchat-view-v1',
    ...overrides
  }
}

function buildTaskContext(
  overrides: {
    sessionId?: string
    workspace?: string
    maxToolEffect?: 'read' | 'write'
    maxSubagentDepth?: number
    contractHash?: string
  } = {}
) {
  const contract = buildTaskContract({
    delegationId: 'delegation-1',
    turnId: 'turn-1',
    turnSeq: 1,
    turnKind: 'initial',
    parentSessionId: 'parent-1',
    slotId: 'reviewer',
    targetAgentId: 'agent-1',
    title: 'Review boundaries',
    prompt: 'Inspect the contract boundary.',
    workspace: { kind: 'path', path: overrides.workspace ?? path.resolve('task-workspace') },
    handoffFormat: [],
    maxToolEffect: overrides.maxToolEffect ?? 'write',
    maxSubagentDepth: overrides.maxSubagentDepth ?? 1
  })
  return {
    contract,
    localRef: {
      schemaVersion: 1 as const,
      sessionId: overrides.sessionId ?? 'session-1',
      tapeIdentity: 'c'.repeat(64),
      entryId: 2,
      contractHash: overrides.contractHash ?? contract.contractHash
    }
  }
}

describe('ExecutionContract domain', () => {
  it('builds a bounded immutable contract without persisting prompt bodies', () => {
    const contract = buildExecutionContract(buildInput())
    const serialized = JSON.stringify(contract)

    expect(contract).toMatchObject({
      schemaVersion: 1,
      hashVersion: 1,
      request: { runId: RUN_ID, requestSeq: 2 },
      ceilings: {
        workspace: { kind: 'path', path: '/workspace/project/' },
        maxSubagentDepth: 1
      },
      provenance: {
        promptSections: [
          {
            kind: 'configured_prompt',
            contentHash: expect.stringMatching(/^[0-9a-f]{64}$/)
          },
          {
            kind: 'agents_instructions',
            inclusion: 'omitted',
            freshness: 'missing',
            degradationCodes: ['agents_file_missing']
          }
        ],
        taskContractRef: null
      },
      contractHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(serialized).not.toContain('Keep this secret body')
    expect(contract.ceilings.tools.map((tool) => tool.target.providerVisibleName)).toEqual([
      'remote_read',
      'read'
    ])
    expect(
      contract.ceilings.tools.find((tool) => tool.target.source === 'agent')?.target
    ).toMatchObject({
      source: 'agent',
      serverId: null,
      configGeneration: null,
      bindingHash: null,
      originalName: 'read'
    })
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract.ceilings.tools[0].target)).toBe(true)
    expect(Object.isFrozen(contract.provenance.promptSections)).toBe(true)
    expect(isDeepChatExecutionContract(contract)).toBe(true)
  })

  it('binds a child-local TaskContract and rejects View ceiling expansion', () => {
    const taskWorkspace = path.resolve('task-workspace')
    const context = buildTaskContext({ workspace: taskWorkspace })
    const contract = buildExecutionContract(
      buildInput({
        tools: [agentTool('read')],
        workspace: { kind: 'path', path: path.join(taskWorkspace, 'child') },
        maxSubagentDepth: 1,
        taskContractContext: context
      })
    )

    expect(contract.provenance.taskContractRef).toEqual(context.localRef)
    expect(Object.isFrozen(contract.provenance.taskContractRef)).toBe(true)
    expect(isDeepChatExecutionContract(contract)).toBe(true)

    const crossSession = JSON.parse(JSON.stringify(contract))
    crossSession.provenance.taskContractRef.sessionId = 'another-child'
    const { contractHash: _, ...crossSessionDraft } = crossSession
    crossSession.contractHash = hashJsonData(crossSessionDraft)
    expect(isDeepChatExecutionContract(crossSession)).toBe(false)

    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [mcpTool()],
          workspace: { kind: 'path', path: taskWorkspace },
          maxSubagentDepth: 0,
          taskContractContext: buildTaskContext({
            workspace: taskWorkspace,
            maxToolEffect: 'read'
          })
        })
      )
    ).toThrow(/effect ceiling/u)
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [agentTool('read')],
          workspace: { kind: 'path', path: path.resolve('outside-task-workspace') },
          maxSubagentDepth: 0,
          taskContractContext: context
        })
      )
    ).toThrow(/workspace ceiling/u)
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [agentTool('read')],
          workspace: { kind: 'path', path: taskWorkspace },
          maxSubagentDepth: 1,
          taskContractContext: buildTaskContext({
            workspace: taskWorkspace,
            maxSubagentDepth: 0
          })
        })
      )
    ).toThrow(/Subagent ceiling/u)
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [agentTool('read')],
          workspace: { kind: 'path', path: taskWorkspace },
          maxSubagentDepth: 0,
          taskContractContext: buildTaskContext({
            sessionId: 'another-child',
            workspace: taskWorkspace
          })
        })
      )
    ).toThrow(/provider request Session/u)
  })

  it('hashes the exact provider order while canonicalizing the enforcement projection', () => {
    const first = buildExecutionContract(buildInput({ tools: [mcpTool(), agentTool('read')] }))
    const reversed = buildExecutionContract(buildInput({ tools: [agentTool('read'), mcpTool()] }))

    expect(first.ceilings.tools).toEqual(reversed.ceilings.tools)
    expect(first.provenance.internalExecutionPolicyHash).toBe(
      reversed.provenance.internalExecutionPolicyHash
    )
    expect(first.provenance.providerVisibleToolDefinitionsHash).not.toBe(
      reversed.provenance.providerVisibleToolDefinitionsHash
    )
    expect(first.contractHash).not.toBe(reversed.contractHash)
  })

  it('excludes execution policy from the provider-visible hash and includes it internally', () => {
    const read = buildExecutionContract(
      buildInput({ tools: [agentTool('inspect', TOOL_EXECUTION.read.sequential)] })
    )
    const write = buildExecutionContract(
      buildInput({ tools: [agentTool('inspect', TOOL_EXECUTION.write)] })
    )

    expect(read.provenance.providerVisibleToolDefinitionsHash).toBe(
      write.provenance.providerVisibleToolDefinitionsHash
    )
    expect(read.provenance.internalExecutionPolicyHash).not.toBe(
      write.provenance.internalExecutionPolicyHash
    )

    const otherWorkspace = buildExecutionContract(
      buildInput({
        tools: [agentTool('inspect', TOOL_EXECUTION.read.sequential)],
        workspace: { kind: 'path', path: '/workspace/other' }
      })
    )
    expect(read.provenance.internalExecutionPolicyHash).not.toBe(
      otherWorkspace.provenance.internalExecutionPolicyHash
    )
  })

  it('deduplicates identical targets and rejects ambiguous target or policy mappings', () => {
    const duplicate = agentTool('read')
    expect(
      buildExecutionContract(buildInput({ tools: [duplicate, duplicate] })).ceilings.tools
    ).toHaveLength(1)

    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [
            agentTool('read', TOOL_EXECUTION.read.parallel),
            agentTool('read', TOOL_EXECUTION.write)
          ]
        })
      )
    ).toThrow(/conflicting execution policies/)
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [mcpTool(), mcpTool({ serverId: '33333333-3333-4333-8333-333333333333' })]
        })
      )
    ).toThrow(/resolves to conflicting targets/)

    const changedDefinition = agentTool('read')
    changedDefinition.function.description = 'A different provider-visible definition'
    expect(() =>
      buildExecutionContract(buildInput({ tools: [agentTool('read'), changedDefinition] }))
    ).toThrow(/conflicting provider definitions/)
  })

  it('requires stable MCP bindings and matching prompt provenance', () => {
    const missingBinding = mcpTool()
    delete missingBinding.server.bindingHash
    expect(() => buildExecutionContract(buildInput({ tools: [missingBinding] }))).toThrow(
      /server.bindingHash/
    )

    const input = buildInput()
    expect(() =>
      buildExecutionContract({
        ...input,
        providerMessages: [{ role: 'system', content: 'different prompt' }]
      })
    ).toThrow(/does not match the provider-visible system message/)

    const corruptedSection = {
      ...input.promptAssembly.sections[0],
      contentHash: '0'.repeat(64)
    }
    expect(() =>
      buildExecutionContract({
        ...input,
        promptAssembly: {
          ...input.promptAssembly,
          sections: [corruptedSection]
        }
      })
    ).toThrow(/contentHash does not match/)
  })

  it('omits conversation identity from the generation hash without mutating config', () => {
    const firstConfig = buildInput().modelConfig
    const secondConfig = { ...firstConfig, conversationId: 'session-2' }

    expect(
      buildEffectiveGenerationConfigHash({
        modelConfig: firstConfig,
        temperature: 0.2,
        maxTokens: 2048
      })
    ).toBe(
      buildEffectiveGenerationConfigHash({
        modelConfig: secondConfig,
        temperature: 0.2,
        maxTokens: 2048
      })
    )
    expect(firstConfig.conversationId).toBe('session-1')
  })

  it('preserves prototype-shaped schema keys in provider-visible tool hashes', () => {
    const tool = mcpTool()
    Object.defineProperty(tool.function.parameters.properties, '__proto__', {
      value: { type: 'string' },
      enumerable: true,
      configurable: true
    })
    const baseline = mcpTool()

    expect(buildProviderVisibleToolDefinitionsHash([tool])).not.toBe(
      buildProviderVisibleToolDefinitionsHash([baseline])
    )
  })

  it('enforces tool and prompt-section count limits before canonical construction', () => {
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: Array.from({ length: MAX_EXECUTION_CONTRACT_TOOLS + 1 }, (_, index) =>
            agentTool(`tool_${index}`)
          )
        })
      )
    ).toThrow(ExecutionContractError)

    expect(() => buildExecutionContract(buildInput({ maxSubagentDepth: 2 }))).toThrow(
      /V1 limit of 1/
    )

    const promptAssembly = assemblePromptSections(
      Array.from({ length: MAX_EXECUTION_CONTRACT_PROMPT_SECTIONS }, (_, index) =>
        createPromptAssemblySection({
          kind: 'tooling',
          sourceRef: `runtime:tooling:${index}`,
          content: `section ${index}`
        })
      )
    )
    const extraSection = createPromptAssemblySection({
      kind: 'tooling',
      sourceRef: 'runtime:tooling:extra',
      content: 'extra'
    })
    expect(() =>
      buildExecutionContract(
        buildInput({
          promptAssembly: {
            prompt: promptAssembly.prompt,
            sections: [...promptAssembly.sections, extraSection]
          },
          providerMessages: [{ role: 'system', content: promptAssembly.prompt }]
        })
      )
    ).toThrow(ExecutionContractError)
  })

  it('rejects a canonical contract above the persistence byte budget', () => {
    const promptAssembly = assemblePromptSections(
      Array.from({ length: 40 }, (_, index) =>
        createPromptAssemblySection({
          kind: 'tooling',
          sourceRef: `runtime:${index}:${'x'.repeat(1_900)}`,
          content: `section ${index}`
        })
      )
    )

    expect(() =>
      buildExecutionContract(
        buildInput({
          promptAssembly,
          providerMessages: [{ role: 'system', content: promptAssembly.prompt }]
        })
      )
    ).toThrow(/exceeds 65536 UTF-8 bytes/)
  })

  it('detects hash tampering and applies the declared effect ordering', () => {
    const contract = buildExecutionContract(buildInput())
    const tampered = {
      ...contract,
      dynamicControlSnapshot: { ...contract.dynamicControlSnapshot, permissionMode: 'full_access' }
    } as typeof contract
    const staleProvenance = {
      ...contract,
      provenance: { ...contract.provenance, internalExecutionPolicyHash: 'a'.repeat(64) }
    } as typeof contract

    expect(isDeepChatExecutionContract(tampered)).toBe(false)
    expect(isDeepChatExecutionContract(staleProvenance)).toBe(false)
    expect(isToolEffectWithinCeiling('read', 'write')).toBe(true)
    expect(isToolEffectWithinCeiling('write', 'read')).toBe(false)
    expect(meetToolEffects('read', 'write')).toBe('read')
    expect(meetToolEffects('write', 'write')).toBe('write')
  })

  it('allows only the exact provider View identity and stable tool target', () => {
    const currentTool = mcpTool()
    const contract = buildExecutionContract(buildInput({ tools: [currentTool] }))
    const dispatchInput = {
      request: contract.request,
      currentTool,
      currentWorkspace: { kind: 'path' as const, path: '/workspace/project' },
      currentMaxSubagentDepth: 1,
      requestedSubagentDepth: 0
    }

    expect(() => assertExecutionContractAllowsDispatch(contract, dispatchInput)).not.toThrow()
    expect(() =>
      assertExecutionContractAllowsDispatch(contract, {
        ...dispatchInput,
        request: { ...contract.request, requestSeq: contract.request.requestSeq + 1 }
      })
    ).toThrow(expect.objectContaining({ code: 'identity_mismatch' }))

    const tampered = {
      ...contract,
      dynamicControlSnapshot: { ...contract.dynamicControlSnapshot, permissionMode: 'full_access' }
    } as typeof contract
    expect(() => assertExecutionContractAllowsDispatch(tampered, dispatchInput)).toThrow(
      expect.objectContaining({ code: 'invalid_contract' })
    )

    expect(() =>
      assertExecutionContractAllowsDispatch(contract, {
        ...dispatchInput,
        currentTool: mcpTool({ name: 'new_tool' })
      })
    ).toThrow(expect.objectContaining({ code: 'tool_not_allowed' }))
    expect(() =>
      assertExecutionContractAllowsDispatch(contract, {
        ...dispatchInput,
        currentTool: mcpTool({ serverId: '33333333-3333-4333-8333-333333333333' })
      })
    ).toThrow(expect.objectContaining({ code: 'target_mismatch' }))
  })

  it('binds paused execution to the complete provider View identity and contract hash', () => {
    const contract = buildExecutionContract(buildInput())
    const binding = buildExecutionContractBinding(contract)

    expect(binding).toEqual({
      schemaVersion: 1,
      request: contract.request,
      contractHash: contract.contractHash
    })
    expect(Object.isFrozen(binding)).toBe(true)
    expect(isDeepChatExecutionContractBinding(binding)).toBe(true)
    expect(executionContractMatchesBinding(contract, binding)).toBe(true)
    expect(
      executionContractMatchesBinding(contract, {
        ...binding,
        request: { ...binding.request, requestSeq: binding.request.requestSeq + 1 }
      })
    ).toBe(false)
    expect(isDeepChatExecutionContractBinding({ ...binding, extra: true })).toBe(false)
    expect(parseExecutionContractBinding(JSON.stringify(binding))).toEqual(binding)
    expect(parseExecutionContractBinding('{')).toBeNull()
    expect(
      parseExecutionContractBinding('x'.repeat(MAX_EXECUTION_CONTRACT_BINDING_BYTES + 1))
    ).toBeNull()
  })

  it('meets frozen effect, execution mode, workspace, and nesting ceilings', () => {
    const frozenRead = agentTool('inspect', TOOL_EXECUTION.read.sequential)
    const readContract = buildExecutionContract(buildInput({ tools: [frozenRead] }))
    const dispatchInput = {
      request: readContract.request,
      currentTool: frozenRead,
      currentWorkspace: { kind: 'path' as const, path: '/workspace/project' },
      currentMaxSubagentDepth: 1,
      requestedSubagentDepth: 0
    }

    expect(() =>
      assertExecutionContractAllowsDispatch(readContract, {
        ...dispatchInput,
        currentTool: agentTool('inspect', TOOL_EXECUTION.write)
      })
    ).toThrow(expect.objectContaining({ code: 'effect_exceeds_ceiling' }))
    expect(() =>
      assertExecutionContractAllowsDispatch(readContract, {
        ...dispatchInput,
        currentTool: agentTool('inspect', TOOL_EXECUTION.read.parallel)
      })
    ).toThrow(expect.objectContaining({ code: 'execution_mode_mismatch' }))

    const frozenWrite = agentTool('inspect', TOOL_EXECUTION.write)
    const writeContract = buildExecutionContract(buildInput({ tools: [frozenWrite] }))
    expect(() =>
      assertExecutionContractAllowsDispatch(writeContract, {
        ...dispatchInput,
        request: writeContract.request,
        currentTool: agentTool('inspect', TOOL_EXECUTION.read.sequential)
      })
    ).not.toThrow()

    expect(() =>
      assertExecutionContractAllowsDispatch(readContract, {
        ...dispatchInput,
        currentWorkspace: { kind: 'path', path: '/workspace/other' }
      })
    ).toThrow(expect.objectContaining({ code: 'workspace_mismatch' }))
    const defaultWorkspaceContract = buildExecutionContract(
      buildInput({ tools: [frozenRead], workspace: { kind: 'runtime_default' } })
    )
    expect(() =>
      assertExecutionContractAllowsDispatch(defaultWorkspaceContract, {
        ...dispatchInput,
        request: defaultWorkspaceContract.request,
        currentWorkspace: { kind: 'runtime_default' }
      })
    ).not.toThrow()

    const delegationTool = agentTool('deepchat_subagents', TOOL_EXECUTION.write)
    const noNestingContract = buildExecutionContract(
      buildInput({ tools: [delegationTool], maxSubagentDepth: 0 })
    )
    const nestingInput = {
      request: noNestingContract.request,
      currentTool: delegationTool,
      currentWorkspace: { kind: 'path' as const, path: '/workspace/project' },
      currentMaxSubagentDepth: 1,
      requestedSubagentDepth: 1
    }
    expect(() => assertExecutionContractAllowsDispatch(noNestingContract, nestingInput)).toThrow(
      expect.objectContaining({ code: 'subagent_depth_exceeded' })
    )

    const nestingContract = buildExecutionContract(
      buildInput({ tools: [delegationTool], maxSubagentDepth: 1 })
    )
    expect(() =>
      assertExecutionContractAllowsDispatch(nestingContract, {
        ...nestingInput,
        request: nestingContract.request,
        currentMaxSubagentDepth: 0
      })
    ).toThrow(expect.objectContaining({ code: 'subagent_depth_exceeded' }))
  })

  it('validates canonical workspace paths independently of the replay host platform', () => {
    const stored = JSON.parse(JSON.stringify(buildExecutionContract(buildInput())))
    stored.ceilings.workspace = { kind: 'path', path: 'C:\\workspace\\project\\' }
    stored.provenance.internalExecutionPolicyHash = hashJsonData(stored.ceilings)
    const { contractHash: _, ...draft } = stored
    stored.contractHash = hashJsonData(draft)

    expect(isDeepChatExecutionContract(stored)).toBe(true)

    const taskContext = buildTaskContext({ workspace: 'C:/workspace/project/' })
    const contract = buildExecutionContract(
      buildInput({
        tools: [agentTool('read')],
        workspace: { kind: 'path', path: 'C:/workspace/project/child/' },
        maxSubagentDepth: 0,
        taskContractContext: taskContext
      })
    )
    expect(contract.ceilings.workspace).toEqual({
      kind: 'path',
      path: 'C:\\workspace\\project\\child\\'
    })
    expect(() =>
      assertExecutionContractAllowsDispatch(contract, {
        request: contract.request,
        currentTool: agentTool('read'),
        currentWorkspace: { kind: 'path', path: 'C:/workspace/project/child/' },
        currentMaxSubagentDepth: 0,
        requestedSubagentDepth: 0
      })
    ).not.toThrow()
    expect(() =>
      buildExecutionContract(
        buildInput({
          tools: [agentTool('read')],
          workspace: { kind: 'path', path: 'C:/workspace/other/' },
          maxSubagentDepth: 0,
          taskContractContext: taskContext
        })
      )
    ).toThrow(/workspace ceiling/u)
  })
})
