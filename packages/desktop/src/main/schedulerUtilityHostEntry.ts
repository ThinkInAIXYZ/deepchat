import { runSchedulerUtilityHostIfRequested } from './scheduler/schedulerUtilityHost'

if (!runSchedulerUtilityHostIfRequested()) {
  throw new Error('Cron scheduler utility host entrypoint started outside a utility process.')
}
