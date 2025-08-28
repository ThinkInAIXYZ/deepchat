/**
 * built-in knowledge destroy hook
 */

import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import { presenter } from '@/presenter'
import { LifecyclePhase } from '@shared/lifecycle'

export const builtinKnowledgeDestroyHook: LifecycleHook = {
  name: 'builtinKnowledge-destroy',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 1, // will block app quit, mush first
  critical: false,
  execute: async (_context: LifecycleContext) => {
    console.log('builtinKnowledgeDestroyHook: Destroy builtinKnowledge')

    // Ensure presenter is available
    if (!presenter) {
      throw new Error('builtinKnowledgeDestroyHook: Presenter has been destroyed')
    }

    // knowledgePresenter task manager must be destroyed before app quit
    // ask user to confirm if there are still tasks running
    const confirmed = await presenter.knowledgePresenter.beforeDestroy()
    if (confirmed) {
      console.log('builtinKnowledgeDestroyHook: builtinKnowledge destroyed successfully')
    } else {
      console.log('builtinKnowledgeDestroyHook: user canceled close confirm')
    }
    return confirmed
  }
}
