import type { Prompt } from '@shared/types/prompt'
import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteSystemPromptRoute,
  configGetDefaultSystemPromptRoute,
  configGetSystemPromptsRoute,
  configListCustomPromptsRoute,
  configResetDefaultSystemPromptRoute,
  configSetCustomPromptsRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetSystemPromptsRoute,
  configUpdateCustomPromptRoute,
  configUpdateSystemPromptRoute,
  type DeepchatRouteName,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { PromptSettings } from './promptSettings'

type PromptRouteHandler = (rawInput: unknown) => Promise<unknown>

export function createPromptRoutes(deps: {
  settings: PromptSettings
  recordActivity(input: SettingsActivityInput): void
}): ReadonlyMap<DeepchatRouteName, PromptRouteHandler> {
  const state = async () => {
    const [prompts, defaultPromptId, prompt] = await Promise.all([
      deps.settings.getSystemPrompts(),
      deps.settings.getDefaultSystemPromptId(),
      deps.settings.getDefaultSystemPrompt()
    ])
    return { prompts, defaultPromptId, prompt }
  }
  const record = (
    action: SettingsActivityInput['action'],
    targetType: string,
    targetLabel: string,
    targetId: string | null = null
  ): void => {
    deps.recordActivity({
      category: 'prompt',
      action,
      targetType,
      targetId,
      targetLabel,
      routeName: 'settings-prompt',
      summaryKey: 'settings.controlCenter.activity.settingUpdated',
      summaryParams: { key: targetLabel }
    })
  }

  return new Map<DeepchatRouteName, PromptRouteHandler>([
    [
      configListCustomPromptsRoute.name,
      async (rawInput) => {
        configListCustomPromptsRoute.input.parse(rawInput)
        return configListCustomPromptsRoute.output.parse({
          prompts: await deps.settings.getCustomPrompts()
        })
      }
    ],
    [
      configSetCustomPromptsRoute.name,
      async (rawInput) => {
        const input = configSetCustomPromptsRoute.input.parse(rawInput)
        await deps.settings.setCustomPrompts(input.prompts as Prompt[])
        record('updated', 'custom-prompts', `custom prompts (${input.prompts.length})`)
        return configSetCustomPromptsRoute.output.parse({
          prompts: await deps.settings.getCustomPrompts()
        })
      }
    ],
    [
      configAddCustomPromptRoute.name,
      async (rawInput) => {
        const input = configAddCustomPromptRoute.input.parse(rawInput)
        await deps.settings.addCustomPrompt(input.prompt as Prompt)
        record('created', 'custom-prompt', input.prompt.name, input.prompt.id)
        return configAddCustomPromptRoute.output.parse({
          prompts: await deps.settings.getCustomPrompts()
        })
      }
    ],
    [
      configUpdateCustomPromptRoute.name,
      async (rawInput) => {
        const input = configUpdateCustomPromptRoute.input.parse(rawInput)
        await deps.settings.updateCustomPrompt(input.promptId, input.updates as Partial<Prompt>)
        record('updated', 'custom-prompt', input.updates.name ?? input.promptId, input.promptId)
        return configUpdateCustomPromptRoute.output.parse({
          prompts: await deps.settings.getCustomPrompts()
        })
      }
    ],
    [
      configDeleteCustomPromptRoute.name,
      async (rawInput) => {
        const input = configDeleteCustomPromptRoute.input.parse(rawInput)
        await deps.settings.deleteCustomPrompt(input.promptId)
        record('removed', 'custom-prompt', input.promptId, input.promptId)
        return configDeleteCustomPromptRoute.output.parse({
          prompts: await deps.settings.getCustomPrompts()
        })
      }
    ],
    [
      configGetSystemPromptsRoute.name,
      async (rawInput) => {
        configGetSystemPromptsRoute.input.parse(rawInput)
        const current = await state()
        return configGetSystemPromptsRoute.output.parse(current)
      }
    ],
    [
      configSetSystemPromptsRoute.name,
      async (rawInput) => {
        const input = configSetSystemPromptsRoute.input.parse(rawInput)
        await deps.settings.setSystemPrompts(input.prompts)
        record('updated', 'system-prompts', `system prompts (${input.prompts.length})`)
        return configSetSystemPromptsRoute.output.parse(await state())
      }
    ],
    [
      configAddSystemPromptRoute.name,
      async (rawInput) => {
        const input = configAddSystemPromptRoute.input.parse(rawInput)
        await deps.settings.addSystemPrompt(input.prompt)
        record('created', 'system-prompt', input.prompt.name, input.prompt.id)
        return configAddSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configUpdateSystemPromptRoute.name,
      async (rawInput) => {
        const input = configUpdateSystemPromptRoute.input.parse(rawInput)
        await deps.settings.updateSystemPrompt(input.promptId, input.updates)
        record('updated', 'system-prompt', input.updates.name ?? input.promptId, input.promptId)
        return configUpdateSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configDeleteSystemPromptRoute.name,
      async (rawInput) => {
        const input = configDeleteSystemPromptRoute.input.parse(rawInput)
        await deps.settings.deleteSystemPrompt(input.promptId)
        record('removed', 'system-prompt', input.promptId, input.promptId)
        return configDeleteSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configGetDefaultSystemPromptRoute.name,
      async (rawInput) => {
        configGetDefaultSystemPromptRoute.input.parse(rawInput)
        return configGetDefaultSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configSetDefaultSystemPromptRoute.name,
      async (rawInput) => {
        const input = configSetDefaultSystemPromptRoute.input.parse(rawInput)
        await deps.settings.setDefaultSystemPrompt(input.prompt)
        record('updated', 'default-system-prompt', 'default system prompt')
        return configSetDefaultSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configResetDefaultSystemPromptRoute.name,
      async (rawInput) => {
        configResetDefaultSystemPromptRoute.input.parse(rawInput)
        await deps.settings.resetToDefaultPrompt()
        record('updated', 'default-system-prompt', 'default system prompt')
        return configResetDefaultSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configClearDefaultSystemPromptRoute.name,
      async (rawInput) => {
        configClearDefaultSystemPromptRoute.input.parse(rawInput)
        await deps.settings.clearSystemPrompt()
        record('updated', 'default-system-prompt', 'default system prompt')
        return configClearDefaultSystemPromptRoute.output.parse(await state())
      }
    ],
    [
      configSetDefaultSystemPromptIdRoute.name,
      async (rawInput) => {
        const input = configSetDefaultSystemPromptIdRoute.input.parse(rawInput)
        await deps.settings.setDefaultSystemPromptId(input.promptId)
        record('updated', 'default-system-prompt', input.promptId)
        return configSetDefaultSystemPromptIdRoute.output.parse(await state())
      }
    ]
  ])
}
