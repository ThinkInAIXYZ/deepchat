import {
  AgentInvocationAdmission,
  type AgentInvocationAdmissionSnapshot,
  type AgentInvocationPermit
} from '@/agent/invocationAdmission'

export const DEFAULT_WORKFLOW_RUN_CAPACITY = 4
export const DEFAULT_WORKFLOW_RUN_MAX_PENDING = 64

export interface WorkflowRunAdmissionPort {
  acquire(options: { ownerId: string; signal?: AbortSignal }): Promise<AgentInvocationPermit>
  availableSchedulingSlots(): number
}

export class WorkflowRunAdmission implements WorkflowRunAdmissionPort {
  private readonly admission: AgentInvocationAdmission

  constructor(
    private readonly capacity = DEFAULT_WORKFLOW_RUN_CAPACITY,
    private readonly maxPending = DEFAULT_WORKFLOW_RUN_MAX_PENDING
  ) {
    this.admission = new AgentInvocationAdmission(capacity, maxPending)
  }

  acquire(options: { ownerId: string; signal?: AbortSignal }): Promise<AgentInvocationPermit> {
    return this.admission.acquire(options)
  }

  availableSchedulingSlots(): number {
    const snapshot = this.admission.snapshot()
    return snapshot.closed
      ? 0
      : Math.max(0, this.capacity + this.maxPending - snapshot.active - snapshot.pending)
  }

  snapshot(): AgentInvocationAdmissionSnapshot {
    return this.admission.snapshot()
  }

  close(reason = 'Workflow run admission is closed.'): void {
    this.admission.close(reason)
  }
}
