import type { LLM_PROVIDER } from '@shared/types/provider'

/**
 * Projects a stored provider into the summary the renderer lists.
 *
 * Models are omitted on purpose: the list view only needs identity and status,
 * and shipping every model would make the startup payload large. Shared so the
 * Electron main process and the Node sidecar project the same shape.
 */
export function toProviderSummary(
  provider: LLM_PROVIDER
): Omit<LLM_PROVIDER, 'models' | 'customModels' | 'enabledModels' | 'disabledModels'> {
  const {
    models: _models,
    customModels: _customModels,
    enabledModels: _enabledModels,
    disabledModels: _disabledModels,
    ...summary
  } = provider
  return summary
}
