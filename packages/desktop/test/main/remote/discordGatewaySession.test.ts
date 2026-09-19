import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordGatewaySession } from '@/remote/channels/discord/discordGatewaySession'

describe('DiscordGatewaySession', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('cancels the reconnect backoff when stop is called', async () => {
    vi.useFakeTimers()

    const onStatusChange = vi.fn()
    const session = new DiscordGatewaySession({
      client: { getGatewayUrl: vi.fn() } as never,
      onDispatch: vi.fn(),
      onStatusChange
    })
    ;(session as never as { startedOnce: boolean }).startedOnce = true
    ;(session as never as { connectOnce: unknown }).connectOnce = vi
      .fn()
      .mockRejectedValue(new Error('transient failure'))

    const connectOnceSpy = (session as never as { connectOnce: ReturnType<typeof vi.fn> })
      .connectOnce
    const startPromise = session.start()
    startPromise.catch(() => undefined)

    // Wait until the run loop is parked inside the reconnect backoff delay.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1))
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'backoff' }))
    expect(connectOnceSpy).toHaveBeenCalledTimes(1)

    await expect(session.stop()).resolves.toBeUndefined()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(connectOnceSpy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles start() when stop is called before the session reaches READY', async () => {
    let releaseConnectOnce: (() => void) | undefined
    const pendingConnection = new Promise<void>((resolve) => {
      releaseConnectOnce = resolve
    })
    const session = new DiscordGatewaySession({
      client: { getGatewayUrl: vi.fn() } as never,
      onDispatch: vi.fn()
    })
    ;(session as never as { connectOnce: unknown }).connectOnce = vi
      .fn()
      .mockReturnValue(pendingConnection)

    const startPromise = session.start()
    const startSettled = startPromise.then(
      () => 'resolved',
      (error: unknown) => `rejected: ${(error as Error).message}`
    )

    const stopPromise = session.stop()
    releaseConnectOnce?.()

    await expect(stopPromise).resolves.toBeUndefined()
    await expect(startSettled).resolves.toBe(
      'rejected: Discord gateway session stopped before connection.'
    )
  })
})
