import {
  AgentInvocationAdmission,
  type AgentInvocationAdmissionSnapshot,
  type AgentInvocationPermit
} from '@/agent/invocationAdmission'

export const DEFAULT_WORKFLOW_RUN_CAPACITY = 4
export const DEFAULT_WORKFLOW_RUN_MAX_PENDING = 64

export interface WorkflowRunAdmissionPort {
  acquire(options: { ownerId: string; signal?: AbortSignal }): Promise<AgentInvocationPermit>
}

export class WorkflowRunAdmission implements WorkflowRunAdmissionPort {
  private readonly admission: AgentInvocationAdmission

  constructor(
    capacity = DEFAULT_WORKFLOW_RUN_CAPACITY,
    maxPending = DEFAULT_WORKFLOW_RUN_MAX_PENDING
  ) {
    this.admission = new AgentInvocationAdmission(capacity, maxPending)
  }

  acquire(options: { ownerId: string; signal?: AbortSignal }): Promise<AgentInvocationPermit> {
    return this.admission.acquire(options)
  }

  snapshot(): AgentInvocationAdmissionSnapshot {
    return this.admission.snapshot()
  }

  close(reason = 'Workflow run admission is closed.'): void {
    this.admission.close(reason)
  }
}
