import { ModelCapabilities as CoreModelCapabilities } from '@deepchat/provider/modelCapabilities'
import { providerDbLoader } from './providerDbLoader'
export * from '@deepchat/provider/modelCapabilities'
export class ModelCapabilities extends CoreModelCapabilities {
  constructor() {
    super(providerDbLoader)
  }
}
export const modelCapabilities = new ModelCapabilities()
