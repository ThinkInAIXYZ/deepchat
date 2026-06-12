import type { IMCPPresenter } from '@shared/presenter'

export interface ProviderMcpRuntimePort {
  getNpmRegistry?: IMCPPresenter['getNpmRegistry']
  getUvRegistry?: IMCPPresenter['getUvRegistry']
}
