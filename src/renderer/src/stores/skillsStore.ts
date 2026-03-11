import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type {
  SkillMetadata,
  SkillInstallResult,
  SkillExtensionConfig,
  SkillScriptDescriptor
} from '@shared/types/skill'

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
  const skillPresenter = usePresenter('skillPresenter')

  const skills = ref<SkillMetadata[]>([])
  const skillExtensions = ref<Record<string, SkillExtensionConfig>>({})
  const skillScripts = ref<Record<string, SkillScriptDescriptor[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  const skillCount = computed(() => skills.value.length)

  const loadSkillRuntime = async (name: string) => {
    try {
      const [extension, scripts] = await Promise.all([
        skillPresenter.getSkillExtension(name),
        skillPresenter.listSkillScripts(name)
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

  const loadSkillRuntimeData = async (items: SkillMetadata[] = skills.value) => {
    const nextExtensions: Record<string, SkillExtensionConfig> = {}
    const nextScripts: Record<string, SkillScriptDescriptor[]> = {}

    await Promise.all(
      items.map(async (skill) => {
        try {
          const [extension, scripts] = await Promise.all([
            skillPresenter.getSkillExtension(skill.name),
            skillPresenter.listSkillScripts(skill.name)
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

    skillExtensions.value = nextExtensions
    skillScripts.value = nextScripts
  }

  const loadSkills = async () => {
    loading.value = true
    error.value = null
    try {
      const nextSkills = await skillPresenter.getMetadataList()
      skills.value = nextSkills
      await loadSkillRuntimeData(nextSkills)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[SkillsStore] Failed to load skills:', e)
    } finally {
      loading.value = false
    }
  }

  const installFromFolder = async (
    folderPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillPresenter.installFromFolder(folderPath, options)
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
      const result = await skillPresenter.installFromZip(zipPath, options)
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
      const result = await skillPresenter.installFromUrl(url, options)
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
      const result = await skillPresenter.uninstallSkill(name)
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
    return await skillPresenter.getSkillsDir()
  }

  const openSkillsFolder = async (): Promise<void> => {
    await skillPresenter.openSkillsFolder()
  }

  const updateSkillFile = async (name: string, content: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillPresenter.updateSkillFile(name, content)
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
    await skillPresenter.saveSkillExtension(name, config)
    await loadSkillRuntime(name)
  }

  const getSkillFolderTree = async (name: string) => {
    return await skillPresenter.getSkillFolderTree(name)
  }

  return {
    skills,
    skillExtensions,
    skillScripts,
    loading,
    error,
    skillCount,
    loadSkills,
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
    getSkillFolderTree
  }
})
