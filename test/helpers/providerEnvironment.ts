import { buildDefaultProviderHeaders } from '../../src/main/provider/providerHeaders'
import type { ProviderEnvironmentPort } from '../../src/main/provider/ports'

export const providerTestEnvironment: ProviderEnvironmentPort = {
  getLanguage: () => 'en-US',
  defaultHeaders: Object.freeze(buildDefaultProviderHeaders('0.0.0-test')),
  allowInsecureTls: false
}
