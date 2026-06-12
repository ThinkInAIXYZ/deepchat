import { runBackgroundExecUtilityHostIfRequested } from './lib/agentRuntime/backgroundExecUtilityHost'

if (!runBackgroundExecUtilityHostIfRequested()) {
  throw new Error('Background exec utility host entrypoint started outside a utility process.')
}
