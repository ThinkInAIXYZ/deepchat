import { describe, expect, it } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import {
  createApplyPatchToolDefinition,
  createCodexCodeModeToolDefinitions,
  createRunCodeToolDefinition,
  createStrReplaceEditorToolDefinition,
  normalizeCodexToolName,
  renderCodeModeSdk
} from '@/tool/codeMode/toolModeTools'

const nestedTool: MCPToolDefinition = {
  execution: TOOL_EXECUTION.read,
  source: 'mcp',
  type: 'function',
  function: {
    name: 'mcp-demo/read-file',
    description: 'Read a file from the demo server.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  server: {
    name: 'demo',
    icons: '',
    description: 'Demo server'
  },
  raw: {
    name: 'mcp-demo/read-file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    }
  }
}

describe('Tool Mode provider contracts', () => {
  it('projects the Codex frontend as raw exec plus function wait', () => {
    const definitions = createCodexCodeModeToolDefinitions([nestedTool])
    const sdk = renderCodeModeSdk('codex', [nestedTool])

    expect(definitions.map((tool) => tool.function.name)).toEqual(['exec', 'wait'])
    expect(definitions[0]).toMatchObject({
      type: 'custom',
      providerPresentation: {
        type: 'freeform',
        format: { type: 'grammar', syntax: 'lark' }
      }
    })
    expect(definitions[0].function.description).toContain(
      'Runs raw JavaScript -- no Node, no file system, no network access, no console.'
    )
    expect(definitions[0].function.description).toContain(
      'declare const tools: { mcp_demo_read_file(args: { "path": string }): Promise<{ "content": string }>; };'
    )
    expect(sdk).toContain('Top-level tools for this turn: `exec`, `wait`.')
    expect(sdk).toContain('Every other enabled tool is a Code Mode subtool.')
    expect(sdk).toContain(
      'The top-level `exec` starts a Code Mode cell; `tools.exec` inside that cell runs the selected Shell command subtool.'
    )
    expect(definitions[1].function.parameters).toMatchObject({
      required: ['cell_id'],
      properties: {
        cell_id: { type: 'string' },
        yield_time_ms: { type: 'number' },
        max_tokens: { type: 'number' },
        terminate: { type: 'boolean' }
      }
    })
  })

  it('keeps apply_patch freeform and str_replace_editor function contracts distinct', () => {
    const applyPatch = createApplyPatchToolDefinition()
    const strReplace = createStrReplaceEditorToolDefinition()

    expect(applyPatch.function.name).toBe('apply_patch')
    expect(applyPatch.function.description).toBe(
      'The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON. If a multi-operation patch reports a partial failure, re-view every affected file before retrying.'
    )
    expect(applyPatch.providerPresentation).toMatchObject({
      type: 'freeform',
      format: { type: 'grammar', syntax: 'lark' }
    })
    expect(
      applyPatch.providerPresentation?.type === 'freeform'
        ? applyPatch.providerPresentation.format?.definition
        : ''
    ).toContain('begin_patch: "*** Begin Patch" LF')

    expect(strReplace.function.name).toBe('str_replace_editor')
    expect(strReplace.providerPresentation).toEqual({ type: 'function' })
    expect(strReplace.function.parameters).toMatchObject({
      required: ['command', 'path'],
      properties: {
        command: { enum: ['view', 'create', 'str_replace', 'insert'] },
        path: { type: 'string' }
      }
    })
  })

  it('uses one function-tool run_code entry and emits its TypeScript SDK', () => {
    const runCode = createRunCodeToolDefinition()
    const sdk = renderCodeModeSdk('function', [nestedTool])

    expect(runCode.function.name).toBe('run_code')
    expect(runCode.function.parameters).toMatchObject({
      required: ['code', 'description'],
      properties: {
        code: { type: 'string' },
        description: { type: 'string' }
      }
    })
    expect(runCode.function.description).toContain('`run_code` is the only code entrypoint')
    expect(runCode.function.description).toContain('Invoke subtools only inside `code`')
    expect(sdk).toContain('interface SubtoolArgsMap')
    expect(sdk).toContain('type SubtoolName = keyof SubtoolOutputMap')
    expect(sdk).toContain('"mcp-demo/read-file": { "path": string };')
    expect(sdk).toContain('"mcp-demo/read-file": { "content": string };')
    expect(sdk).toContain('declare class ToolCallError extends Error')
    expect(sdk).toContain('Top-level tools for this turn: `run_code`.')
    expect(sdk).toContain('Every other enabled tool is a Code Mode subtool.')
    expect(sdk).toContain(
      'Available Code Mode subtools (only callable inside `run_code.code` through `tools`)'
    )
    expect(sdk).toContain('Independent read-only calls MAY overlap under `Promise.all`')
  })

  it('omits direct Loop tools from generated SDK declarations', () => {
    const question = {
      ...nestedTool,
      function: { ...nestedTool.function, name: 'deepchat_question' }
    }
    const subagents = {
      ...nestedTool,
      function: { ...nestedTool.function, name: 'deepchat_subagents' }
    }

    const sdk = renderCodeModeSdk('function', [nestedTool, question, subagents])
    const codexDescription = createCodexCodeModeToolDefinitions([
      nestedTool,
      question,
      subagents
    ])[0].function.description

    expect(sdk).toContain(
      'Top-level tools for this turn: `run_code`, `deepchat_question`, `deepchat_subagents`.'
    )
    expect(sdk).not.toContain('deepchat_question:')
    expect(sdk).not.toContain('deepchat_subagents:')
    expect(codexDescription).toContain(
      'Top-level tools for this turn: `exec`, `wait`, `deepchat_question`, `deepchat_subagents`.'
    )
    expect(codexDescription).not.toContain('### `deepchat_question`')
    expect(codexDescription).not.toContain('### `deepchat_subagents`')
  })

  it('renders a mode-aware progress strategy for the update_plan subtool', () => {
    const updatePlan = {
      ...nestedTool,
      source: 'agent' as const,
      function: { ...nestedTool.function, name: 'update_plan' },
      raw: { ...nestedTool.raw, name: 'update_plan' }
    }

    const functionSdk = renderCodeModeSdk('function', [updatePlan])
    const codexDescription = createCodexCodeModeToolDefinitions([updatePlan])[0].function
      .description

    for (const prompt of [functionSdk, codexDescription]) {
      expect(prompt).toContain('## Progress Checklist in Code Mode')
      expect(prompt).toContain(
        'Use the `update_plan` subtool for non-trivial multi-step tasks by calling `await tools.update_plan(args)` inside the code entrypoint.'
      )
    }
    expect(functionSdk).toContain('Top-level tools for this turn: `run_code`.')
    expect(codexDescription).toContain('Top-level tools for this turn: `exec`, `wait`.')
  })

  it('uses trimmed names for both SDK declarations and runtime bindings', () => {
    const spaced = {
      ...nestedTool,
      function: { ...nestedTool.function, name: '  mcp-demo/read-file  ' }
    }

    const sdk = renderCodeModeSdk('function', [spaced])

    expect(sdk).toContain('"mcp-demo/read-file"')
    expect(sdk).not.toContain('  mcp-demo/read-file  ')
  })

  it('normalizes only the Codex JavaScript identifier projection', () => {
    expect(normalizeCodexToolName('mcp-demo/read-file')).toBe('mcp_demo_read_file')
    expect(normalizeCodexToolName('9patch')).toBe('_patch')
    expect(normalizeCodexToolName('exec')).toBe('exec')
  })
})
