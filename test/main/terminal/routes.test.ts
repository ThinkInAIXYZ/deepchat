import { describe, expect, it, vi } from 'vitest'
import { createTerminalRoutes } from '@/terminal/routes'
import type { SessionTerminalService } from '@/terminal/sessionTerminalService'
import { createRendererRouteContext, type RouteContext } from '@/routes/routeRegistry'

const snapshot = {
  terminalId: 'terminal-1',
  cwd: '/workspace',
  shell: '/bin/zsh',
  replay: '',
  outputEnd: 0,
  status: 'running' as const
}

function setup(options: { chatWindow?: boolean; viewing?: boolean } = {}) {
  const terminals = {
    attach: vi.fn(async () => snapshot),
    restart: vi.fn(async () => snapshot)
  }
  const routes = createTerminalRoutes({
    terminals: terminals as unknown as SessionTerminalService,
    isChatWindowContext: () => options.chatWindow ?? true,
    isViewingSession: () => options.viewing ?? true
  })
  const invoke = (name: string, input: unknown, context: RouteContext) =>
    routes.get(name as never)!(input, context)
  return { terminals, invoke }
}

const input = { sessionId: 'session-1', cols: 80, rows: 24 }
const rendererContext = createRendererRouteContext(7, 3)

describe('terminal routes', () => {
  it('opens a terminal for the session shown in the calling chat window', async () => {
    const { terminals, invoke } = setup()

    await expect(invoke('terminal.attach', input, rendererContext)).resolves.toEqual(snapshot)
    expect(terminals.attach).toHaveBeenCalledWith('session-1', 7, { cols: 80, rows: 24 })
  })

  it.each(['terminal.attach', 'terminal.restart'])(
    'rejects %s for a session the window is not showing',
    async (route) => {
      const { terminals, invoke } = setup({ viewing: false })

      await expect(invoke(route, input, rendererContext)).rejects.toThrow('[terminal:forbidden]')
      expect(terminals.attach).not.toHaveBeenCalled()
      expect(terminals.restart).not.toHaveBeenCalled()
    }
  )

  it('rejects non-chat windows and non-renderer callers', async () => {
    const { invoke } = setup({ chatWindow: false })
    await expect(invoke('terminal.attach', input, rendererContext)).rejects.toThrow('chat window')

    const cli = { caller: { kind: 'internal', component: 'scheduler' } } as const
    await expect(setup().invoke('terminal.attach', input, cli)).rejects.toThrow('renderer caller')
  })
})
