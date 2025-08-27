import { LifecyclePhase } from '@shared/lifecycle'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { getInstance } from '@/presenter'

/**
 * Presenter lifecycle hook
 */
export const presenterInitHook: LifecycleHook = {
  name: 'presenter-initialization',
  phase: LifecyclePhase.READY,
  priority: 1,
  async execute(context: LifecycleContext): Promise<void> {
    // init presenter
    console.log('Create Presenter Instance')
    const presenter = getInstance(context.manager)
    presenter.deeplinkPresenter.init()
    context.presenter = presenter
  }
}
