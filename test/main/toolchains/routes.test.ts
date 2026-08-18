import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { createRendererRouteContext } from '@/routes/routeRegistry'
import { createToolchainRoutes } from '@/toolchains/routes'
import { ToolchainService } from '@/toolchains/service'
import { NODE_MODULE_VERSION, NODE_PIN } from '@/toolchains/catalog'

afterEach(() => {
  ToolchainService.resetForTests()
})

describe('toolchain routes', () => {
  it('returns derived state when custom path picking is canceled', async () => {
    const service = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-app-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })
    const routes = createToolchainRoutes({
      service,
      pickPath: async () => ({ canceled: true, filePaths: [] })
    })

    await expect(
      routes.get('toolchains.pickCustom')?.({ kind: 'node' }, createRendererRouteContext(1, null))
    ).resolves.toEqual({
      canceled: true,
      state: {
        schemaVersion: 1,
        node: { source: 'unconfigured' },
        uv: { source: 'unconfigured' }
      }
    })
  })
})
