/**
 * Public surface of the DeepChat agent runtime.
 *
 * The composed owner graph, its factory, and the pending-input wakeup binding stay package-private
 * so callers cannot reach an owner around the harness or build a second runtime with its own
 * restart-recovery side effects. The exported names here are enforced by the agent cleanup guard.
 */
export { createDeepChatAgentHarness } from './createDeepChatAgentHarness'
export type { DeepChatAgentHarness } from './deepChatAgentHarness'
export type { DeepChatHarnessDependencies, DeepChatHarnessSkillPort } from './runtimeServices'
