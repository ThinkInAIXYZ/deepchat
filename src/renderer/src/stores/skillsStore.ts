import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SkillMetadata, SkillInstallResult } from '@shared/types/skill'

export const useSkillsStore = defineStore('skills', () => {
  const skillPresenter = usePresenter('skillPresenter')

  // State
  const skills = ref<SkillMetadata[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const skillCount = computed(() => skills.value.length)

  // Actions
  const loadSkills = async () => {
    loading.value = true
    error.value = null
    try {
      skills.value = await skillPresenter.getMetadataList()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[SkillsStore] Failed to load skills:', e)
    } finally {
      loading.value = false
    }
  }

  const installFromFolder = async (folderPath: string): Promise<SkillInstallResult> => {
    try {
      const result = await skillPresenter.installFromFolder(folderPath)
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

  const getSkillFolderTree = async (name: string) => {
    return await skillPresenter.getSkillFolderTree(name)
  }

  return {
    // State
    skills,
    loading,
    error,

    // Computed
    skillCount,

    // Actions
    loadSkills,
    installFromFolder,
    uninstallSkill,
    getSkillsDir,
    openSkillsFolder,
    updateSkillFile,
    getSkillFolderTree
  }
})
