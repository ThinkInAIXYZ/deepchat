import type { TapeApplicationProviders } from '../ports/application'

type TapeGenerationLifecycleProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getEntryLifecycleStore' | 'getSearchProjectionStore'
>

export function deleteTapeGeneration(
  providers: TapeGenerationLifecycleProviders,
  sessionId: string
): void {
  const table = providers.getEntryStore()
  table.runInTransaction(() => {
    providers.getEntryLifecycleStore().deleteBySession(sessionId)
    providers.getSearchProjectionStore().deleteBySession(sessionId)
  })
}

export function resetTapeGeneration(
  providers: TapeGenerationLifecycleProviders,
  sessionId: string
): void {
  const table = providers.getEntryStore()
  table.runInTransaction(() => {
    providers.getEntryLifecycleStore().deleteBySession(sessionId)
    providers.getSearchProjectionStore().deleteBySession(sessionId)
    table.ensureBootstrapAnchor(sessionId)
  })
}
