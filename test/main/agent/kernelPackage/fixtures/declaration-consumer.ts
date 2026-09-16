// Declaration-consumer probe for the agent kernel gate: forces `tsc --noEmit` to resolve the
// complete `.d.ts` closure of the package entry through the consumer's own node_modules.
import {
  createDeepChatRuntimeServices,
  DeepChatAgentInstance,
  DeepChatAgentRuntime,
  type DeepChatKernelDependencies,
  type DeepChatKernelServices
} from '@deepchat/agent-kernel'

// Deep type probes: resolving these member types walks the emitted declaration closure.
export type KernelServicesProbe = DeepChatKernelServices
export type KernelSessionDataProbe = DeepChatKernelDependencies['sessionData']
export type KernelTurnCoordinatorProbe = DeepChatKernelServices['turnCoordinator']
export type KernelRuntimeStateProbe = ReturnType<DeepChatAgentRuntime['scopeFor']>
export type KernelInstanceProbe = DeepChatAgentInstance

export const declareKernelUse = (): number => {
  void createDeepChatRuntimeServices
  void DeepChatAgentInstance
  void DeepChatAgentRuntime
  return 0
}
