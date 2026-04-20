import type { DeepchatBridge } from '@shared/contracts/bridge'
import { skillsCatalogChangedEvent, skillsSessionChangedEvent } from '@shared/contracts/events'
import {
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsInstallFromFolderRoute,
  skillsInstallFromUrlRoute,
  skillsInstallFromZipRoute,
  skillsListMetadataRoute,
  skillsListScriptsRoute,
  skillsOpenFolderRoute,
  skillsSaveExtensionRoute,
  skillsSaveWithExtensionRoute,
  skillsSetActiveRoute,
  skillsUninstallRoute,
  skillsUpdateFileRoute
} from '@shared/contracts/routes'
import type { SkillExtensionConfig, SkillInstallOptions } from '@shared/types/skill'
import { getDeepchatBridge } from './core'

export class SkillClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getMetadataList() {
    const result = await this.bridge.invoke(skillsListMetadataRoute.name, {})
    return result.skills
  }

  async getSkillsDir() {
    const result = await this.bridge.invoke(skillsGetDirectoryRoute.name, {})
    return result.path
  }

  async installFromFolder(folderPath: string, options?: SkillInstallOptions) {
    const result = await this.bridge.invoke(skillsInstallFromFolderRoute.name, {
      folderPath,
      options
    })
    return result.result
  }

  async installFromZip(zipPath: string, options?: SkillInstallOptions) {
    const result = await this.bridge.invoke(skillsInstallFromZipRoute.name, {
      zipPath,
      options
    })
    return result.result
  }

  async installFromUrl(url: string, options?: SkillInstallOptions) {
    const result = await this.bridge.invoke(skillsInstallFromUrlRoute.name, {
      url,
      options
    })
    return result.result
  }

  async uninstallSkill(name: string) {
    const result = await this.bridge.invoke(skillsUninstallRoute.name, { name })
    return result.result
  }

  async updateSkillFile(name: string, content: string) {
    const result = await this.bridge.invoke(skillsUpdateFileRoute.name, { name, content })
    return result.result
  }

  async saveSkillWithExtension(name: string, content: string, config: SkillExtensionConfig) {
    const result = await this.bridge.invoke(skillsSaveWithExtensionRoute.name, {
      name,
      content,
      config
    })
    return result.result
  }

  async getSkillFolderTree(name: string) {
    const result = await this.bridge.invoke(skillsGetFolderTreeRoute.name, { name })
    return result.nodes
  }

  async openSkillsFolder() {
    await this.bridge.invoke(skillsOpenFolderRoute.name, {})
  }

  async getSkillExtension(name: string) {
    const result = await this.bridge.invoke(skillsGetExtensionRoute.name, { name })
    return result.config
  }

  async saveSkillExtension(name: string, config: SkillExtensionConfig) {
    await this.bridge.invoke(skillsSaveExtensionRoute.name, { name, config })
  }

  async listSkillScripts(name: string) {
    const result = await this.bridge.invoke(skillsListScriptsRoute.name, { name })
    return result.scripts
  }

  async getActiveSkills(conversationId: string) {
    const result = await this.bridge.invoke(skillsGetActiveRoute.name, { conversationId })
    return result.skills
  }

  async setActiveSkills(conversationId: string, skills: string[]) {
    const result = await this.bridge.invoke(skillsSetActiveRoute.name, {
      conversationId,
      skills
    })
    return result.skills
  }

  onCatalogChanged(
    listener: (payload: {
      reason: 'discovered' | 'installed' | 'uninstalled' | 'metadata-updated'
      name?: string
      version: number
    }) => void
  ) {
    return this.bridge.on(skillsCatalogChangedEvent.name, listener)
  }

  onSessionChanged(
    listener: (payload: {
      conversationId: string
      skills: string[]
      change: 'activated' | 'deactivated'
      version: number
    }) => void
  ) {
    return this.bridge.on(skillsSessionChangedEvent.name, listener)
  }
}
