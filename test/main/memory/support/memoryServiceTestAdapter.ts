import { MemoryService as ProductionMemoryService } from '../../../../src/main/memory/index'
import type { MemoryServiceDeps } from '../../../../src/main/memory/types'

export * from '../../../../src/main/memory/index'

type OptionalTestDependency =
  | 'executeWithRateLimit'
  | 'generateText'
  | 'getDimensions'
  | 'markVectorStoreQuarantined'
  | 'resetVectorStore'

type MemoryServiceTestDeps = Omit<MemoryServiceDeps, OptionalTestDependency> &
  Partial<Pick<MemoryServiceDeps, OptionalTestDependency>>

export class MemoryService extends ProductionMemoryService {
  constructor(deps: MemoryServiceTestDeps) {
    super({
      executeWithRateLimit: async () => undefined,
      generateText: async () => '',
      getDimensions: async () => ({ data: { dimensions: 0, normalized: false } }),
      markVectorStoreQuarantined: () => undefined,
      resetVectorStore: async () => undefined,
      ...deps
    })
  }
}
