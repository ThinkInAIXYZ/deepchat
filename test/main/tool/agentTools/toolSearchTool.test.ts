import { describe, expect, it } from 'vitest'
import {
  TOOL_SEARCH_DEFAULT_RESULT_LIMIT,
  TOOL_SEARCH_MAX_DESCRIPTION_LENGTH,
  TOOL_SEARCH_MAX_QUERY_LENGTH,
  TOOL_SEARCH_MAX_RESULT_LIMIT,
  TOOL_SEARCH_TOOL_SERVER_NAME,
  buildToolSearchDefinition,
  parseToolSearchInput,
  searchToolSurfaceSnapshot
} from '@/tool/agentTools/toolSearchTool'
import { TOOL_SEARCH_AGENT_TOOL_NAME, getAgentToolExposure } from '@shared/agentTools'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import {
  buildCanonicalToolCatalog,
  createPolicySelectedToolSurfaceRun,
  createToolSurfaceExecutionBatch,
  type ToolSurfaceShadowPolicy
} from '@/agent/deepchat/runtime/toolSurface'

const tool = (
  name: string,
  description: string,
  source: 'agent' | 'mcp',
  effect: 'read' | 'write' = 'read'
): MCPToolDefinition => ({
  type: 'function',
  source,
  execution: effect === 'read' ? TOOL_EXECUTION.read.parallel : TOOL_EXECUTION.write,
  function: {
    name,
    description: source === 'mcp' ? `[private-mcp-server] ${description}` : description,
    parameters: { type: 'object', properties: { secretSchemaField: { type: 'string' } } }
  },
  server: {
    name: source === 'agent' ? 'deepchat' : 'private-mcp-server',
    icons: '',
    description: 'private source metadata',
    ...(source === 'mcp'
      ? {
          id: '22222222-2222-4222-8222-222222222222',
          configGeneration: 1,
          bindingHash: 'a'.repeat(64)
        }
      : {})
  },
  ...(source === 'mcp'
    ? { raw: { name, description, inputSchema: { type: 'object', properties: {} } } }
    : {})
})

function createSearchHarness(
  definitions: MCPToolDefinition[] = [
    tool('read_project', 'Read project files', 'agent'),
    tool(
      'browser_open',
      `Open a browser page\n${'x'.repeat(TOOL_SEARCH_MAX_DESCRIPTION_LENGTH + 20)}`,
      'mcp',
      'write'
    ),
    tool('calendar_lookup', 'Look up calendar events', 'mcp'),
    tool(
      'opaque_capability',
      `${'a'.repeat(TOOL_SEARCH_MAX_DESCRIPTION_LENGTH)} hiddenneedle`,
      'agent'
    ),
    tool(
      'unicode_metadata',
      `Safe\u0000 label\u202e hidden\u200b ${'x'.repeat(221)}😀tail`,
      'agent'
    ),
    tool('unsafe\u202ename', 'Unsafe visible name', 'agent')
  ]
) {
  const toolSearchDefinition = buildToolSearchDefinition()
  const catalog = buildCanonicalToolCatalog(definitions)
  const readProjectTarget = catalog.entries.find(
    (entry) => entry.target.providerVisibleName === 'read_project'
  )
  if (!readProjectTarget) throw new Error('Expected read_project in the test catalog.')
  const policy: ToolSurfaceShadowPolicy = {
    policyVersion: 'tool-search-test-v1',
    enterToolCount: 1,
    exitToolCount: 0,
    enterEstimatedInputTokens: 1,
    exitEstimatedInputTokens: 0,
    maxInitialToolCount: 9,
    maxInitialDefinitionTokens: 100_000,
    activationReserveToolCount: 8,
    activationReserveDefinitionTokens: 90_000,
    maxActivationCandidatesPerBatch: 8,
    maxActivationCandidateDefinitionTokensPerBatch: 100_000,
    maxActivationBatchesPerRun: 4,
    maxAppendedTargetsPerRun: 8,
    toolSearchDefinitionTokens: buildCanonicalToolCatalog([toolSearchDefinition]).definitionTokens,
    toolSearchPromptTokens: 0
  }
  const selected = createPolicySelectedToolSurfaceRun({
    ceilingDefinitions: definitions,
    initialEligibleDefinitions: definitions,
    toolSearchDefinition,
    policy,
    coreStableTargetKeys: [readProjectTarget.stableTargetKey]
  })
  const snapshot = selected.controller.build({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestSeq: 1
    },
    eligibleDefinitions: definitions,
    toolSearchAvailable: true
  })
  selected.controller.admit(snapshot)
  const batch = createToolSurfaceExecutionBatch({ snapshot })
  return { batch, context: batch.createContext(2) }
}

describe('ToolSearch Agent capability', () => {
  it('defines one system-model parallel read tool with the stable reserved identity', () => {
    const definition = buildToolSearchDefinition()

    expect(definition).toMatchObject({
      source: 'agent',
      execution: TOOL_EXECUTION.read.parallel,
      type: 'function',
      function: {
        name: TOOL_SEARCH_AGENT_TOOL_NAME,
        parameters: {
          type: 'object',
          required: ['query']
        }
      },
      server: { name: TOOL_SEARCH_TOOL_SERVER_NAME }
    })
    expect(getAgentToolExposure(definition.function.name)).toBe('system-model')
    expect(definition.function.description).toContain('next model step')
    expect(definition.function.description).toContain('does not execute')
  })

  it('normalizes a bounded query and applies the default result limit', () => {
    expect(parseToolSearchInput({ query: '  search project files  ' })).toEqual({
      success: true,
      data: {
        query: 'search project files',
        limit: TOOL_SEARCH_DEFAULT_RESULT_LIMIT
      }
    })
    expect(parseToolSearchInput({ query: 'browser automation', limit: 1 })).toEqual({
      success: true,
      data: { query: 'browser automation', limit: 1 }
    })
  })

  it('rejects empty, oversized, excessive-limit, and unknown-field inputs', () => {
    for (const input of [
      { query: '   ' },
      { query: '\u200b\u202e' },
      { query: 'x'.repeat(TOOL_SEARCH_MAX_QUERY_LENGTH + 1) },
      { query: 'files', limit: TOOL_SEARCH_MAX_RESULT_LIMIT + 1 },
      { query: 'files', unexpected: true }
    ]) {
      const result = parseToolSearchInput(input)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain(`Invalid arguments for ${TOOL_SEARCH_AGENT_TOOL_NAME}.`)
        expect(result.error).not.toContain(String(input.query))
      }
    }
  })

  it('searches only the frozen hidden catalog and returns bounded model-safe metadata', () => {
    const { batch, context } = createSearchHarness()

    const execution = searchToolSurfaceSnapshot({ query: 'browser page', limit: 2 }, context)

    expect(execution.result.results).toEqual([
      {
        name: 'browser_open',
        source: 'MCP',
        description: expect.stringMatching(/^Open a browser page x+$/),
        effect: 'write',
        state: 'pending'
      }
    ])
    expect(execution.result.results[0].description.length).toBeLessThanOrEqual(
      TOOL_SEARCH_MAX_DESCRIPTION_LENGTH
    )
    expect(execution.candidates).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        requestSeq: 1,
        toolCallOrdinalWithinBatch: 2,
        resultRank: 0
      })
    ])
    const modelOutput = JSON.stringify(execution.result)
    expect(modelOutput).not.toContain('private-mcp-server')
    expect(modelOutput).not.toContain('22222222-2222-4222-8222-222222222222')
    expect(modelOutput).not.toContain('stableTargetKey')
    expect(modelOutput).not.toContain('canonicalToolDefinitionHash')
    expect(modelOutput).not.toContain('secretSchemaField')
    expect(modelOutput).not.toContain('"query"')
    batch.discard()
  })

  it('applies the result limit without returning active or unrelated capabilities', () => {
    const { batch, context } = createSearchHarness()

    const execution = searchToolSurfaceSnapshot({ query: 'project calendar', limit: 1 }, context)

    expect(execution.result.results).toEqual([
      expect.objectContaining({ name: 'calendar_lookup', state: 'pending' })
    ])
    expect(execution.result.results).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: TOOL_SEARCH_AGENT_TOOL_NAME })])
    )
    batch.discard()
  })

  it('does not search hidden description tails or return unsafe model metadata', () => {
    const { batch, context } = createSearchHarness()

    expect(
      searchToolSurfaceSnapshot({ query: 'hiddenneedle', limit: 8 }, context).result.results
    ).toEqual([])
    expect(
      searchToolSurfaceSnapshot({ query: 'unsafe', limit: 8 }, context).result.results
    ).toEqual([])
    const unicodeResult = searchToolSurfaceSnapshot(
      { query: 'unicode_metadata', limit: 1 },
      context
    ).result.results[0]
    expect(unicodeResult.description).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]/u)
    expect(Array.from(unicodeResult.description)).toHaveLength(TOOL_SEARCH_MAX_DESCRIPTION_LENGTH)
    expect(unicodeResult.description.endsWith('😀')).toBe(true)
    batch.discard()
  })

  it('breaks equal-score ties only with provider-visible names', () => {
    const makeDefinitions = (swapBindings: boolean): MCPToolDefinition[] => {
      const alpha = tool('alpha_tool', 'Shared equalmatch capability', 'mcp')
      const beta = tool('beta_tool', 'Shared equalmatch capability', 'mcp')
      const bindings = [
        {
          id: '22222222-2222-4222-8222-222222222222',
          bindingHash: 'a'.repeat(64)
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          bindingHash: 'b'.repeat(64)
        }
      ]
      const [alphaBinding, betaBinding] = swapBindings ? bindings.toReversed() : bindings
      return [
        tool('read_project', 'Read project files', 'agent'),
        { ...alpha, server: { ...alpha.server, ...alphaBinding } },
        { ...beta, server: { ...beta.server, ...betaBinding } }
      ]
    }
    const first = createSearchHarness(makeDefinitions(false))
    const second = createSearchHarness(makeDefinitions(true))

    const search = (context: typeof first.context) =>
      searchToolSurfaceSnapshot({ query: 'equalmatch', limit: 2 }, context).result.results.map(
        (result) => result.name
      )
    expect(search(first.context)).toEqual(['alpha_tool', 'beta_tool'])
    expect(search(second.context)).toEqual(['alpha_tool', 'beta_tool'])
    first.batch.discard()
    second.batch.discard()
  })
})
