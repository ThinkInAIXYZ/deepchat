import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { FileService } from '../../../src/main/file'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? '/mock/user/data' : '/mock'))
  }
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    realpath: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('../../../src/main/file/validation')
vi.mock('../../../src/main/file/mime')
vi.mock('../../../src/main/file/adapters/BaseFileAdapter')
vi.mock('../../../src/main/file/adapters/DirectoryAdapter')
vi.mock('../../../src/main/file/adapters/UnsupportFileAdapter')
vi.mock('../../../src/main/file/adapters/ImageFileAdapter')
vi.mock('tokenx')
vi.mock('nanoid')

describe('FileService.readFile', () => {
  const mockSettings = { get: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.realpath).mockImplementation(async (targetPath: string) => {
      if (targetPath === '/mock/user/data') {
        return '/mock/user/data'
      }
      if (targetPath === '/mock/user/data/notes/today.md') {
        return '/mock/user/data/notes/today.md'
      }
      if (targetPath === '/mock/user/outside.txt') {
        return '/mock/outside.txt'
      }
      return targetPath
    })
  })

  it('reads relative files from the user data directory', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('hello world' as never)
    const presenter = new FileService(mockSettings)

    const content = await presenter.readFile('notes/today.md')

    expect(content).toBe('hello world')
    expect(fs.readFile).toHaveBeenCalledWith(
      path.resolve('/mock/user/data/notes/today.md'),
      'utf-8'
    )
  })

  it('rejects absolute paths', async () => {
    const presenter = new FileService(mockSettings)

    await expect(presenter.readFile('/etc/passwd')).rejects.toThrow(
      'Absolute paths are not allowed'
    )
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('rejects paths that escape the user data directory', async () => {
    const presenter = new FileService(mockSettings)

    await expect(presenter.readFile('../outside.txt')).rejects.toThrow(
      'File path escapes user data directory'
    )
    expect(fs.readFile).not.toHaveBeenCalled()
  })
})
