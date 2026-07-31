import { runWorkflowUtilityHostIfRequested } from './workflow/runtime/workflowUtilityHost'

if (!runWorkflowUtilityHostIfRequested()) {
  throw new Error('Workflow utility host entry started without its host flag.')
}
