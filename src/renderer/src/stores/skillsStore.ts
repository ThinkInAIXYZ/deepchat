import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createSkillClient } from '@api/SkillClient'
import type {
  SkillInstallResult,
  SkillExtensionConfig,
  SkillMetadata,
  SkillScriptDescriptor
} from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

const BUILTIN_AGENT_ID = 'deepchat'

function createDefaultSkillExtension(): SkillExtensionConfig {
  return {
    version: 1,
    env: {},
    runtimePolicy: {
      python: 'auto',
      node: 'auto'
    },
    scriptOverrides: {}
  }
}

export const useSkillsStore = defineStore('skills', () => {
  const skillClient = createSkillClient()
  let catalogListenerRegistered = false
  const catalogRequestSequence = new Map<string, number>()
  const catalogEnsureRequests = new Map<string, Promise<void>>()
  const runtimeRequestSequence = new Map<string, number>()

  const skillCatalogs = ref<Record<string, UnifiedSkillItem[]>>({})
  const catalogLoaded = ref<Record<string, boolean>>({})
  const catalogLoading = ref<Record<string, boolean>>({})
  const catalogErrors = ref<Record<string, boolean>>({})
  const skillExtensions = ref<Record<string, SkillExtensionConfig>>({})
  const skillScripts = ref<Record<string, SkillScriptDescriptor[]>>({})

  const normalizeAgentId = (agentId?: string | null) => agentId?.trim() || BUILTIN_AGENT_ID
  const getSkillsForAgent = (agentId?: string | null): UnifiedSkillItem[] =>
    skillCatalogs.value[normalizeAgentId(agentId)] ?? []
  const isSkillsLoaded = (agentId?: string | null): boolean =>
    catalogLoaded.value[normalizeAgentId(agentId)] === true
  const isSkillsLoading = (agentId?: string | null): boolean =>
    catalogLoading.value[normalizeAgentId(agentId)] === true
  const getSkillsError = (agentId?: string | null): boolean =>
    catalogErrors.value[normalizeAgentId(agentId)] ?? false

  const skills = computed(() => getSkillsForAgent(BUILTIN_AGENT_ID))
  const loading = computed(() => isSkillsLoading(BUILTIN_AGENT_ID))
  const error = computed(() => getSkillsError(BUILTIN_AGENT_ID))

  const skillCount = computed(() => skills.value.length)

  const applySkillMetadata = (agentId: string, metadata: SkillMetadata): boolean => {
    const normalizedAgentId = normalizeAgentId(agentId)
    const currentSkills = getSkillsForAgent(normalizedAgentId)
    if (!currentSkills.some((skill) => skill.name === metadata.name)) return false

    skillCatalogs.value = {
      ...skillCatalogs.value,
      [normalizedAgentId]: currentSkills.map((skill) =>
        skill.name === metadata.name
          ? {
              ...skill,
              description: metadata.description,
              path: metadata.path,
              skillRoot: metadata.skillRoot,
              category: metadata.category,
              platforms: metadata.platforms,
              metadata: metadata.metadata,
              allowedTools: metadata.allowedTools,
              ownerPluginId: metadata.ownerPluginId
            }
          : skill
      )
    }
    return true
  }

  const applySkillDisabled = (agentId: string, name: string, disabled: boolean): boolean => {
    const normalizedAgentId = normalizeAgentId(agentId)
    const currentSkills = getSkillsForAgent(normalizedAgentId)
    if (!currentSkills.some((skill) => skill.name === name)) return false

    skillCatalogs.value = {
      ...skillCatalogs.value,
      [normalizedAgentId]: currentSkills.map((skill) =>
        skill.name === name ? { ...skill, disabled, deepchatDisabled: disabled } : skill
      )
    }
    return true
  }

  const removeSkillFromCatalog = (agentId: string, name: string): boolean => {
    const normalizedAgentId = normalizeAgentId(agentId)
    const currentSkills = getSkillsForAgent(normalizedAgentId)
    const containsSkill = currentSkills.some((skill) => skill.name === name)
    if (!containsSkill && !isSkillsLoaded(normalizedAgentId)) return false

    if (containsSkill) {
      skillCatalogs.value = {
        ...skillCatalogs.value,
        [normalizedAgentId]: currentSkills.filter((skill) => skill.name !== name)
      }
    }
    if (normalizedAgentId === BUILTIN_AGENT_ID) {
      const remainingExtensions = { ...skillExtensions.value }
      const remainingScripts = { ...skillScripts.value }
      delete remainingExtensions[name]
      delete remainingScripts[name]
      skillExtensions.value = remainingExtensions
      skillScripts.value = remainingScripts
    }
    return true
  }

  const loadSkillRuntime = async (name: string) => {
    const requestSequence = (runtimeRequestSequence.get(name) ?? 0) + 1
    runtimeRequestSequence.set(name, requestSequence)
    try {
      const [extension, scripts] = await Promise.all([
        skillClient.getSkillExtension(name),
        skillClient.listSkillScripts(name)
      ])
      if (
        runtimeRequestSequence.get(name) !== requestSequence ||
        !getSkillsForAgent(BUILTIN_AGENT_ID).some((skill) => skill.name === name)
      ) {
        return
      }

      skillExtensions.value = {
        ...skillExtensions.value,
        [name]: extension ?? createDefaultSkillExtension()
      }
      skillScripts.value = {
        ...skillScripts.value,
        [name]: scripts ?? []
      }
    } catch (e) {
      if (runtimeRequestSequence.get(name) !== requestSequence) return
      console.error(
        '[SkillsStore] Failed to load runtime config',
        {
          skillName: name
        },
        e
      )
      if (!(name in skillExtensions.value)) {
        skillExtensions.value = {
          ...skillExtensions.value,
          [name]: createDefaultSkillExtension()
        }
      }
      if (!(name in skillScripts.value)) {
        skillScripts.value = {
          ...skillScripts.value,
          [name]: []
        }
      }
    }
  }

  const loadSkillRuntimeData = async (
    items: UnifiedSkillItem[] = skills.value,
    isCurrentRequest: () => boolean = () => true
  ) => {
    const nextExtensions: Record<string, SkillExtensionConfig> = {}
    const nextScripts: Record<string, SkillScriptDescriptor[]> = {}
    const requestSequences = new Map(
      items.map((skill) => {
        const requestSequence = (runtimeRequestSequence.get(skill.name) ?? 0) + 1
        runtimeRequestSequence.set(skill.name, requestSequence)
        return [skill.name, requestSequence] as const
      })
    )

    await Promise.all(
      items.map(async (skill) => {
        try {
          const [extension, scripts] = await Promise.all([
            skillClient.getSkillExtension(skill.name),
            skillClient.listSkillScripts(skill.name)
          ])
          nextExtensions[skill.name] = extension ?? createDefaultSkillExtension()
          nextScripts[skill.name] = scripts ?? []
        } catch (e) {
          console.error(
            '[SkillsStore] Failed to load runtime data',
            {
              skillName: skill.name
            },
            e
          )
          nextExtensions[skill.name] =
            skillExtensions.value[skill.name] ?? createDefaultSkillExtension()
          nextScripts[skill.name] = skillScripts.value[skill.name] ?? []
        }
      })
    )

    if (!isCurrentRequest()) return

    skillExtensions.value = Object.fromEntries(
      items.map((skill) => {
        const runtimeIsCurrent =
          runtimeRequestSequence.get(skill.name) === requestSequences.get(skill.name)
        return [
          skill.name,
          runtimeIsCurrent
            ? nextExtensions[skill.name]
            : (skillExtensions.value[skill.name] ?? nextExtensions[skill.name])
        ]
      })
    )
    skillScripts.value = Object.fromEntries(
      items.map((skill) => {
        const runtimeIsCurrent =
          runtimeRequestSequence.get(skill.name) === requestSequences.get(skill.name)
        return [
          skill.name,
          runtimeIsCurrent
            ? nextScripts[skill.name]
            : (skillScripts.value[skill.name] ?? nextScripts[skill.name])
        ]
      })
    )
  }

  const loadSkills = async (agentId: string = BUILTIN_AGENT_ID) => {
    const normalizedAgentId = normalizeAgentId(agentId)
    const requestSequence = (catalogRequestSequence.get(normalizedAgentId) ?? 0) + 1
    catalogRequestSequence.set(normalizedAgentId, requestSequence)
    catalogLoading.value = { ...catalogLoading.value, [normalizedAgentId]: true }
    catalogErrors.value = { ...catalogErrors.value, [normalizedAgentId]: false }
    try {
      const nextSkills = await skillClient.getUnifiedSkillCatalog(normalizedAgentId)
      if (catalogRequestSequence.get(normalizedAgentId) !== requestSequence) return

      skillCatalogs.value = { ...skillCatalogs.value, [normalizedAgentId]: nextSkills }
      catalogLoaded.value = { ...catalogLoaded.value, [normalizedAgentId]: true }
      if (normalizedAgentId === BUILTIN_AGENT_ID) {
        await loadSkillRuntimeData(
          nextSkills,
          () => catalogRequestSequence.get(normalizedAgentId) === requestSequence
        )
      }
    } catch (e) {
      if (catalogRequestSequence.get(normalizedAgentId) !== requestSequence) return
      catalogErrors.value = {
        ...catalogErrors.value,
        [normalizedAgentId]: true
      }
      console.error(
        '[SkillsStore] Failed to load skills',
        {
          agentId: normalizedAgentId
        },
        e
      )
    } finally {
      if (catalogRequestSequence.get(normalizedAgentId) === requestSequence) {
        catalogLoading.value = { ...catalogLoading.value, [normalizedAgentId]: false }
      }
    }
  }

  const ensureSkillsLoaded = async (agentId: string = BUILTIN_AGENT_ID): Promise<void> => {
    const normalizedAgentId = normalizeAgentId(agentId)
    if (isSkillsLoaded(normalizedAgentId)) return

    const existingRequest = catalogEnsureRequests.get(normalizedAgentId)
    if (existingRequest) {
      await existingRequest
      return
    }

    const request = loadSkills(normalizedAgentId).finally(() => {
      if (catalogEnsureRequests.get(normalizedAgentId) === request) {
        catalogEnsureRequests.delete(normalizedAgentId)
      }
    })
    catalogEnsureRequests.set(normalizedAgentId, request)
    await request
  }

  const installFromFolder = async (
    folderPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      return await skillClient.installFromFolder(folderPath, options)
    } catch (e) {
      console.error('[SkillsStore] Failed to install skill from folder', e)
      return { success: false, errorCode: 'io_error' }
    }
  }

  const installFromZip = async (
    zipPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      return await skillClient.installFromZip(zipPath, options)
    } catch (e) {
      console.error('[SkillsStore] Failed to install skill from ZIP', e)
      return { success: false, errorCode: 'io_error' }
    }
  }

  const installFromUrl = async (
    url: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      return await skillClient.installFromUrl(url, options)
    } catch (e) {
      console.error('[SkillsStore] Failed to install skill from URL', e)
      return { success: false, errorCode: 'io_error' }
    }
  }

  const uninstallSkill = async (name: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillClient.uninstallSkill(name)
      if (result.success) {
        removeSkillFromCatalog(BUILTIN_AGENT_ID, name)
      }
      return result
    } catch (e) {
      console.error(
        '[SkillsStore] Failed to uninstall skill',
        {
          skillName: name
        },
        e
      )
      return { success: false, errorCode: 'io_error' }
    }
  }

  const getSkillsDir = async (): Promise<string> => {
    return await skillClient.getSkillsDir()
  }

  const openSkillsFolder = async (): Promise<void> => {
    await skillClient.openSkillsFolder()
  }

  const updateSkillFile = async (name: string, content: string): Promise<SkillInstallResult> => {
    try {
      return await skillClient.updateSkillFile(name, content)
    } catch (e) {
      console.error(
        '[SkillsStore] Failed to update skill file',
        {
          skillName: name
        },
        e
      )
      return { success: false, errorCode: 'io_error' }
    }
  }

  const saveSkillExtension = async (name: string, config: SkillExtensionConfig): Promise<void> => {
    await skillClient.saveSkillExtension(name, config)
    await loadSkillRuntime(name)
  }

  const setSkillDisabled = async (name: string, disabled: boolean): Promise<void> => {
    await skillClient.setSkillDisabled(name, disabled)
    applySkillDisabled(BUILTIN_AGENT_ID, name, disabled)
  }

  const getSkillFolderTree = async (name: string) => {
    return await skillClient.getSkillFolderTree(name)
  }

  if (!catalogListenerRegistered) {
    catalogListenerRegistered = true
    skillClient.onCatalogChanged((payload) => {
      if (payload.reason === 'sync-directory-updated') return

      const affectedAgentIds = payload.agentIds?.length
        ? payload.agentIds.map(normalizeAgentId)
        : Array.from(
            new Set([
              BUILTIN_AGENT_ID,
              ...Object.keys(catalogLoaded.value),
              ...Object.keys(catalogLoading.value)
            ])
          )

      for (const agentId of affectedAgentIds) {
        if (
          payload.reason === 'uninstalled' &&
          payload.name &&
          removeSkillFromCatalog(agentId, payload.name)
        ) {
          continue
        }
        if (
          payload.reason === 'metadata-updated' &&
          payload.skill &&
          applySkillMetadata(agentId, payload.skill)
        ) {
          if (payload.extensionChanged && agentId === BUILTIN_AGENT_ID) {
            void loadSkillRuntime(payload.skill.name)
          }
          continue
        }
        if (agentId === BUILTIN_AGENT_ID || isSkillsLoaded(agentId) || isSkillsLoading(agentId)) {
          void loadSkills(agentId)
        }
      }
    })
  }

  return {
    skills,
    skillExtensions,
    skillScripts,
    loading,
    error,
    skillCount,
    getSkillsForAgent,
    isSkillsLoaded,
    isSkillsLoading,
    getSkillsError,
    loadSkills,
    ensureSkillsLoaded,
    loadSkillRuntime,
    loadSkillRuntimeData,
    installFromFolder,
    installFromZip,
    installFromUrl,
    uninstallSkill,
    getSkillsDir,
    openSkillsFolder,
    updateSkillFile,
    saveSkillExtension,
    setSkillDisabled,
    getSkillFolderTree
  }
})
