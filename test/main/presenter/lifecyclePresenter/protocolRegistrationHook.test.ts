import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProtocolHandle, mockGetPath, mockFsExistsSync, mockFsReadFileSync } = vi.hoisted(() => {
  return {
    mockProtocolHandle: vi.fn(),
    mockGetPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return '/Users/zerob13/Library/Application Support/DeepChat'
      }
      return '/mock/path'
    }),
    mockFsExistsSync: vi.fn(),
    mockFsReadFileSync: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath
  },
  protocol: {
    handle: mockProtocolHandle
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const mockedFs = {
    ...actual,
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync
  }
  return {
    ...mockedFs,
    default: mockedFs
  }
})

import { protocolRegistrationHook } from '../../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook'

describe('protocolRegistrationHook deepchat-media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFsExistsSync.mockReset()
    mockFsReadFileSync.mockReset()
  })

  it('resolves deepchat-media URLs with absolute path and encoded spaces', async () => {
    await protocolRegistrationHook.execute({} as any)

    const deepchatMediaHandler = mockProtocolHandle.mock.calls.find(
      ([scheme]: [string]) => scheme === 'deepchat-media'
    )?.[1] as ((request: { url: string }) => Response) | undefined

    expect(deepchatMediaHandler).toBeDefined()

    const expectedPath =
      '/Users/zerob13/Library/Application Support/DeepChat/media-cache/img-test-1.jpg'
    mockFsExistsSync.mockImplementation((targetPath) => String(targetPath) === expectedPath)
    mockFsReadFileSync.mockReturnValue(Buffer.from('ok'))

    const response = deepchatMediaHandler!({
      url: 'deepchat-media:///Users/zerob13/Library/Application%20Support/DeepChat/media-cache/img-test-1.jpg'
    })

    expect(response.status).toBe(200)
    expect(mockFsExistsSync).toHaveBeenCalledWith(expectedPath)
    expect(mockFsReadFileSync).toHaveBeenCalledWith(expectedPath)
  })

  it('resolves deepchat-media URLs in host + pathname form', async () => {
    await protocolRegistrationHook.execute({} as any)

    const deepchatMediaHandler = mockProtocolHandle.mock.calls.find(
      ([scheme]: [string]) => scheme === 'deepchat-media'
    )?.[1] as ((request: { url: string }) => Response) | undefined

    expect(deepchatMediaHandler).toBeDefined()

    const expectedPath =
      '/Users/zerob13/Library/Application Support/DeepChat/media-cache/img-test-2.jpg'
    mockFsExistsSync.mockImplementation((targetPath) => String(targetPath) === expectedPath)
    mockFsReadFileSync.mockReturnValue(Buffer.from('ok'))

    const response = deepchatMediaHandler!({
      url: 'deepchat-media://Users/zerob13/Library/Application%20Support/DeepChat/media-cache/img-test-2.jpg'
    })

    expect(response.status).toBe(200)
    expect(mockFsExistsSync).toHaveBeenCalledWith(expectedPath)
    expect(mockFsReadFileSync).toHaveBeenCalledWith(expectedPath)
  })

  it('rejects deepchat-media URLs outside media-cache directory', async () => {
    await protocolRegistrationHook.execute({} as any)

    const deepchatMediaHandler = mockProtocolHandle.mock.calls.find(
      ([scheme]: [string]) => scheme === 'deepchat-media'
    )?.[1] as ((request: { url: string }) => Response) | undefined

    expect(deepchatMediaHandler).toBeDefined()

    const response = deepchatMediaHandler!({
      url: 'deepchat-media:///etc/passwd'
    })

    expect(response.status).toBe(400)
    expect(mockFsReadFileSync).not.toHaveBeenCalled()
  })
})
