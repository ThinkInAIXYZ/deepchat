import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  skillsCatalogChangedEvent,
  skillsSessionChangedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import {
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsGetSyncConfigRoute,
  skillsExecuteAgentImportRoute,
  skillsExecuteSyncDirectoryExportRoute,
  skillsExecuteSyncDirectoryImportRoute,
  skillsInstallFromGitRoute,
  skillsInstallFromFolderRoute,
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
  skillsScanGitRepoRoute,
  skillsSaveExtensionRoute,
  skillsSaveWithExtensionRoute,
  skillsSetActiveRoute,
  skillsSetDisabledRoute,
  skillsSetSyncDirectoryRoute,
  skillsUninstallRoute,
  skillsUpdateFileRoute
} from '@shared/contracts/routes'
import type {
  GitSkillInstallInput,
  SkillExtensionConfig,
  SkillInstallOptions,
  SkillSyncDirectoryExportInput,
  SkillSyncDirectoryImportInput
} from '@shared/types/skill'
import type {
  AgentSkillImportSelection,
  AgentSkillImportSource
} from '@shared/types/agentSkillImport'
import { getDeepchatBridge } from './core'

const BUILTIN_SKILL_AGENT_ID = 'deepchat'

export function createSkillClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getMetadataList(agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsListMetadataRoute.name, { agentId })
    return result.skills
  }

  async function getUnifiedSkillCatalog(agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsListCatalogRoute.name, { agentId })
    return result.skills
  }

  async function getSkillsDir(agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsGetDirectoryRoute.name, { agentId })
    return result.path
  }

  async function installFromFolder(
    folderPath: string,
    options?: SkillInstallOptions,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsInstallFromFolderRoute.name, {
      folderPath,
      options,
      agentId
    })
    return result.result
  }

  async function installFromZip(
    zipPath: string,
    options?: SkillInstallOptions,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsInstallFromZipRoute.name, {
      zipPath,
      options,
      agentId
    })
    return result.result
  }

  async function installFromUrl(
    url: string,
    options?: SkillInstallOptions,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsInstallFromUrlRoute.name, {
      url,
      options,
      agentId
    })
    return result.result
  }

  async function scanGitSkillRepo(repoUrl: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsScanGitRepoRoute.name, { repoUrl, agentId })
    return result.result
  }

  async function installFromGit(
    input: GitSkillInstallInput,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsInstallFromGitRoute.name, { ...input, agentId })
    return result.results
  }

  async function getSkillsSyncConfig() {
    const result = await bridge.invoke(skillsGetSyncConfigRoute.name, {})
    return result.config
  }

  async function setSkillsSyncDirectory(skillsDirectory: string) {
    const result = await bridge.invoke(skillsSetSyncDirectoryRoute.name, { skillsDirectory })
    return result.config
  }

  async function previewSyncDirectoryExport(input: SkillSyncDirectoryExportInput) {
    const result = await bridge.invoke(skillsPreviewSyncDirectoryExportRoute.name, input)
    return result.preview
  }

  async function executeSyncDirectoryExport(input: SkillSyncDirectoryExportInput) {
    const result = await bridge.invoke(skillsExecuteSyncDirectoryExportRoute.name, input)
    return result.result
  }

  async function previewSyncDirectoryImport() {
    const result = await bridge.invoke(skillsPreviewSyncDirectoryImportRoute.name, {})
    return result.preview
  }

  async function executeSyncDirectoryImport(input: SkillSyncDirectoryImportInput) {
    const result = await bridge.invoke(skillsExecuteSyncDirectoryImportRoute.name, input)
    return result.result
  }

  async function listAgentImportSources(targetAgentId: string) {
    const result = await bridge.invoke(skillsListAgentImportSourcesRoute.name, { targetAgentId })
    return result.sources
  }

  async function previewAgentImport(input: {
    targetAgentId: string
    source: AgentSkillImportSource
    skillNames?: string[]
  }) {
    const result = await bridge.invoke(skillsPreviewAgentImportRoute.name, input)
    return result.preview
  }

  async function executeAgentImport(input: {
    targetAgentId: string
    source: AgentSkillImportSource
    items: AgentSkillImportSelection[]
  }) {
    const result = await bridge.invoke(skillsExecuteAgentImportRoute.name, input)
    return result.result
  }

  async function uninstallSkill(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsUninstallRoute.name, { name, agentId })
    return result.result
  }

  async function readSkillFile(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsReadFileRoute.name, { name, agentId })
    return result.content
  }

  async function updateSkillFile(
    name: string,
    content: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsUpdateFileRoute.name, { name, content, agentId })
    return result.result
  }

  async function saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    const result = await bridge.invoke(skillsSaveWithExtensionRoute.name, {
      name,
      content,
      config,
      agentId
    })
    return result.result
  }

  async function getSkillFolderTree(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsGetFolderTreeRoute.name, { name, agentId })
    return result.nodes
  }

  async function openSkillsFolder(agentId: string = BUILTIN_SKILL_AGENT_ID) {
    await bridge.invoke(skillsOpenFolderRoute.name, { agentId })
  }

  async function getSkillExtension(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsGetExtensionRoute.name, { name, agentId })
    return result.config
  }

  async function saveSkillExtension(
    name: string,
    config: SkillExtensionConfig,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    await bridge.invoke(skillsSaveExtensionRoute.name, { name, config, agentId })
  }

  async function setSkillDisabled(
    name: string,
    disabled: boolean,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ) {
    await bridge.invoke(skillsSetDisabledRoute.name, { name, disabled, agentId })
  }

  async function listSkillScripts(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID) {
    const result = await bridge.invoke(skillsListScriptsRoute.name, { name, agentId })
    return result.scripts
  }

  async function getActiveSkills(conversationId: string) {
    const result = await bridge.invoke(skillsGetActiveRoute.name, { conversationId })
    return result.skills
  }

  async function setActiveSkills(conversationId: string, skills: string[]) {
    const result = await bridge.invoke(skillsSetActiveRoute.name, {
      conversationId,
      skills
    })
    return result.skills
  }

  function onCatalogChanged(
    listener: (payload: DeepchatEventPayload<typeof skillsCatalogChangedEvent.name>) => void
  ) {
    return bridge.on(skillsCatalogChangedEvent.name, listener)
  }

  function onSessionChanged(
    listener: (payload: {
      conversationId: string
      skills: string[]
      change: 'activated' | 'deactivated'
      version: number
    }) => void
  ) {
    return bridge.on(skillsSessionChangedEvent.name, listener)
  }

  return {
    getMetadataList,
    getUnifiedSkillCatalog,
    getSkillsDir,
    installFromFolder,
    installFromZip,
    installFromUrl,
    scanGitSkillRepo,
    installFromGit,
    getSkillsSyncConfig,
    setSkillsSyncDirectory,
    previewSyncDirectoryExport,
    executeSyncDirectoryExport,
    previewSyncDirectoryImport,
    executeSyncDirectoryImport,
    listAgentImportSources,
    previewAgentImport,
    executeAgentImport,
    uninstallSkill,
    readSkillFile,
    updateSkillFile,
    saveSkillWithExtension,
    getSkillFolderTree,
    openSkillsFolder,
    getSkillExtension,
    saveSkillExtension,
    setSkillDisabled,
    listSkillScripts,
    getActiveSkills,
    setActiveSkills,
    onCatalogChanged,
    onSessionChanged
  }
}

export type SkillClient = ReturnType<typeof createSkillClient>
