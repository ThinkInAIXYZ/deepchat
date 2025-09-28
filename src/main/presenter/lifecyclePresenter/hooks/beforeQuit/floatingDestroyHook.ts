/**
 * Floating destroy hook
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const floatingDestroyHook: LifecycleHook = {
  name: 'floating-destroy',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 10,
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('floatingDestroyHook: Destroy floating')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('floatingDestroyHook: Presenter has been destroyed')
    }

    try {
      presenter.floatingButtonPresenter.destroy()
    } catch (error) {
      console.error(
        'floatingDestroyHook: Error destroying floating button during before-quit:',
        error
      )
    }
    console.log('floatingDestroyHook: floating destroyed successfully')
  }
}
