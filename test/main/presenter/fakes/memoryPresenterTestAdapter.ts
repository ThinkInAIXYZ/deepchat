import { MemoryPresenter as ProductionMemoryPresenter } from '../../../../src/main/presenter/memoryPresenter/index'
import type { MemoryPresenterDeps } from '../../../../src/main/presenter/memoryPresenter/types'

export * from '../../../../src/main/presenter/memoryPresenter/index'

type OptionalTestDependency =
  | 'executeWithRateLimit'
  | 'generateText'
  | 'getDimensions'
  | 'resetVectorStore'

type MemoryPresenterTestDeps = Omit<MemoryPresenterDeps, OptionalTestDependency> &
  Partial<Pick<MemoryPresenterDeps, OptionalTestDependency>>

export class MemoryPresenter extends ProductionMemoryPresenter {
  constructor(deps: MemoryPresenterTestDeps) {
    super({
      executeWithRateLimit: async () => undefined,
      generateText: async () => '',
      getDimensions: async () => ({ data: { dimensions: 0, normalized: false } }),
      resetVectorStore: async () => undefined,
      ...deps
    })
  }
}
