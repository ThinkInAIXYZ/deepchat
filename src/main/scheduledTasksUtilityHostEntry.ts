import { runScheduledTasksUtilityHostIfRequested } from './presenter/scheduledTasks/schedulerUtility/utilityHost'

if (!runScheduledTasksUtilityHostIfRequested()) {
  throw new Error('Scheduled tasks utility host entrypoint started outside a utility process.')
}
