import { runBackgroundExecUtilityHostIfRequested } from './lib/agentRuntime/backgroundExecUtilityHost'

if (!runBackgroundExecUtilityHostIfRequested()) {
  void import('./appMain')
}
