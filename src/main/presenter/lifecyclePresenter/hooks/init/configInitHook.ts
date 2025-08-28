/**
 * Configuration initialization hook for init phase
 * Initializes application configuration
 *
 * Setup log and proxy
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { setLoggingEnabled } from '@shared/logger'
import { proxyConfig, ProxyMode } from '@/presenter/proxyConfig'
import { ConfigPresenter } from '@/presenter/configPresenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const configInitHook: LifecycleHook = {
  name: 'config-initialization',
  phase: LifecyclePhase.INIT,
  priority: 1, // first in init phase
  critical: true,
  execute: async (context: LifecycleContext) => {
    console.log('configInitHook: Initializing application configuration')

    // Ensure presenter is available (should be initialized by database hook)
    const configPresenter = new ConfigPresenter()

    // Read logging settings from config and apply
    const loggingEnabled = configPresenter.getLoggingEnabled()
    setLoggingEnabled(loggingEnabled)

    // Read proxy settings from config and initialize
    const proxyMode = configPresenter.getProxyMode() as ProxyMode
    const customProxyUrl = configPresenter.getCustomProxyUrl()
    proxyConfig.initFromConfig(proxyMode as ProxyMode, customProxyUrl)

    // Store config in context for other hooks
    context.config = configPresenter

    console.log('configInitHook: Application configuration initialized successfully')
  }
}
