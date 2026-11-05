import { session } from 'electron'
import type { ProxySessionApplier } from '../proxy'

/** Applies proxy settings to Electron's default session. */
export const electronProxyApplier: ProxySessionApplier = {
  async applySystem(): Promise<string> {
    await session.defaultSession.setProxy({ mode: 'system' })
    return await session.defaultSession.resolveProxy('https://www.google.com')
  },

  async applyDirect(): Promise<void> {
    await session.defaultSession.setProxy({ mode: 'direct' })
  },

  async applyRules(rules: string): Promise<void> {
    await session.defaultSession.setProxy({ proxyRules: rules })
  }
}
