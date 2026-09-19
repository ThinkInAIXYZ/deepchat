import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSidebarStore = defineStore('sidebar', () => {
  const collapsed = ref(false)

  const toggleSidebar = () => {
    collapsed.value = !collapsed.value
  }

  const setCollapsed = (value: boolean) => {
    collapsed.value = value
  }

  return {
    collapsed,
    toggleSidebar,
    setCollapsed
  }
})
