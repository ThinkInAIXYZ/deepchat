import { MemoryService as ProductionMemoryService } from '../../../../src/main/memory/index'
import type {
  MemoryDirectiveRepositoryPort,
  MemoryServiceDeps
} from '../../../../src/main/memory/types'

export * from '../../../../src/main/memory/index'

type OptionalTestDependency =
  | 'executeWithRateLimit'
  | 'generateText'
  | 'getDimensions'
  | 'markVectorStoreQuarantined'
  | 'directiveRepository'
  | 'resetVectorStore'

type MemoryServiceTestDeps = Omit<MemoryServiceDeps, OptionalTestDependency> &
  Partial<Pick<MemoryServiceDeps, OptionalTestDependency>>

function createEmptyDirectiveRepository(): MemoryDirectiveRepositoryPort {
  const unsupportedWrite = (): never => {
    throw new Error('[MemoryTest] directive writes require an explicit test repository')
  }
  return {
    getDirective: () => undefined,
    listDirectives: () => [],
    listActiveDirectives: () => [],
    upsertExplicitDirective: unsupportedWrite,
    insertDerivedDirectiveDraft: unsupportedWrite,
    transitionDirective: unsupportedWrite,
    deleteDirective: unsupportedWrite,
    countDirectivesByStatus: () => ({ draft: 0, active: 0, rejected: 0 }),
    retireDirectiveNamespace: () => 0
  }
}

export class MemoryService extends ProductionMemoryService {
  constructor(deps: MemoryServiceTestDeps) {
    super({
      directiveRepository: createEmptyDirectiveRepository(),
      executeWithRateLimit: async () => undefined,
      generateText: async () => '',
      getDimensions: async () => ({ data: { dimensions: 0, normalized: false } }),
      markVectorStoreQuarantined: () => undefined,
      resetVectorStore: async () => undefined,
      ...deps
    })
  }
}
