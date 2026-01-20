import { defineStore } from 'pinia'
import { ref } from 'vue'

export const createLayoutStore = () => {
  const isThreadSidebarOpen = ref(false)
  const isMessageNavigationOpen = ref(false)

  const openThreadSidebar = () => {
    isThreadSidebarOpen.value = true
  }

  const closeThreadSidebar = () => {
    isThreadSidebarOpen.value = false
  }

  const toggleThreadSidebar = () => {
    isThreadSidebarOpen.value = !isThreadSidebarOpen.value
  }

  const openMessageNavigation = () => {
    isMessageNavigationOpen.value = true
  }

  const closeMessageNavigation = () => {
    isMessageNavigationOpen.value = false
  }

  const toggleMessageNavigation = () => {
    isMessageNavigationOpen.value = !isMessageNavigationOpen.value
  }

  return {
    isThreadSidebarOpen,
    isMessageNavigationOpen,
    openThreadSidebar,
    closeThreadSidebar,
    toggleThreadSidebar,
    openMessageNavigation,
    closeMessageNavigation,
    toggleMessageNavigation
  }
}

export const useLayoutStore = defineStore('layout', createLayoutStore)
