import { defineStore } from 'pinia'
import { createWindowStore } from '@/composables/window/useWindowStoreService'

export { createWindowStore }

export const useWindowStore = defineStore('window', () => createWindowStore())
