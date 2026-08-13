import { describe, expect, expectTypeOf, it } from 'vitest'
import { selectToolBatchExecutionMode } from '@/agent/deepchat/runtime/toolExecutionPolicy'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type ToolExecutionContract
} from '@shared/types/core/mcp'
import type { PermissionMode } from '@shared/types/agent-interface'

function makeDefinition(
  name: string,
  execution: ToolExecutionContract
): MCPToolDefinition {
  return {
    execution,
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: '', description: 'Test server' }
  }
}

function selectMode(
  names: string[],
  toolDefinitions: MCPToolDefinition[],
  permissionMode: PermissionMode = 'full_access'
) {
  return selectToolBatchExecutionMode({
    permissionMode,
    toolCalls: names.map((name) => ({ name })),
    toolDefinitions
  })
}

describe('selectToolBatchExecutionMode', () => {
  it('keeps shared execution presets immutable at runtime', () => {
    expect(Object.isFrozen(TOOL_EXECUTION)).toBe(true)
    expect(Object.isFrozen(TOOL_EXECUTION.read)).toBe(true)
    expect(Object.isFrozen(TOOL_EXECUTION.read.parallel)).toBe(true)
    expect(Object.isFrozen(TOOL_EXECUTION.read.sequential)).toBe(true)
    expect(Object.isFrozen(TOOL_EXECUTION.write)).toBe(true)
  })

  it('restricts write tools to sequential execution at the type boundary', () => {
    type WriteExecution = Extract<ToolExecutionContract, { effect: 'write' }>

    expectTypeOf<WriteExecution['mode']>().toEqualTypeOf<'sequential'>()
  })

  it('selects parallel for a multi-call batch of explicitly parallel reads', () => {
    const definitions = [makeDefinition('inspect', TOOL_EXECUTION.read.parallel)]

    expect(selectMode(['inspect', 'inspect'], definitions)).toBe('parallel')
  })

  it.each<PermissionMode>(['default', 'auto_approve'])(
    'keeps parallel reads sequential in %s permission mode',
    (permissionMode) => {
      const definitions = [makeDefinition('inspect', TOOL_EXECUTION.read.parallel)]

      expect(selectMode(['inspect', 'inspect'], definitions, permissionMode)).toBe('sequential')
    }
  )

  it('keeps single calls sequential', () => {
    const definitions = [makeDefinition('inspect', TOOL_EXECUTION.read.parallel)]

    expect(selectMode(['inspect'], definitions)).toBe('sequential')
  })

  it('keeps batches containing a sequential read or write sequential', () => {
    const definitions = [
      makeDefinition('parallel-read', TOOL_EXECUTION.read.parallel),
      makeDefinition('sequential-read', TOOL_EXECUTION.read.sequential),
      makeDefinition('write', TOOL_EXECUTION.write)
    ]

    expect(selectMode(['parallel-read', 'sequential-read'], definitions)).toBe('sequential')
    expect(selectMode(['parallel-read', 'write'], definitions)).toBe('sequential')
  })

  it('fails closed for missing, malformed, or duplicate definitions', () => {
    const parallelRead = makeDefinition('inspect', TOOL_EXECUTION.read.parallel)
    const malformed = {
      ...makeDefinition('malformed', TOOL_EXECUTION.write),
      execution: { effect: 'write', mode: 'parallel' }
    } as unknown as MCPToolDefinition

    expect(selectMode(['inspect', 'missing'], [parallelRead])).toBe('sequential')
    expect(selectMode(['malformed', 'malformed'], [malformed])).toBe('sequential')
    expect(selectMode(['inspect', 'inspect'], [parallelRead, { ...parallelRead }])).toBe(
      'sequential'
    )
  })
})
