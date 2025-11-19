import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { SystemPrompt } from '@shared/presenter'
import ElectronStore from 'electron-store'

type SetSetting = <T>(key: string, value: T) => void

export const DEFAULT_SYSTEM_PROMPT = `You are DeepChat, a highly capable AI assistant. Your goal is to fully complete the user’s requested task before handing the conversation back to them. Keep working autonomously until the task is fully resolved.
Be thorough in gathering information. Before replying, make sure you have all the details necessary to provide a complete solution. Use additional tools or ask clarifying questions when needed, but if you can find the answer on your own, avoid asking the user for help.
When using tools, briefly describe your intended steps first—for example, which tool you’ll use and for what purpose.
Adhere to this in all languages.Always respond in the same language as the user's query.`

type GetSetting = <T>(key: string) => T | undefined

interface SystemPromptHelperOptions {
  systemPromptsStore: ElectronStore<{ prompts: SystemPrompt[] }>
  getSetting: GetSetting
  setSetting: SetSetting
}

export class SystemPromptHelper {
  private readonly systemPromptsStore: ElectronStore<{ prompts: SystemPrompt[] }>
  private readonly getSetting: GetSetting
  private readonly setSetting: SetSetting

  constructor(options: SystemPromptHelperOptions) {
    this.systemPromptsStore = options.systemPromptsStore
    this.getSetting = options.getSetting
    this.setSetting = options.setSetting
  }

  async getDefaultSystemPrompt(): Promise<string> {
    const prompts = await this.getSystemPrompts()
    const defaultPrompt = prompts.find((p) => p.isDefault)
    if (defaultPrompt) {
      return defaultPrompt.content
    }
    return this.getSetting<string>('default_system_prompt') || ''
  }

  async setDefaultSystemPrompt(prompt: string): Promise<void> {
    this.setSetting('default_system_prompt', prompt)
  }

  async resetToDefaultPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', DEFAULT_SYSTEM_PROMPT)
  }

  async clearSystemPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', '')
  }

  async getSystemPrompts(): Promise<SystemPrompt[]> {
    try {
      return this.systemPromptsStore.get('prompts') || []
    } catch (error) {
      console.error('[SystemPromptHelper] Failed to load prompts:', error)
      return []
    }
  }

  async setSystemPrompts(prompts: SystemPrompt[]): Promise<void> {
    await this.systemPromptsStore.set('prompts', prompts)
  }

  async addSystemPrompt(prompt: SystemPrompt): Promise<void> {
    const prompts = await this.getSystemPrompts()
    prompts.push(prompt)
    await this.setSystemPrompts(prompts)
  }

  async updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const index = prompts.findIndex((p) => p.id === promptId)
    if (index !== -1) {
      prompts[index] = { ...prompts[index], ...updates }
      await this.setSystemPrompts(prompts)
    }
  }

  async deleteSystemPrompt(promptId: string): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const filteredPrompts = prompts.filter((p) => p.id !== promptId)
    await this.setSystemPrompts(filteredPrompts)
  }

  async setDefaultSystemPromptId(promptId: string): Promise<void> {
    const prompts = await this.getSystemPrompts()
    const updatedPrompts = prompts.map((p) => ({ ...p, isDefault: false }))

    if (promptId === 'empty') {
      await this.setSystemPrompts(updatedPrompts)
      await this.clearSystemPrompt()
      eventBus.send(CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED, SendTarget.ALL_WINDOWS, {
        promptId: 'empty',
        content: ''
      })
      return
    }

    const targetIndex = updatedPrompts.findIndex((p) => p.id === promptId)
    if (targetIndex !== -1) {
      updatedPrompts[targetIndex].isDefault = true
      await this.setSystemPrompts(updatedPrompts)
      await this.setDefaultSystemPrompt(updatedPrompts[targetIndex].content)
      eventBus.send(CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED, SendTarget.ALL_WINDOWS, {
        promptId,
        content: updatedPrompts[targetIndex].content
      })
    } else {
      await this.setSystemPrompts(updatedPrompts)
    }
  }

  async getDefaultSystemPromptId(): Promise<string> {
    const prompts = await this.getSystemPrompts()
    const defaultPrompt = prompts.find((p) => p.isDefault)
    if (defaultPrompt) {
      return defaultPrompt.id
    }

    const storedPrompt = this.getSetting<string>('default_system_prompt')
    if (!storedPrompt || storedPrompt.trim() === '') {
      return 'empty'
    }

    return prompts.find((p) => p.id === 'default')?.id || 'default'
  }
}
