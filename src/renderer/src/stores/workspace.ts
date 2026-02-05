import { defineStore } from 'pinia'
import { createWorkspaceStore } from '@/composables/workspace/useWorkspaceStoreService'

export { createWorkspaceStore }

export const useWorkspaceStore = defineStore('workspace', () => createWorkspaceStore())
