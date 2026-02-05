import { ref, computed } from 'vue'
import type { SkillMetadata, SkillInstallResult } from '@shared/types/skill'
import { useSkillsAdapter } from '@/composables/skills/useSkillsAdapter'

export const useSkillsStoreService = () => {
  const skillsAdapter = useSkillsAdapter()

  const skills = ref<SkillMetadata[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const skillCount = computed(() => skills.value.length)

  const loadSkills = async () => {
    loading.value = true
    error.value = null
    try {
      skills.value = await skillsAdapter.getMetadataList()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[SkillsStore] Failed to load skills:', err)
    } finally {
      loading.value = false
    }
  }

  const installFromFolder = async (
    folderPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillsAdapter.installFromFolder(folderPath, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }

  const installFromZip = async (
    zipPath: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillsAdapter.installFromZip(zipPath, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }

  const installFromUrl = async (
    url: string,
    options?: { overwrite?: boolean }
  ): Promise<SkillInstallResult> => {
    try {
      const result = await skillsAdapter.installFromUrl(url, options)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }

  const uninstallSkill = async (name: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillsAdapter.uninstallSkill(name)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }

  const getSkillsDir = async (): Promise<string> => {
    return await skillsAdapter.getSkillsDir()
  }

  const openSkillsFolder = async (): Promise<void> => {
    await skillsAdapter.openSkillsFolder()
  }

  const updateSkillFile = async (name: string, content: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillsAdapter.updateSkillFile(name, content)
      if (result.success) {
        await loadSkills()
      }
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { success: false, error: errorMsg }
    }
  }

  const getSkillFolderTree = async (name: string) => {
    return await skillsAdapter.getSkillFolderTree(name)
  }

  return {
    skills,
    loading,
    error,
    skillCount,
    loadSkills,
    installFromFolder,
    installFromZip,
    installFromUrl,
    uninstallSkill,
    getSkillsDir,
    openSkillsFolder,
    updateSkillFile,
    getSkillFolderTree
  }
}
