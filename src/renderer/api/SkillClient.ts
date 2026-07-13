import type { DeepchatBridge } from '@shared/contracts/bridge'
import { skillsCatalogChangedEvent, skillsSessionChangedEvent } from '@shared/contracts/events'
import {
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsGetSyncConfigRoute,
  skillsExecuteSyncDirectoryExportRoute,
  skillsExecuteSyncDirectoryImportRoute,
  skillsInstallFromGitRoute,
  skillsInstallFromFolderRoute,
  skillsInstallFromUrlRoute,
  skillsInstallFromZipRoute,
  skillsListCatalogRoute,
  skillsListMetadataRoute,
  skillsListScriptsRoute,
  skillsOpenFolderRoute,
  skillsPreviewSyncDirectoryExportRoute,
  skillsPreviewSyncDirectoryImportRoute,
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
import { getDeepchatBridge } from './core'

export function createSkillClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getMetadataList() {
    const result = await bridge.invoke(skillsListMetadataRoute.name, {})
    return result.skills
  }

  async function getUnifiedSkillCatalog() {
    const result = await bridge.invoke(skillsListCatalogRoute.name, {})
    return result.skills
  }

  async function getSkillsDir() {
    const result = await bridge.invoke(skillsGetDirectoryRoute.name, {})
    return result.path
  }

  async function installFromFolder(folderPath: string, options?: SkillInstallOptions) {
    const result = await bridge.invoke(skillsInstallFromFolderRoute.name, {
      folderPath,
      options
    })
    return result.result
  }

  async function installFromZip(zipPath: string, options?: SkillInstallOptions) {
    const result = await bridge.invoke(skillsInstallFromZipRoute.name, {
      zipPath,
      options
    })
    return result.result
  }

  async function installFromUrl(url: string, options?: SkillInstallOptions) {
    const result = await bridge.invoke(skillsInstallFromUrlRoute.name, {
      url,
      options
    })
    return result.result
  }

  async function scanGitSkillRepo(repoUrl: string) {
    const result = await bridge.invoke(skillsScanGitRepoRoute.name, { repoUrl })
    return result.result
  }

  async function installFromGit(input: GitSkillInstallInput) {
    const result = await bridge.invoke(skillsInstallFromGitRoute.name, input)
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

  async function uninstallSkill(name: string) {
    const result = await bridge.invoke(skillsUninstallRoute.name, { name })
    return result.result
  }

  async function readSkillFile(name: string) {
    const result = await bridge.invoke(skillsReadFileRoute.name, { name })
    return result.content
  }

  async function updateSkillFile(name: string, content: string) {
    const result = await bridge.invoke(skillsUpdateFileRoute.name, { name, content })
    return result.result
  }

  async function saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ) {
    const result = await bridge.invoke(skillsSaveWithExtensionRoute.name, {
      name,
      content,
      config
    })
    return result.result
  }

  async function getSkillFolderTree(name: string) {
    const result = await bridge.invoke(skillsGetFolderTreeRoute.name, { name })
    return result.nodes
  }

  async function openSkillsFolder() {
    await bridge.invoke(skillsOpenFolderRoute.name, {})
  }

  async function getSkillExtension(name: string) {
    const result = await bridge.invoke(skillsGetExtensionRoute.name, { name })
    return result.config
  }

  async function saveSkillExtension(name: string, config: SkillExtensionConfig) {
    await bridge.invoke(skillsSaveExtensionRoute.name, { name, config })
  }

  async function setSkillDisabled(name: string, disabled: boolean) {
    await bridge.invoke(skillsSetDisabledRoute.name, { name, disabled })
  }

  async function listSkillScripts(name: string) {
    const result = await bridge.invoke(skillsListScriptsRoute.name, { name })
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
    listener: (payload: {
      reason:
        | 'discovered'
        | 'installed'
        | 'uninstalled'
        | 'metadata-updated'
        | 'disabled-updated'
        | 'management-state-updated'
        | 'git-installed'
        | 'sync-directory-updated'
      name?: string
      version: number
    }) => void
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
