/**
 * Public entry of the portable agent kernel.
 *
 * The composition factory plus the instance owners form the supported surface; every module is
 * additionally reachable through its explicit subpath export. Host shims and the Desktop facade
 * import subpaths, so this barrel stays deliberately small and collision-free.
 */
export {
  createDeepChatRuntimeServices,
  type DeepChatKernelDependencies,
  type DeepChatKernelServices,
  type DeepChatKernelSessionData,
  type DeepChatKernelSkillPort
} from './composition/createDeepChatRuntimeServices.js'
export type {
  PendingInputDrain,
  PendingInputWakeupBinding
} from './composition/pendingInputWakeupBinding.js'
export { DeepChatAgentInstance } from './instance/deepChatAgentInstance.js'
export { DeepChatAgentRuntime } from './instance/deepChatAgentRuntime.js'
