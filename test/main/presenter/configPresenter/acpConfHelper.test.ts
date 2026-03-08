import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStores = vi.hoisted(() => new Map<string, Record<string, any>>())

const clone = <T>(value: T): T => {
  const cloneFn = (globalThis as typeof globalThis & { structuredClone?: (input: T) => T })
    .structuredClone

  if (typeof cloneFn === 'function') {
    return cloneFn(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly data: Record<string, any>

    constructor(options: { name: string; defaults?: Record<string, any> }) {
      if (!mockStores.has(options.name)) {
        mockStores.set(options.name, clone(options.defaults ?? {}))
      }
      this.data = mockStores.get(options.name)!
    }

    get(key: string) {
      return this.data[key]
    }

    set(key: string, value: any) {
      this.data[key] = value
    }

    delete(key: string) {
      delete this.data[key]
    }
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/mcpConfHelper', () => ({
  McpConfHelper: class MockMcpConfHelper {
    async getMcpServers() {
      return {}
    }
  }
}))

describe('AcpConfHelper DimCode builtin', () => {
  beforeEach(() => {
    mockStores.clear()
    vi.resetModules()
  })

  it('includes DimCode in default builtins with dim acp profile', async () => {
    const { AcpConfHelper } =
      await import('../../../../src/main/presenter/configPresenter/acpConfHelper')
    const helper = new AcpConfHelper()

    const dimcode = helper.getBuiltins().find((agent) => agent.id === 'dimcode-acp')

    expect(dimcode).toBeDefined()
    expect(dimcode?.name).toBe('DimCode')
    expect(dimcode?.profiles).toHaveLength(1)
    expect(dimcode?.profiles[0]?.command).toBe('dim')
    expect(dimcode?.profiles[0]?.args).toEqual(['acp'])
  })

  it('returns enabled DimCode from getEnabledAgents', async () => {
    const { AcpConfHelper } =
      await import('../../../../src/main/presenter/configPresenter/acpConfHelper')
    const helper = new AcpConfHelper()

    helper.setGlobalEnabled(true)
    helper.setBuiltinEnabled('dimcode-acp', true)

    expect(helper.getEnabledAgents()).toContainEqual(
      expect.objectContaining({
        id: 'dimcode-acp',
        name: 'DimCode - Default',
        command: 'dim',
        args: ['acp']
      })
    )
  })
})
