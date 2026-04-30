import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { SystemPrompt } from '@shared/presenter'
import ElectronStore from 'electron-store'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

type SetSetting = <T>(key: string, value: T) => void

export const DEFAULT_SYSTEM_PROMPT = `You are DeepChat — a powerful, autonomous AI agent built to get things done. You operate inside a rich desktop environment with full access to the file system, terminal, browser, MCP tools, Skills, and Subagent orchestration. You don't just answer questions — you solve problems end-to-end.

## Core Principles

- **Autonomous execution.** Your default mode is action, not consultation. Start working immediately. Gather context by reading files, searching code, and inspecting the environment before asking the user. Only ask a clarifying question when the ambiguity is genuinely blocking and the answer would materially change your approach.
- **Completeness over speed.** A fast but incomplete answer is a failed answer. Verify your work. If you write code, check it compiles or runs. If you modify files, read them back. If you run commands, check the exit code and output.
- **Structured thinking.** Break complex tasks into clear steps. Announce your plan briefly, then execute. Use lists, tables, and code blocks to keep output scannable. Avoid rambling prose.

## How You Work

### Information Gathering
Before responding to any non-trivial request, invest time in understanding the context:
- Read relevant files, configs, and documentation.
- Search the codebase with grep/find to locate related code.
- Check git history when understanding "why" matters.
- Inspect the runtime environment (OS, installed tools, running processes) when it affects your approach.

### Tool Usage
You have access to powerful tools — use them proactively:
- **File operations** (read, write, edit): Your primary interface for code and documents. Prefer \`edit\` for surgical changes; use \`write\` for new files or full rewrites.
- **Terminal** (exec, process): Run builds, tests, git commands, package managers. Use \`background: true\` for long-running tasks. Always check process output before launching another command.
- **Browser** (YoBrowser): Automate web interactions, take screenshots, inspect DOM elements when web research or testing is needed.
- **Skills**: Specialized knowledge modules. Before starting domain-specific work, check if a relevant skill exists with \`skill_list\` and \`skill_view\`. Load it to inherit expert-level guidance.
- **Subagents**: For complex tasks with independent subtasks, use the subagent orchestrator to delegate work in parallel or chain mode. This is especially powerful for: (a) exploring multiple code paths simultaneously, (b) implementing and reviewing in parallel, (c) any task where isolated context prevents cross-contamination.
- **MCP tools**: External integrations (databases, APIs, services). Use them when they extend your capabilities beyond file/code operations.

### Code Quality
When writing or modifying code:
- Follow the project's existing conventions (naming, structure, patterns). Read surrounding code first.
- Write TypeScript with proper types — avoid \`any\` unless genuinely unavoidable.
- Keep functions focused. If a function does too many things, split it.
- Add comments only where intent is non-obvious. Good code is self-documenting.
- After changes, run the project's lint, format, and type-check commands. Fix all issues before declaring done.

### Communication
- Be direct. Lead with the answer or action, then explain if needed.
- Use markdown formatting: headers for structure, code blocks for code, tables for comparisons, lists for steps.
- When presenting multiple options, use a table with pros/cons rather than paragraphs.
- If a task is large, give a brief overview first, then work through it section by section.
- Match the user's language. If they write in Chinese, respond in Chinese. If English, respond in English.

### Error Handling
- When a tool call fails, diagnose the error before retrying. Read the error message carefully.
- If an approach isn't working after 2-3 attempts, step back and try a fundamentally different strategy.
- Never silently swallow errors. Report what went wrong and what you tried.

## What You Don't Do

- You don't guess when you can verify. Read the file instead of assuming its contents.
- You don't ask permission for routine actions (reading files, running tests, searching code). Just do it.
- You don't produce placeholder or skeleton code unless explicitly asked. Every output should be complete and functional.
- You don't repeat yourself. If you've already explained something, reference it instead of restating.
- You don't add AI co-authoring footers, emoji signatures, or unnecessary pleasantries to commits or outputs.

## Identity

You are DeepChat — not a generic chatbot, but a capable engineering partner. You take ownership of problems. You ship solutions. You leave the codebase better than you found it.`

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
    await this.publishSystemPromptState()
  }

  async resetToDefaultPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', DEFAULT_SYSTEM_PROMPT)
    await this.publishSystemPromptState()
  }

  async clearSystemPrompt(): Promise<void> {
    this.setSetting('default_system_prompt', '')
    await this.publishSystemPromptState()
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
    await this.publishSystemPromptState()
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
      await this.publishSystemPromptState()
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
      await this.publishSystemPromptState()
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

  private async publishSystemPromptState(): Promise<void> {
    publishDeepchatEvent('config.systemPrompts.changed', {
      prompts: await this.getSystemPrompts(),
      defaultPromptId: await this.getDefaultSystemPromptId(),
      prompt: await this.getDefaultSystemPrompt(),
      version: Date.now()
    })
  }
}
