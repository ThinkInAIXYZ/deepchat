import { z } from 'zod'
import { RutisAgentInvocationAdmission } from '@/harness/admission'
import type { AgentInvocationAdmissionDiagnosticsOptions } from '@shared/harness/admission'

export interface CoreAdmissionService {
  admission(generation: string, sequence: number, method: string, args: unknown[]): Promise<unknown>
}

export async function createCoreAdmission(
  service: CoreAdmissionService,
  generation: string,
  diagnostics?: AgentInvocationAdmissionDiagnosticsOptions
): Promise<RutisAgentInvocationAdmission> {
  const limits = z
    .object({
      capacity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      maxPending: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    })
    .strict()
    .parse(await service.admission(generation, 0, 'limits', []))
  let sequence = 0
  return RutisAgentInvocationAdmission.create({
    ...limits,
    diagnostics,
    runtime: {
      identity: undefined,
      request: async (method, args) => await service.admission(generation, ++sequence, method, args)
    }
  })
}
