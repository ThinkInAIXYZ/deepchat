// stores/aiStore.ts
import { defineStore } from 'pinia'

export const useAiStore = defineStore('ai', {
  state: () => ({
    aiChange: false // 默认值
  }),
  actions: {
    toggleAiChange() {
      this.aiChange = !this.aiChange
    },
    setAiChange(value: boolean) {
      this.aiChange = value
    }
  }
})
