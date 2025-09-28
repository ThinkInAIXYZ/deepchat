/**
 * presenter destroy hook
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const presenterDestroyHook: LifecycleHook = {
  name: 'presenter-destroy',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: Number.MAX_VALUE, // make sure presenter be destroyed lastest
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('presenterDestroyHook: Destroy system presenter')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('presenterDestroyHook: Presenter has been destroyed')
    }

    presenter.destroy()

    console.log('presenterDestroyHook: System presenter destroyed successfully')
  }
}
