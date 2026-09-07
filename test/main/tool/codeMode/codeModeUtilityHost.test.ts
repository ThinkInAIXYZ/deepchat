import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createCodeModeRuntimeContext,
  type CodeModeContextBridge
} from '@/tool/codeMode/codeModeUtilityHost'

const binding = {
  id: 'binding-1',
  name: 'exec',
  description: 'Run a command.',
  execution: 'sequential' as const
}

function createRuntime(
  frontend: 'codex' | 'function',
  invoke: CodeModeContextBridge['invoke'] = vi.fn(async () =>
    JSON.stringify({ ok: true, hasValue: true, value: { answer: 42 } })
  )
) {
  const output: unknown[] = []
  const runtime = createCodeModeRuntimeContext(
    {
      name: 'code-mode-test',
      frontend,
      bindings: [binding],
      store: {}
    },
    {
      invoke,
      append: (value) => output.push(JSON.parse(value)),
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn(),
      yield: vi.fn(async () => undefined)
    }
  )
  return { runtime, output }
}

describe('Code Mode VM context', () => {
  it('keeps host constructors outside the model context', async () => {
    const { runtime } = createRuntime('codex')

    expect(() =>
      new vm.Script(`text.constructor('return process')()`).runInContext(runtime.context)
    ).toThrow(/Code generation from strings disallowed/)
    expect(() =>
      new vm.Script(`tools.exec.constructor('return process')()`).runInContext(runtime.context)
    ).toThrow(/Code generation from strings disallowed/)

    await expect(
      new vm.Script(`(async () => {
        const value = await tools.exec({})
        return value.constructor.constructor('return process')()
      })()`).runInContext(runtime.context)
    ).rejects.toThrow(/Code generation from strings disallowed/)
  })

  it('serializes Codex output and store without exposing the bridge', () => {
    const { runtime, output } = createRuntime('codex')
    const value = new vm.Script(`
      text({ ok: true })
      store('selection', { id: 7 })
      ;({ loaded: load('selection'), names: ALL_TOOLS.map((tool) => tool.name) })
    `).runInContext(runtime.context)

    expect(output).toEqual([{ type: 'text', text: '{"ok":true}' }])
    expect(JSON.parse(runtime.serializeStore())).toEqual({ selection: { id: 7 } })
    expect(JSON.parse(runtime.serializeValue(value))).toEqual({
      hasValue: true,
      value: { loaded: { id: 7 }, names: ['exec'] }
    })
  })

  it('recreates nested failures as context-native ToolCallError values', async () => {
    const { runtime } = createRuntime(
      'function',
      vi.fn(async () => JSON.stringify({ ok: false, error: 'permission denied' }))
    )
    const result = await new vm.Script(`(async () => {
      try {
        await tools.exec({})
      } catch (error) {
        return {
          name: error.name,
          toolName: error.toolName,
          message: error.message,
          native: error instanceof ToolCallError
        }
      }
    })()`).runInContext(runtime.context)

    expect(JSON.parse(runtime.serializeValue(result))).toEqual({
      hasValue: true,
      value: {
        name: 'ToolCallError',
        toolName: 'exec',
        message: 'permission denied',
        native: true
      }
    })
  })
})
