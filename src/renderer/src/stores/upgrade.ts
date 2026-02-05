import { defineStore } from 'pinia'
import { createUpgradeStore } from '@/composables/upgrade/useUpgradeStoreService'

export { createUpgradeStore }

export const useUpgradeStore = defineStore('upgrade', () => createUpgradeStore())
