import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  shortcutDestroyRoute,
  shortcutRegisterRoute,
  shortcutUnregisterRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createShortcutClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function registerShortcuts() {
    const result = await bridge.invoke(shortcutRegisterRoute.name, {})
    return result.registered
  }

  async function unregisterShortcuts() {
    const result = await bridge.invoke(shortcutUnregisterRoute.name, {})
    return result.unregistered
  }

  async function destroy() {
    const result = await bridge.invoke(shortcutDestroyRoute.name, {})
    return result.destroyed
  }

  return {
    registerShortcuts,
    unregisterShortcuts,
    destroy
  }
}

export type ShortcutClient = ReturnType<typeof createShortcutClient>
