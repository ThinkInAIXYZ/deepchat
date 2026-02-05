import { defineStore } from 'pinia'
import { useSkillsStoreService } from '@/composables/skills/useSkillsStoreService'

export const useSkillsStore = defineStore('skills', () => {
  return useSkillsStoreService()
})
