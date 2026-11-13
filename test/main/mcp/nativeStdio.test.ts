import { expect, it, vi } from 'vitest'
import type { MCPServerConfig } from '@shared/types/mcp'
import { nativeMcpStdio } from '@/mcp/nativeStdio'

const server = (patch: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
  command: 'node',
  args: ['server.mjs'],
  env: {},
  descriptions: '',
  icons: '',
  enabled: true,
  type: 'stdio',
  ...patch
})
const packaging = () => ({
  home: '/desktop-home',
  paths: ['/managed/bin'],
  expand: (value: string) => value.replace('~/', '/desktop-home/'),
  rewrite: vi.fn((_command: string, args: string[]) => ({ command: '/managed/node', args })),
  npmRegistry: 'https://npm.example',
  uvRegistry: 'https://uv.example'
})

it('maps managed commands and explicit environment bindings without mutating settings', () => {
  vi.stubEnv('DIM_MCP_TEST_BINDING', 'volatile-only')
  try {
    const config = server({
      args: ['~/server.mjs', '${DIM_MCP_TEST_BINDING}'],
      environmentVariables: ['DIM_MCP_TEST_BINDING'],
      env: { TOKEN: '${DIM_MCP_TEST_BINDING}', PATH: '/custom/bin' }
    })
    const before = JSON.stringify(config)
    const options = packaging()
    expect(nativeMcpStdio(config, options)).toMatchObject({
      type: 'stdio',
      command: '/managed/node',
      args: ['/desktop-home/server.mjs', 'volatile-only'],
      env: {
        TOKEN: 'volatile-only',
        HOME: '/desktop-home',
        npm_config_registry: 'https://npm.example',
        UV_DEFAULT_INDEX: 'https://uv.example'
      }
    })
    expect(JSON.stringify(config)).toBe(before)
    expect(options.rewrite).toHaveBeenCalledWith('node', [
      '/desktop-home/server.mjs',
      'volatile-only'
    ])
  } finally {
    vi.unstubAllEnvs()
  }
})

it('selects the product compatibility bridge for explicit process isolation or CWD', () => {
  const options = packaging()
  expect(nativeMcpStdio(server({ cwd: '/workspace' }), options)).toBeNull()
  expect(nativeMcpStdio(server({ inheritEnv: 'minimal' }), options)).toBeNull()
  expect(options.rewrite).not.toHaveBeenCalled()
})
