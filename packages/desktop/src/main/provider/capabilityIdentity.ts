import { createCapabilityResolver } from '@deepchat/provider/capabilityIdentity'
import { modelCapabilities } from './modelCapabilities'
export * from '@deepchat/provider/capabilityIdentity'
export const {
  resolveCapabilityIdentity,
  resolveCapabilityFamilyHint,
  buildResolvedCapabilitySnapshot
} = createCapabilityResolver(modelCapabilities)
