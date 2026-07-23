import type { SkillServicePort } from '@shared/types/skill'
import type { SkillSyncServicePort } from '@shared/types/skillSync'
import type { SkillSettingsPort } from './settings'
import { AgentSkillImportService, type AgentSkillImportAgentPort } from './agentSkillImportService'
import {
  configGetSkillDraftSuggestionsRoute,
  configSetSkillDraftSuggestionsRoute,
  skillsExecuteSyncDirectoryExportRoute,
  skillsExecuteSyncDirectoryImportRoute,
  skillsExecuteAgentImportRoute,
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsGetSyncConfigRoute,
  skillsInstallFromFolderRoute,
  skillsInstallFromGitRoute,
  skillsInstallFromUrlRoute,
  skillsInstallFromZipRoute,
  skillsListCatalogRoute,
  skillsListAgentImportSourcesRoute,
  skillsListMetadataRoute,
  skillsListScriptsRoute,
  skillsOpenFolderRoute,
  skillsPreviewSyncDirectoryExportRoute,
  skillsPreviewSyncDirectoryImportRoute,
  skillsPreviewAgentImportRoute,
  skillsReadFileRoute,
  skillsSaveExtensionRoute,
  skillsSaveWithExtensionRoute,
  skillsScanGitRepoRoute,
  skillsSetActiveRoute,
  skillsSetDisabledRoute,
  skillsSetSyncDirectoryRoute,
  skillsUninstallRoute,
  skillsUpdateFileRoute,
  skillSyncAcknowledgeDiscoveriesRoute,
  skillSyncGetAgentDetailRoute,
  skillSyncGetAgentSkillDetailRoute,
  skillSyncGetNewDiscoveriesRoute,
  skillSyncGetRegisteredToolsRoute,
  skillSyncRemoveAgentSkillLinkRoute,
  skillSyncRepairAgentSkillLinkRoute,
  skillSyncScanAgentsRoute,
  skillSyncScanExternalToolsRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createSkillRoutes(deps: {
  skillService: SkillServicePort
  skillSyncService: SkillSyncServicePort
  skillSettings: SkillSettingsPort
  agentSettings: AgentSkillImportAgentPort
  ensureInitialized(): Promise<void>
  recordSettingsActivity(input: SettingsActivityInput): Promise<unknown>
}): DeepchatRouteMap {
  const { skillService, skillSyncService } = deps
  const agentSkillImportService = new AgentSkillImportService({
    agents: deps.agentSettings,
    skills: skillService,
    external: skillSyncService
  })
  const recordActivity = (input: SettingsActivityInput): void => {
    void deps.recordSettingsActivity(input).catch((error) => {
      console.warn('[SettingsActivity] Failed to record skill activity:', error)
    })
  }
  const recordSkillActivity = (
    action: SettingsActivityInput['action'],
    label: string,
    targetType = 'skill'
  ): void => {
    recordActivity({
      category: 'knowledge',
      action,
      targetType,
      targetId: label,
      targetLabel: label,
      routeName: 'settings-skills',
      summaryKey: 'settings.controlCenter.activity.settingUpdated',
      summaryParams: { key: label }
    })
  }
  const didSucceed = (result: { success?: boolean }): boolean => result.success === true

  const routes = createRouteMap([
    [
      configGetSkillDraftSuggestionsRoute.name,
      async (rawInput) => {
        configGetSkillDraftSuggestionsRoute.input.parse(rawInput)
        return configGetSkillDraftSuggestionsRoute.output.parse({
          enabled: deps.skillSettings.isDraftSuggestionsEnabled()
        })
      }
    ],
    [
      configSetSkillDraftSuggestionsRoute.name,
      async (rawInput) => {
        const input = configSetSkillDraftSuggestionsRoute.input.parse(rawInput)
        deps.skillSettings.setDraftSuggestionsEnabled(input.enabled)
        return configSetSkillDraftSuggestionsRoute.output.parse({
          enabled: deps.skillSettings.isDraftSuggestionsEnabled()
        })
      }
    ],
    [
      skillsListMetadataRoute.name,
      async (rawInput) => {
        const input = skillsListMetadataRoute.input.parse(rawInput)
        return skillsListMetadataRoute.output.parse({
          skills: await skillService.getMetadataList(input.agentId)
        })
      }
    ],
    [
      skillsListCatalogRoute.name,
      async (rawInput) => {
        const input = skillsListCatalogRoute.input.parse(rawInput)
        return skillsListCatalogRoute.output.parse({
          skills: await skillService.getUnifiedSkillCatalog(input.agentId)
        })
      }
    ],
    [
      skillsSetDisabledRoute.name,
      async (rawInput) => {
        const input = skillsSetDisabledRoute.input.parse(rawInput)
        await skillService.setSkillDisabledForAgent(input.agentId, input.name, input.disabled)
        recordSkillActivity('updated', input.name, 'skill-disabled-state')
        return skillsSetDisabledRoute.output.parse({ saved: true })
      }
    ],
    [
      skillsGetDirectoryRoute.name,
      async (rawInput) => {
        const input = skillsGetDirectoryRoute.input.parse(rawInput)
        return skillsGetDirectoryRoute.output.parse({
          path: await skillService.getSkillsDir(input.agentId)
        })
      }
    ],
    [
      skillsInstallFromFolderRoute.name,
      async (rawInput) => {
        const input = skillsInstallFromFolderRoute.input.parse(rawInput)
        const result = await skillService.installFromFolderForAgent(
          input.agentId,
          input.folderPath,
          input.options
        )
        if (didSucceed(result)) recordSkillActivity('created', 'skill folder source')
        return skillsInstallFromFolderRoute.output.parse({ result })
      }
    ],
    [
      skillsInstallFromZipRoute.name,
      async (rawInput) => {
        const input = skillsInstallFromZipRoute.input.parse(rawInput)
        const result = await skillService.installFromZipForAgent(
          input.agentId,
          input.zipPath,
          input.options
        )
        if (didSucceed(result)) recordSkillActivity('created', 'skill zip source')
        return skillsInstallFromZipRoute.output.parse({ result })
      }
    ],
    [
      skillsInstallFromUrlRoute.name,
      async (rawInput) => {
        const input = skillsInstallFromUrlRoute.input.parse(rawInput)
        const result = await skillService.installFromUrlForAgent(
          input.agentId,
          input.url,
          input.options
        )
        if (didSucceed(result)) recordSkillActivity('created', 'skill URL source')
        return skillsInstallFromUrlRoute.output.parse({ result })
      }
    ],
    [
      skillsScanGitRepoRoute.name,
      async (rawInput) => {
        const input = skillsScanGitRepoRoute.input.parse(rawInput)
        return skillsScanGitRepoRoute.output.parse({
          result: await skillService.scanGitSkillRepoForAgent(input.agentId, input.repoUrl)
        })
      }
    ],
    [
      skillsInstallFromGitRoute.name,
      async (rawInput) => {
        const input = skillsInstallFromGitRoute.input.parse(rawInput)
        const results = await skillService.installSkillsFromGitForAgent(input.agentId, input)
        if (results.some(didSucceed)) recordSkillActivity('created', 'skill Git source')
        return skillsInstallFromGitRoute.output.parse({ results })
      }
    ],
    [
      skillsGetSyncConfigRoute.name,
      async (rawInput) => {
        skillsGetSyncConfigRoute.input.parse(rawInput)
        return skillsGetSyncConfigRoute.output.parse({
          config: await skillService.getSkillsSyncConfig()
        })
      }
    ],
    [
      skillsSetSyncDirectoryRoute.name,
      async (rawInput) => {
        const input = skillsSetSyncDirectoryRoute.input.parse(rawInput)
        return skillsSetSyncDirectoryRoute.output.parse({
          config: await skillService.setSkillsSyncDirectory(input)
        })
      }
    ],
    [
      skillsPreviewSyncDirectoryExportRoute.name,
      async (rawInput) => {
        const input = skillsPreviewSyncDirectoryExportRoute.input.parse(rawInput)
        return skillsPreviewSyncDirectoryExportRoute.output.parse({
          preview: await skillService.previewSyncDirectoryExport(input)
        })
      }
    ],
    [
      skillsExecuteSyncDirectoryExportRoute.name,
      async (rawInput) => {
        const input = skillsExecuteSyncDirectoryExportRoute.input.parse(rawInput)
        return skillsExecuteSyncDirectoryExportRoute.output.parse({
          result: await skillService.executeSyncDirectoryExport(input)
        })
      }
    ],
    [
      skillsPreviewSyncDirectoryImportRoute.name,
      async (rawInput) => {
        skillsPreviewSyncDirectoryImportRoute.input.parse(rawInput)
        return skillsPreviewSyncDirectoryImportRoute.output.parse({
          preview: await skillService.previewSyncDirectoryImport()
        })
      }
    ],
    [
      skillsExecuteSyncDirectoryImportRoute.name,
      async (rawInput) => {
        const input = skillsExecuteSyncDirectoryImportRoute.input.parse(rawInput)
        return skillsExecuteSyncDirectoryImportRoute.output.parse({
          result: await skillService.executeSyncDirectoryImport(input)
        })
      }
    ],
    [
      skillsUninstallRoute.name,
      async (rawInput) => {
        const input = skillsUninstallRoute.input.parse(rawInput)
        const result = await skillService.uninstallSkillForAgent(input.agentId, input.name)
        if (didSucceed(result)) recordSkillActivity('removed', input.name)
        return skillsUninstallRoute.output.parse({ result })
      }
    ],
    [
      skillsReadFileRoute.name,
      async (rawInput) => {
        const input = skillsReadFileRoute.input.parse(rawInput)
        return skillsReadFileRoute.output.parse({
          content: await skillService.readSkillFileForAgent(input.agentId, input.name)
        })
      }
    ],
    [
      skillsUpdateFileRoute.name,
      async (rawInput) => {
        const input = skillsUpdateFileRoute.input.parse(rawInput)
        const result = await skillService.updateSkillFileForAgent(
          input.agentId,
          input.name,
          input.content
        )
        if (didSucceed(result)) recordSkillActivity('updated', input.name)
        return skillsUpdateFileRoute.output.parse({ result })
      }
    ],
    [
      skillsSaveWithExtensionRoute.name,
      async (rawInput) => {
        const input = skillsSaveWithExtensionRoute.input.parse(rawInput)
        const result = await skillService.saveSkillWithExtensionForAgent(
          input.agentId,
          input.name,
          input.content,
          input.config
        )
        if (didSucceed(result)) recordSkillActivity('updated', input.name)
        return skillsSaveWithExtensionRoute.output.parse({ result })
      }
    ],
    [
      skillsGetFolderTreeRoute.name,
      async (rawInput) => {
        const input = skillsGetFolderTreeRoute.input.parse(rawInput)
        return skillsGetFolderTreeRoute.output.parse({
          nodes: await skillService.getSkillFolderTreeForAgent(input.agentId, input.name)
        })
      }
    ],
    [
      skillsOpenFolderRoute.name,
      async (rawInput) => {
        const input = skillsOpenFolderRoute.input.parse(rawInput)
        await skillService.openSkillsFolderForAgent(input.agentId)
        return skillsOpenFolderRoute.output.parse({ opened: true })
      }
    ],
    [
      skillsGetExtensionRoute.name,
      async (rawInput) => {
        const input = skillsGetExtensionRoute.input.parse(rawInput)
        return skillsGetExtensionRoute.output.parse({
          config: await skillService.getSkillExtensionForAgent(input.agentId, input.name)
        })
      }
    ],
    [
      skillsSaveExtensionRoute.name,
      async (rawInput) => {
        const input = skillsSaveExtensionRoute.input.parse(rawInput)
        await skillService.saveSkillExtensionForAgent(input.agentId, input.name, input.config)
        recordSkillActivity('updated', `${input.name} extension`, 'skill-extension')
        return skillsSaveExtensionRoute.output.parse({ saved: true })
      }
    ],
    [
      skillsListScriptsRoute.name,
      async (rawInput) => {
        const input = skillsListScriptsRoute.input.parse(rawInput)
        return skillsListScriptsRoute.output.parse({
          scripts: await skillService.listSkillScriptsForAgent(input.agentId, input.name)
        })
      }
    ],
    [
      skillsGetActiveRoute.name,
      async (rawInput) => {
        const input = skillsGetActiveRoute.input.parse(rawInput)
        return skillsGetActiveRoute.output.parse({
          skills: await skillService.getActiveSkills(input.conversationId)
        })
      }
    ],
    [
      skillsSetActiveRoute.name,
      async (rawInput) => {
        const input = skillsSetActiveRoute.input.parse(rawInput)
        const skills = await skillService.setActiveSkills(input.conversationId, input.skills)
        recordActivity({
          category: 'knowledge',
          action: 'updated',
          targetType: 'active-skills',
          targetLabel: 'active skills',
          routeName: 'settings-skills',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: `active skills (${input.skills.length})` }
        })
        return skillsSetActiveRoute.output.parse({ skills })
      }
    ],
    [
      skillsListAgentImportSourcesRoute.name,
      async (rawInput) => {
        const input = skillsListAgentImportSourcesRoute.input.parse(rawInput)
        return skillsListAgentImportSourcesRoute.output.parse({
          sources: await agentSkillImportService.listSources(input.targetAgentId)
        })
      }
    ],
    [
      skillsPreviewAgentImportRoute.name,
      async (rawInput) => {
        const input = skillsPreviewAgentImportRoute.input.parse(rawInput)
        return skillsPreviewAgentImportRoute.output.parse({
          preview: await agentSkillImportService.preview(input)
        })
      }
    ],
    [
      skillsExecuteAgentImportRoute.name,
      async (rawInput) => {
        const input = skillsExecuteAgentImportRoute.input.parse(rawInput)
        const result = await agentSkillImportService.execute(input)
        if (result.imported.length > 0) {
          recordSkillActivity('created', `Agent Skill import (${result.imported.length})`)
        }
        return skillsExecuteAgentImportRoute.output.parse({ result })
      }
    ],
    [
      skillSyncScanExternalToolsRoute.name,
      async (rawInput) => {
        skillSyncScanExternalToolsRoute.input.parse(rawInput)
        return skillSyncScanExternalToolsRoute.output.parse({
          results: await skillSyncService.scanExternalTools()
        })
      }
    ],
    [
      skillSyncGetNewDiscoveriesRoute.name,
      async (rawInput) => {
        skillSyncGetNewDiscoveriesRoute.input.parse(rawInput)
        return skillSyncGetNewDiscoveriesRoute.output.parse({
          discoveries: await skillSyncService.getNewDiscoveries()
        })
      }
    ],
    [
      skillSyncAcknowledgeDiscoveriesRoute.name,
      async (rawInput) => {
        skillSyncAcknowledgeDiscoveriesRoute.input.parse(rawInput)
        await skillSyncService.acknowledgeDiscoveries()
        return skillSyncAcknowledgeDiscoveriesRoute.output.parse({ acknowledged: true })
      }
    ],
    [
      skillSyncGetRegisteredToolsRoute.name,
      async (rawInput) => {
        skillSyncGetRegisteredToolsRoute.input.parse(rawInput)
        return skillSyncGetRegisteredToolsRoute.output.parse({
          tools: skillSyncService.getRegisteredTools()
        })
      }
    ],
    [
      skillSyncScanAgentsRoute.name,
      async (rawInput) => {
        skillSyncScanAgentsRoute.input.parse(rawInput)
        return skillSyncScanAgentsRoute.output.parse({
          agents: await skillSyncService.scanSkillAgents()
        })
      }
    ],
    [
      skillSyncGetAgentDetailRoute.name,
      async (rawInput) => {
        const input = skillSyncGetAgentDetailRoute.input.parse(rawInput)
        return skillSyncGetAgentDetailRoute.output.parse({
          agent: await skillSyncService.scanSkillAgent({ agentId: input.agentId })
        })
      }
    ],
    [
      skillSyncGetAgentSkillDetailRoute.name,
      async (rawInput) => {
        const input = skillSyncGetAgentSkillDetailRoute.input.parse(rawInput)
        return skillSyncGetAgentSkillDetailRoute.output.parse({
          detail: await skillSyncService.getAgentSkillDetail(input)
        })
      }
    ],
    [
      skillSyncRepairAgentSkillLinkRoute.name,
      async (rawInput) => {
        const input = skillSyncRepairAgentSkillLinkRoute.input.parse(rawInput)
        return skillSyncRepairAgentSkillLinkRoute.output.parse({
          result: await skillSyncService.repairAgentSkillLink(input)
        })
      }
    ],
    [
      skillSyncRemoveAgentSkillLinkRoute.name,
      async (rawInput) => {
        const input = skillSyncRemoveAgentSkillLinkRoute.input.parse(rawInput)
        return skillSyncRemoveAgentSkillLinkRoute.output.parse({
          result: await skillSyncService.removeAgentSkillLink(input)
        })
      }
    ]
  ])

  return createRouteMap(
    Array.from(routes, ([routeName, handler]) => [
      routeName,
      async (rawInput, context) => {
        await deps.ensureInitialized()
        return await handler(rawInput, context)
      }
    ])
  )
}
