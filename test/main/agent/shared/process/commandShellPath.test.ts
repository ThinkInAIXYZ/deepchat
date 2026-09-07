import { describe, expect, it } from 'vitest'
import {
  normalizeCommandShellFilePath,
  UnsupportedCommandShellPathError
} from '@/agent/shared/process/commandShellPath'

describe('normalizeCommandShellFilePath', () => {
  it('converts supported MSYS drive paths to normalized Windows paths', () => {
    expect(normalizeCommandShellFilePath('/c/Users/yuyu/file.txt', 'msys')).toBe(
      'C:\\Users\\yuyu\\file.txt'
    )
    expect(normalizeCommandShellFilePath('/D/work/../repo', 'msys')).toBe('D:\\repo')
    expect(normalizeCommandShellFilePath('/e', 'msys')).toBe('E:\\')
  })

  it('leaves native and already-Windows paths unchanged', () => {
    expect(normalizeCommandShellFilePath('/tmp/file.txt', 'native')).toBe('/tmp/file.txt')
    expect(normalizeCommandShellFilePath('C:\\repo\\file.txt', 'msys')).toBe('C:\\repo\\file.txt')
  })

  it.each(['/usr/bin/bash', '//server/share', '/c/mixed\\path', '/cc/file'])(
    'rejects unsupported absolute MSYS path %s',
    (requestedPath) => {
      expect(() => normalizeCommandShellFilePath(requestedPath, 'msys')).toThrow(
        UnsupportedCommandShellPathError
      )
    }
  )
})
