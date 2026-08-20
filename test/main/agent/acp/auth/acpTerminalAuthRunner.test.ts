import { describe, expect, it } from 'vitest'
import { AcpTerminalAuthRunner } from '@/agent/acp/auth/acpTerminalAuthRunner'

describe('AcpTerminalAuthRunner', () => {
  it('runs the authentication command in a PTY with its exact environment', async () => {
    const sentinelName = 'DEEPCHAT_ACP_AUTH_PARENT_ONLY'
    const previousSentinel = process.env[sentinelName]
    process.env[sentinelName] = 'parent-only'
    const runner = new AcpTerminalAuthRunner()
    const output: string[] = []
    try {
      const started = runner.start({
        ownerWebContentsId: 7,
        launch: {
          command: process.execPath,
          args: [
            '-e',
            `const valid = process.env.DEEPCHAT_ACP_AUTH_TEST === 'method-wins' && !process.env.${sentinelName}; process.stdout.write(valid ? 'PTY_AUTH_OK' : 'BAD_ENV'); process.exit(valid ? 0 : 2)`
          ],
          env: { DEEPCHAT_ACP_AUTH_TEST: 'method-wins' },
          cwd: process.cwd()
        },
        onData: (_runId, data) => output.push(data)
      })

      const exit = await started.completion

      expect(exit).toMatchObject({ exitCode: 0, reason: 'exited' })
      expect(output.join('')).toContain('PTY_AUTH_OK')
    } finally {
      if (previousSentinel === undefined) delete process.env[sentinelName]
      else process.env[sentinelName] = previousSentinel
    }
  })
})
