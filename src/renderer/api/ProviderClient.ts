import type { DeepchatBridge } from '@shared/contracts/bridge'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import { providersListModelsRoute, providersTestConnectionRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class ProviderClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async listModels(providerId: string) {
    return await this.bridge.invoke(providersListModelsRoute.name, {
      providerId
    } as DeepchatRouteInput<typeof providersListModelsRoute.name>)
  }

  async testConnection(input: { providerId: string; modelId?: string }) {
    return await this.bridge.invoke(
      providersTestConnectionRoute.name,
      input as DeepchatRouteInput<typeof providersTestConnectionRoute.name>
    )
  }
}
