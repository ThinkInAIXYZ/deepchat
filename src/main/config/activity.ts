import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteSystemPromptRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configSetCustomPromptsRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetKnowledgeConfigsRoute,
  configSetSystemPromptsRoute,
  configUpdateCustomPromptRoute,
  configUpdateSystemPromptRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'

function readPromptUpdateName(input: unknown): string | null {
  if (!input || typeof input !== 'object' || !('updates' in input)) {
    return null
  }

  const updates = (input as { updates?: { name?: unknown } }).updates
  return updates && typeof updates.name === 'string' ? updates.name : null
}

export function recordConfigRouteActivity(
  recordActivity: (activity: SettingsActivityInput) => void,
  routeName: string,
  rawInput: unknown
): void {
  try {
    switch (routeName) {
      case configSetKnowledgeConfigsRoute.name: {
        const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
        recordActivity({
          category: 'knowledge',
          action: 'updated',
          targetType: 'knowledge-configs',
          targetLabel: 'Knowledge sources',
          routeName: 'settings-knowledge-base',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `knowledge sources (${input.configs.length})`
          }
        })
        return
      }
      case configSetCustomPromptsRoute.name: {
        const input = configSetCustomPromptsRoute.input.parse(rawInput)
        recordActivity({
          category: 'prompt',
          action: 'updated',
          targetType: 'custom-prompts',
          targetLabel: 'Custom prompts',
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `custom prompts (${input.prompts.length})`
          }
        })
        return
      }
      case configAddCustomPromptRoute.name:
      case configUpdateCustomPromptRoute.name:
      case configDeleteCustomPromptRoute.name: {
        const input =
          routeName === configAddCustomPromptRoute.name
            ? configAddCustomPromptRoute.input.parse(rawInput)
            : routeName === configUpdateCustomPromptRoute.name
              ? configUpdateCustomPromptRoute.input.parse(rawInput)
              : configDeleteCustomPromptRoute.input.parse(rawInput)
        const targetId =
          'prompt' in input ? input.prompt.id : 'promptId' in input ? input.promptId : null
        const targetLabel =
          'prompt' in input
            ? input.prompt.name
            : readPromptUpdateName(input)
              ? readPromptUpdateName(input)!
              : (targetId ?? 'custom prompt')
        recordActivity({
          category: 'prompt',
          action:
            routeName === configAddCustomPromptRoute.name
              ? 'created'
              : routeName === configDeleteCustomPromptRoute.name
                ? 'removed'
                : 'updated',
          targetType: 'custom-prompt',
          targetId,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configSetSystemPromptsRoute.name: {
        const input = configSetSystemPromptsRoute.input.parse(rawInput)
        recordActivity({
          category: 'prompt',
          action: 'updated',
          targetType: 'system-prompts',
          targetLabel: 'System prompts',
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: `system prompts (${input.prompts.length})`
          }
        })
        return
      }
      case configAddSystemPromptRoute.name:
      case configUpdateSystemPromptRoute.name:
      case configDeleteSystemPromptRoute.name: {
        const input =
          routeName === configAddSystemPromptRoute.name
            ? configAddSystemPromptRoute.input.parse(rawInput)
            : routeName === configUpdateSystemPromptRoute.name
              ? configUpdateSystemPromptRoute.input.parse(rawInput)
              : configDeleteSystemPromptRoute.input.parse(rawInput)
        const targetId =
          'prompt' in input ? input.prompt.id : 'promptId' in input ? input.promptId : null
        const targetLabel =
          'prompt' in input
            ? input.prompt.name
            : readPromptUpdateName(input)
              ? readPromptUpdateName(input)!
              : (targetId ?? 'system prompt')
        recordActivity({
          category: 'prompt',
          action:
            routeName === configAddSystemPromptRoute.name
              ? 'created'
              : routeName === configDeleteSystemPromptRoute.name
                ? 'removed'
                : 'updated',
          targetType: 'system-prompt',
          targetId,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configSetDefaultSystemPromptRoute.name:
      case configResetDefaultSystemPromptRoute.name:
      case configClearDefaultSystemPromptRoute.name:
      case configSetDefaultSystemPromptIdRoute.name: {
        const targetLabel =
          routeName === configSetDefaultSystemPromptIdRoute.name
            ? configSetDefaultSystemPromptIdRoute.input.parse(rawInput).promptId
            : 'default system prompt'
        recordActivity({
          category: 'prompt',
          action: 'updated',
          targetType: 'default-system-prompt',
          targetId: null,
          targetLabel,
          routeName: 'settings-prompt',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: targetLabel
          }
        })
        return
      }
      case configResetShortcutKeysRoute.name: {
        configResetShortcutKeysRoute.input.parse(rawInput)
        recordActivity({
          category: 'shortcut',
          action: 'reset',
          targetType: 'shortcut',
          targetLabel: 'Shortcuts',
          routeName: 'settings-shortcut',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: {
            key: 'shortcuts'
          }
        })
      }
    }
  } catch (error) {
    console.warn('[SettingsActivity] Failed to record config route activity:', error)
  }
}
