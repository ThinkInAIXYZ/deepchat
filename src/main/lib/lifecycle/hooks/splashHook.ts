import { LifecyclePhase } from '@shared/lifecycle'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'

/**
 * Database initialization hook for the init phase
 * This hook initializes the database and makes it available to other components
 */
export const splashHook: LifecycleHook = {
  name: 'splash-block',
  phase: LifecyclePhase.BEFORE_START,
  priority: 10,
  async execute(_context: LifecycleContext): Promise<void> {
    const timeout = import.meta.env.VITE_APP_SPLASH_TIMEOUT || 0
    console.log(`Splash will blocked ${timeout}ms`)
    // delay 10s
    await new Promise((resolve) => setTimeout(resolve, timeout))
  }
}
