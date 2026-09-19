import { runBackgroundExecUtilityHostIfRequested } from './agent/shared/process/backgroundExecUtilityHost'

if (!runBackgroundExecUtilityHostIfRequested()) {
  throw new Error('Background exec utility host entrypoint started outside a utility process.')
}
