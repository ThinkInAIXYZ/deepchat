/**
 * 延迟加载 Icon 集合，优化应用启动性能
 * Icons are loaded on-demand after app initialization to reduce startup time
 */

import type lucideIconsType from '@iconify-json/lucide/icons.json'
import type vscodeIconsType from '@iconify-json/vscode-icons/icons.json'

interface IconLoadState {
  isLoading: boolean
  isLoaded: boolean
  loadPromise: Promise<void> | null
}

const state: IconLoadState = {
  isLoading: false,
  isLoaded: false,
  loadPromise: null
}

/**
 * 确保 Icon 集合已加载
 * 如果已加载，直接返回
 * 如果正在加载，返回当前的 Promise
 * 如果未加载，开始加载并返回 Promise
 */
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
      // 动态导入 icon 数据和 addCollection，延迟加载
      const [{ addCollection }, lucideIcons, vscodeIcons] = await Promise.all([
        import('@iconify/vue').then((m) => ({ addCollection: m.addCollection })),
        import('@iconify-json/lucide/icons.json').then((m) => m.default as typeof lucideIconsType),
        import('@iconify-json/vscode-icons/icons.json').then(
          (m) => m.default as typeof vscodeIconsType
        )
      ])

      // 检查 addCollection 是否存在（可能在测试中被mock）
      if (typeof addCollection === 'function') {
        // 添加到 Iconify 注册表
        addCollection(lucideIcons)
        addCollection(vscodeIcons)
      }

      state.isLoaded = true
      console.info('[Startup][Renderer] Icons loaded successfully')
    } catch (error) {
      console.error('[Startup][Renderer] Failed to load icons:', error)
      // 继续执行，不要因为 icon 加载失败而中断应用
      state.isLoaded = true
    } finally {
      state.isLoading = false
    }
  })()

  return state.loadPromise
}

/**
 * 预加载 Icon 集合（不等待）
 * 可用于在应用空闲时预加载
 */
export function preloadIcons(): Promise<void> {
  if (!state.isLoaded && !state.isLoading) {
    return ensureIconsLoaded()
  }
  return Promise.resolve()
}
