import { describe, expect, it } from 'vitest'
import {
  consumeStartupDeepLink,
  findDeepLinkArg,
  findStartupDeepLink,
  storeStartupDeepLink
} from '@/lib/startupDeepLink'

describe('startupDeepLink utilities', () => {
  it('prefers stored startup deeplink over argv and secondary env keys', () => {
    const env = {
      STARTUP_DEEPLINK: 'deepchat://start?msg=stored',
      DEEPLINK_URL: 'deepchat://start?msg=env'
    } as NodeJS.ProcessEnv

    expect(findStartupDeepLink(['electron', 'deepchat://start?msg=argv'], env)).toBe(
      'deepchat://start?msg=stored'
    )
  })

  it('falls back to argv before secondary env deeplinks', () => {
    const env = {
      DEEPLINK_URL: 'deepchat://start?msg=env'
    } as NodeJS.ProcessEnv

    expect(findStartupDeepLink(['electron', 'deepchat://start?msg=argv'], env)).toBe(
      'deepchat://start?msg=argv'
    )
  })

  it('stores and consumes startup deeplink exactly once', () => {
    const env = {} as NodeJS.ProcessEnv

    expect(storeStartupDeepLink('deepchat://start?msg=hello', env)).toBe(
      'deepchat://start?msg=hello'
    )
    expect(consumeStartupDeepLink(env)).toBe('deepchat://start?msg=hello')
    expect(consumeStartupDeepLink(env)).toBeNull()
  })

  it('finds deeplink arguments from a command line', () => {
    expect(findDeepLinkArg(['electron', '--flag', 'deepchat://provider/install?v=1'])).toBe(
      'deepchat://provider/install?v=1'
    )
  })

  it('ignores strings that only contain a deeplink later in the value', () => {
    expect(findDeepLinkArg(['electron', 'https://example.com/?next=deepchat://start?msg=1'])).toBe(
      null
    )
    expect(findDeepLinkArg(['electron', 'prefix deepchat://start?msg=1'])).toBeNull()
  })
})
