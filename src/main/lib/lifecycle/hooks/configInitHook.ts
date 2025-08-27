/**
 * Configuration initialization hook for init phase
 * Initializes application configuration and proxy settings
 */

import { LifecycleHook, LifecycleContext } from '../types'
import { presenter } from '../../../presenter'
import { ProxyMode, proxyConfig } from '../../../presenter/proxyConfig'
import { setLoggingEnabled } from '@shared/logger'

export const configInitHook: LifecycleHook = {
  name: 'config-initialization',
  priority: 5,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('Initializing application configuration')

    // Ensure presenter is available (should be initialized by database hook)
    if (!presenter) {
      throw new Error('Presenter not initialized - database hook should run first')
    }

    // TODO: Add 5-second delay to demonstrate splash window (for development/testing)
    console.log('Simulating configuration loading delay...')
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Read logging settings from config and apply
    const loggingEnabled = presenter.configPresenter.getLoggingEnabled()
    setLoggingEnabled(loggingEnabled)

    // Read proxy settings from config and initialize
    const proxyMode = presenter.configPresenter.getProxyMode() as ProxyMode
    const customProxyUrl = presenter.configPresenter.getCustomProxyUrl()
    proxyConfig.initFromConfig(proxyMode as ProxyMode, customProxyUrl)

    console.log('Application configuration initialized successfully')
  }
}
