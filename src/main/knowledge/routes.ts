import type { KnowledgeServicePort } from '@shared/types/knowledge'
import type { KnowledgeSettings } from './settings'
import {
  configGetKnowledgeConfigsRoute,
  configSetKnowledgeConfigsRoute,
  knowledgeAddFileRoute,
  knowledgeDeleteFileRoute,
  knowledgeGetSeparatorsForLanguageRoute,
  knowledgeGetSupportedFileExtensionsRoute,
  knowledgeGetSupportedLanguagesRoute,
  knowledgeIsSupportedRoute,
  knowledgeListFilesRoute,
  knowledgePauseAllRunningTasksRoute,
  knowledgeReAddFileRoute,
  knowledgeResumeAllPausedTasksRoute,
  knowledgeSimilarityQueryRoute,
  knowledgeValidateFileRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createKnowledgeRoutes(deps: {
  service: KnowledgeServicePort
  settings: KnowledgeSettings
  applyConfigChange(): Promise<void>
  recordActivity(input: SettingsActivityInput): void
}): DeepchatRouteMap {
  const { service } = deps
  return createRouteMap([
    [
      configGetKnowledgeConfigsRoute.name,
      async (rawInput) => {
        configGetKnowledgeConfigsRoute.input.parse(rawInput)
        return configGetKnowledgeConfigsRoute.output.parse({
          configs: deps.settings.getKnowledgeConfigs()
        })
      }
    ],
    [
      configSetKnowledgeConfigsRoute.name,
      async (rawInput) => {
        const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
        deps.settings.setKnowledgeConfigs(input.configs)
        await deps.applyConfigChange()
        deps.recordActivity({
          category: 'knowledge',
          action: 'updated',
          targetType: 'knowledge-configs',
          targetLabel: 'Knowledge sources',
          routeName: 'settings-knowledge-base',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: `knowledge sources (${input.configs.length})` }
        })
        return configSetKnowledgeConfigsRoute.output.parse({
          configs: deps.settings.getKnowledgeConfigs()
        })
      }
    ],
    [
      knowledgeIsSupportedRoute.name,
      async (rawInput) => {
        knowledgeIsSupportedRoute.input.parse(rawInput)
        return knowledgeIsSupportedRoute.output.parse({ supported: await service.isSupported() })
      }
    ],
    [
      knowledgeGetSupportedLanguagesRoute.name,
      async (rawInput) => {
        knowledgeGetSupportedLanguagesRoute.input.parse(rawInput)
        return knowledgeGetSupportedLanguagesRoute.output.parse({
          languages: await service.getSupportedLanguages()
        })
      }
    ],
    [
      knowledgeGetSeparatorsForLanguageRoute.name,
      async (rawInput) => {
        const input = knowledgeGetSeparatorsForLanguageRoute.input.parse(rawInput)
        return knowledgeGetSeparatorsForLanguageRoute.output.parse({
          separators: await service.getSeparatorsForLanguage(input.language)
        })
      }
    ],
    [
      knowledgeGetSupportedFileExtensionsRoute.name,
      async (rawInput) => {
        knowledgeGetSupportedFileExtensionsRoute.input.parse(rawInput)
        return knowledgeGetSupportedFileExtensionsRoute.output.parse({
          extensions: await service.getSupportedFileExtensions()
        })
      }
    ],
    [
      knowledgeListFilesRoute.name,
      async (rawInput) => {
        const input = knowledgeListFilesRoute.input.parse(rawInput)
        return knowledgeListFilesRoute.output.parse({
          files: await service.listFiles(input.knowledgeBaseId)
        })
      }
    ],
    [
      knowledgeSimilarityQueryRoute.name,
      async (rawInput) => {
        const input = knowledgeSimilarityQueryRoute.input.parse(rawInput)
        return knowledgeSimilarityQueryRoute.output.parse({
          results: await service.similarityQuery(input.knowledgeBaseId, input.query)
        })
      }
    ],
    [
      knowledgeValidateFileRoute.name,
      async (rawInput) => {
        const input = knowledgeValidateFileRoute.input.parse(rawInput)
        return knowledgeValidateFileRoute.output.parse({
          result: await service.validateFile(input.filePath)
        })
      }
    ],
    [
      knowledgeAddFileRoute.name,
      async (rawInput) => {
        const input = knowledgeAddFileRoute.input.parse(rawInput)
        return knowledgeAddFileRoute.output.parse({
          result: await service.addFile(input.knowledgeBaseId, input.filePath)
        })
      }
    ],
    [
      knowledgeDeleteFileRoute.name,
      async (rawInput) => {
        const input = knowledgeDeleteFileRoute.input.parse(rawInput)
        await service.deleteFile(input.knowledgeBaseId, input.fileId)
        return knowledgeDeleteFileRoute.output.parse({ deleted: true })
      }
    ],
    [
      knowledgeReAddFileRoute.name,
      async (rawInput) => {
        const input = knowledgeReAddFileRoute.input.parse(rawInput)
        return knowledgeReAddFileRoute.output.parse({
          result: await service.reAddFile(input.knowledgeBaseId, input.fileId)
        })
      }
    ],
    [
      knowledgePauseAllRunningTasksRoute.name,
      async (rawInput) => {
        const input = knowledgePauseAllRunningTasksRoute.input.parse(rawInput)
        await service.pauseAllRunningTasks(input.knowledgeBaseId)
        return knowledgePauseAllRunningTasksRoute.output.parse({ paused: true })
      }
    ],
    [
      knowledgeResumeAllPausedTasksRoute.name,
      async (rawInput) => {
        const input = knowledgeResumeAllPausedTasksRoute.input.parse(rawInput)
        await service.resumeAllPausedTasks(input.knowledgeBaseId)
        return knowledgeResumeAllPausedTasksRoute.output.parse({ resumed: true })
      }
    ]
  ])
}
