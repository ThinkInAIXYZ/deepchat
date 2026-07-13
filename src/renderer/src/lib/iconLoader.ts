/**
 * Load Iconify collections after app initialization to reduce startup cost.
 */

import { GENERATED_ICON_WHITELIST } from './icons/icon-whitelist.generated'

interface IconLoadState {
  isLoading: boolean
  isLoaded: boolean
  loadPromise: Promise<void> | null
}

type AddCollection = (collection: unknown) => void

const state: IconLoadState = {
  isLoading: false,
  isLoaded: false,
  loadPromise: null
}

let fullLucideCollectionPromise: Promise<void> | null = null
const reportedGeneratedIconMisses = new Set<string>()

export async function ensureIconsLoaded(): Promise<void> {
  if (state.isLoaded) {
    return
  }

  if (state.isLoading && state.loadPromise) {
    return state.loadPromise
  }

  state.isLoading = true

  state.loadPromise = (async () => {
    try {
      const [{ addCollection }, iconCollections] = await Promise.all([
        import('@iconify/vue').then((m) => ({ addCollection: m.addCollection as AddCollection })),
        import('./icons/icon-collections.generated')
      ])

      if (typeof addCollection === 'function') {
        addCollection(iconCollections.lucideIconCollection)
        addCollection(iconCollections.vscodeIconCollection)
        addCollection(iconCollections.lineMdIconCollection)
      }

      state.isLoaded = true
      console.info('[Startup][Renderer] Icons loaded successfully')
    } catch (error) {
      console.error('[Startup][Renderer] Failed to load icons:', error)
      state.isLoaded = true
    } finally {
      state.isLoading = false
    }
  })()

  return state.loadPromise
}

export function preloadIcons(): Promise<void> {
  if (!state.isLoaded && !state.isLoading) {
    return ensureIconsLoaded()
  }
  return Promise.resolve()
}

export function hasGeneratedIcon(icon: string): boolean {
  const [prefix, iconName] = icon.split(':')
  if (!prefix || !iconName) {
    return false
  }

  if (prefix === 'lucide') {
    return GENERATED_ICON_WHITELIST.lucide.includes(iconName)
  }
  if (prefix === 'vscode-icons') {
    return GENERATED_ICON_WHITELIST.vscodeIcons.includes(iconName)
  }
  if (prefix === 'line-md') {
    return GENERATED_ICON_WHITELIST.lineMd.includes(iconName)
  }
  return false
}

export async function ensureIconAvailable(icon: string): Promise<void> {
  if (hasGeneratedIcon(icon)) {
    return
  }

  const [prefix, iconName] = icon.split(':')
  if (prefix !== 'lucide' || !iconName) {
    return
  }

  if (import.meta.env.DEV && !reportedGeneratedIconMisses.has(icon)) {
    reportedGeneratedIconMisses.add(icon)
    console.warn(`[Startup][Renderer] Lucide icon was not in generated collection: ${icon}`)
  }

  if (!fullLucideCollectionPromise) {
    fullLucideCollectionPromise = Promise.all([
      import('@iconify/vue').then((m) => ({ addCollection: m.addCollection as AddCollection })),
      import('@iconify-json/lucide/icons.json').then((m) => m.default)
    ]).then(([{ addCollection }, lucideIcons]) => {
      if (typeof addCollection === 'function') {
        addCollection(lucideIcons)
      }
    })
  }

  return fullLucideCollectionPromise
}
