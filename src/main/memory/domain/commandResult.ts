import type {
  MemoryCommandRejectionReason,
  MemoryCommandResult
} from '@shared/contracts/routes/memory.routes'

export function memoryCommandApplied(): MemoryCommandResult {
  return { action: 'applied' }
}

export function memoryCommandRejected(reason: MemoryCommandRejectionReason): MemoryCommandResult {
  return { action: 'rejected', reason }
}
