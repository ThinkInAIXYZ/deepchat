import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createSkillClient } from '@api/SkillClient'
import type {
  SkillInstallResult,
  SkillExtensionConfig,
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

  const skillCatalogs = ref<Record<string, UnifiedSkillItem[]>>({})
  const catalogLoaded = ref<Record<string, boolean>>({})
  const catalogLoading = ref<Record<string, boolean>>({})
  const catalogErrors = ref<Record<string, string | null>>({})
  const skillExtensions = ref<Record<string, SkillExtensionConfig>>({})
  const skillScripts = ref<Record<string, SkillScriptDescriptor[]>>({})

  const normalizeAgentId = (agentId?: string | null) => agentId?.trim() || BUILTIN_AGENT_ID
  const getSkillsForAgent = (agentId?: string | null): UnifiedSkillItem[] =>
    skillCatalogs.value[normalizeAgentId(agentId)] ?? []
  const isSkillsLoaded = (agentId?: string | null): boolean =>
    catalogLoaded.value[normalizeAgentId(agentId)] === true
  const isSkillsLoading = (agentId?: string | null): boolean =>
    catalogLoading.value[normalizeAgentId(agentId)] === true
  const getSkillsError = (agentId?: string | null): string | null =>
    catalogErrors.value[normalizeAgentId(agentId)] ?? null

  const skills = computed(() => getSkillsForAgent(BUILTIN_AGENT_ID))
  const loading = computed(() => isSkillsLoading(BUILTIN_AGENT_ID))
  const error = computed(() => getSkillsError(BUILTIN_AGENT_ID))

  const skillCount = computed(() => skills.value.length)

  const loadSkillRuntime = async (name: string) => {
    try {
      const [extension, scripts] = await Promise.all([
        skillClient.getSkillExtension(name),
        skillClient.listSkillScripts(name)
      ])

      skillExtensions.value = {
        ...skillExtensions.value,
        [name]: extension ?? createDefaultSkillExtension()
      }
      skillScripts.value = {
        ...skillScripts.value,
        [name]: scripts ?? []
      }
    } catch (e) {
      console.error(`[SkillsStore] Failed to load runtime config for ${name}:`, e)
      skillExtensions.value = {
        ...skillExtensions.value,
        [name]: createDefaultSkillExtension()
      }
      skillScripts.value = {
        ...skillScripts.value,
        [name]: []
      }
    }
  }

  const loadSkillRuntimeData = async (
    items: UnifiedSkillItem[] = skills.value,
    isCurrentRequest: () => boolean = () => true
  ) => {
    const nextExtensions: Record<string, SkillExtensionConfig> = {}
    const nextScripts: Record<string, SkillScriptDescriptor[]> = {}

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
          console.error(`[SkillsStore] Failed to load runtime data for ${skill.name}:`, e)
          nextExtensions[skill.name] = createDefaultSkillExtension()
          nextScripts[skill.name] = []
        }
      })
    )

    if (!isCurrentRequest()) return

    skillExtensions.value = nextExtensions
    skillScripts.value = nextScripts
  }

  const loadSkills = async (agentId: string = BUILTIN_AGENT_ID) => {
    const normalizedAgentId = normalizeAgentId(agentId)
    const requestSequence = (catalogRequestSequence.get(normalizedAgentId) ?? 0) + 1
    catalogRequestSequence.set(normalizedAgentId, requestSequence)
    catalogLoading.value = { ...catalogLoading.value, [normalizedAgentId]: true }
    catalogErrors.value = { ...catalogErrors.value, [normalizedAgentId]: null }
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
        [normalizedAgentId]: e instanceof Error ? e.message : String(e)
      }
      console.error(`[SkillsStore] Failed to load skills for ${normalizedAgentId}:`, e)
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
      const result = await skillClient.installFromFolder(folderPath, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
    }
  }

  const installFromZip = async (
    zipPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillClient.installFromZip(zipPath, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
    }
  }

  const installFromUrl = async (
    url: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillClient.installFromUrl(url, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
    }
  }

  const uninstallSkill = async (name: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillClient.uninstallSkill(name)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
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
      const result = await skillClient.updateSkillFile(name, content)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
    }
  }

  const saveSkillExtension = async (name: string, config: SkillExtensionConfig): Promise<void> => {
    await skillClient.saveSkillExtension(name, config)
    await loadSkillRuntime(name)
  }

  const setSkillDisabled = async (name: string, disabled: boolean): Promise<void> => {
    await skillClient.setSkillDisabled(name, disabled)
  }

  const saveSkillWithExtension = async (
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillClient.saveSkillWithExtension(name, content, config)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { success: false, error: errorMsg }
    }
  }

  const getSkillFolderTree = async (name: string) => {
    return await skillClient.getSkillFolderTree(name)
  }

  if (!catalogListenerRegistered) {
    catalogListenerRegistered = true
    skillClient.onCatalogChanged((payload) => {
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
    saveSkillWithExtension,
    getSkillFolderTree
  }
})
