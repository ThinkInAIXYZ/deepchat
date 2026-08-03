import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT, PromptSettings } from '@/agent/promptSettings'
import { DEEPCHAT_SUBAGENT_MODEL_GUIDANCE } from '@shared/lib/deepchatSubagents'
import type { SettingsStore } from '@/config/settingsStore'

describe('default system prompt', () => {
  it('uses the shared conservative Subagent delegation guidance', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE)
    expect(DEFAULT_SYSTEM_PROMPT).toContain('When `deepchat_subagents` is available')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('use them when requested and available')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('For proactive delegation')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('Do not proactively delegate simple')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('untrusted evidence')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('never overrides the current session')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('Account for every spawned child')
    expect(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE).toContain('do not interrupt merely to avoid waiting')
  })

  it('resets the persisted default item and publishes one canonical state', async () => {
    const values = new Map<string, unknown>([
      [
        'systemPrompts',
        [
          {
            id: 'default',
            name: 'Default',
            content: 'Stale renderer copy',
            isDefault: true,
            updatedAt: 1
          }
        ]
      ],
      ['default_system_prompt', 'Stale renderer copy']
    ])
    const settings = {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => {
        values.set(key, value)
      }
    } as SettingsStore
    const publishSystemPromptsChanged = vi.fn()
    const promptSettings = new PromptSettings(settings, {
      publishCustomPromptsChanged: vi.fn(),
      publishSystemPromptsChanged
    })

    await promptSettings.resetToDefaultPrompt()

    expect(values.get('default_system_prompt')).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(values.get('systemPrompts')).toEqual([
      expect.objectContaining({
        id: 'default',
        content: DEFAULT_SYSTEM_PROMPT,
        isDefault: true
      })
    ])
    expect(publishSystemPromptsChanged).toHaveBeenCalledTimes(1)
    expect(publishSystemPromptsChanged).toHaveBeenCalledWith({
      prompts: [
        expect.objectContaining({
          id: 'default',
          content: DEFAULT_SYSTEM_PROMPT,
          isDefault: true
        })
      ],
      defaultPromptId: 'default',
      prompt: DEFAULT_SYSTEM_PROMPT
    })
  })
})
