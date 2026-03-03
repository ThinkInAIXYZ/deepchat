import { describe, expect, it } from 'vitest'
import type { MCPToolDefinition, PromptListEntry } from '@shared/presenter'
import {
  flattenPromptResultToText,
  resolveSlashSelectionAction,
  sortSlashSuggestionItems,
  type SlashSuggestionItem
} from '@/components/chat/mentions/utils'

describe('flattenPromptResultToText', () => {
  it('extracts ordered text segments from prompt messages', () => {
    const promptResult = {
      messages: [
        { role: 'user', content: { type: 'text', text: 'First block' } },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Second block' },
            { type: 'text', text: 'Third block' }
          ]
        }
      ]
    }

    expect(flattenPromptResultToText(promptResult)).toBe(
      'First block\n\nSecond block\n\nThird block'
    )
  })

  it('handles plain text prompt result', () => {
    expect(flattenPromptResultToText('  quick prompt  ')).toBe('quick prompt')
  })
})

describe('resolveSlashSelectionAction', () => {
  it('dispatches command directly when no input hint', () => {
    const item: SlashSuggestionItem = {
      id: 'command:plan',
      category: 'command',
      label: '/plan',
      payload: { name: 'plan', description: 'run plan', input: null }
    }

    const action = resolveSlashSelectionAction(item)
    expect(action).toEqual({ kind: 'send-command', command: '/plan' })
  })

  it('requests command input when hint exists', () => {
    const item: SlashSuggestionItem = {
      id: 'command:review',
      category: 'command',
      label: '/review',
      payload: { name: 'review', description: 'run review', input: { hint: 'ticket id' } }
    }

    const action = resolveSlashSelectionAction(item)
    expect(action.kind).toBe('request-command-input')
  })

  it('activates skill without inserting text', () => {
    const item: SlashSuggestionItem = {
      id: 'skill:code-review',
      category: 'skill',
      label: 'code-review',
      payload: { name: 'code-review' }
    }

    const action = resolveSlashSelectionAction(item)
    expect(action).toEqual({ kind: 'activate-skill', skillName: 'code-review' })
  })

  it('inserts @toolName for tool selection', () => {
    const tool: MCPToolDefinition = {
      type: 'function',
      server: {
        name: 'deepchat-tools',
        icons: '',
        description: ''
      },
      function: {
        name: 'read_file',
        description: 'Read file content',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    }

    const item: SlashSuggestionItem = {
      id: 'tool:deepchat-tools:read_file',
      category: 'tool',
      label: 'read_file',
      payload: tool
    }

    const action = resolveSlashSelectionAction(item)
    expect(action).toEqual({ kind: 'insert-tool', text: '@read_file ' })
  })

  it('opens prompt args flow when prompt has arguments', () => {
    const prompt: PromptListEntry = {
      name: 'summarize',
      description: 'summary prompt',
      arguments: [{ name: 'topic', required: true }],
      client: { name: 'custom', icon: '' }
    }

    const item: SlashSuggestionItem = {
      id: 'prompt:custom:summarize',
      category: 'prompt',
      label: 'summarize',
      payload: prompt
    }

    const action = resolveSlashSelectionAction(item)
    expect(action.kind).toBe('request-prompt-args')
  })

  it('sorts slash entries by category: command > skill > prompt > tool', () => {
    const unordered: SlashSuggestionItem[] = [
      { id: 'tool:a', category: 'tool', label: 'z-tool', payload: {} as any },
      { id: 'prompt:a', category: 'prompt', label: 'b-prompt', payload: {} as any },
      { id: 'skill:a', category: 'skill', label: 'c-skill', payload: { name: 'c-skill' } },
      {
        id: 'command:a',
        category: 'command',
        label: '/do',
        payload: { name: 'do', description: '', input: null }
      }
    ]

    const sorted = sortSlashSuggestionItems(unordered)
    expect(sorted.map((item) => item.category)).toEqual(['command', 'skill', 'prompt', 'tool'])
  })
})
