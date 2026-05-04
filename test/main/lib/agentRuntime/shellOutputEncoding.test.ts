import { afterEach, describe, expect, it } from 'vitest'
import {
  createUtf8StreamDecoder,
  prepareProcessEnvForUtf8Output,
  prepareShellCommandForUtf8Output
} from '@/lib/agentRuntime/shellOutputEncoding'

describe('shellOutputEncoding', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('wraps Windows PowerShell commands with UTF-8 console encoding', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    const command = prepareShellCommandForUtf8Output('powershell.exe', 'dir')

    expect(command).toContain('[Console]::OutputEncoding')
    expect(command).toContain('$OutputEncoding')
    expect(command).toMatch(/; dir$/)
  })

  it('wraps Windows cmd commands with UTF-8 code page setup', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    expect(prepareShellCommandForUtf8Output('cmd.exe', 'dir')).toBe('chcp 65001 > nul && dir')
  })

  it('keeps non-Windows commands unchanged', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })

    expect(prepareShellCommandForUtf8Output('/bin/zsh', 'ls')).toBe('ls')
  })

  it('adds Python UTF-8 environment for Windows direct processes', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32'
    })

    expect(prepareProcessEnvForUtf8Output({ PATH: 'C:\\bin' })).toEqual({
      PATH: 'C:\\bin',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    })
  })

  it('keeps direct process environment unchanged outside Windows', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux'
    })
    const env = { PATH: '/bin' }

    expect(prepareProcessEnvForUtf8Output(env)).toBe(env)
  })

  it('decodes UTF-8 text split across chunks', () => {
    let output = ''
    const decoder = createUtf8StreamDecoder((text) => {
      output += text
    })
    const bytes = Buffer.from('中文.txt\n', 'utf8')

    decoder.write(bytes.subarray(0, 2))
    decoder.write(bytes.subarray(2))
    decoder.end()

    expect(output).toBe('中文.txt\n')
  })

  it('passes string chunks through without re-encoding', () => {
    let output = ''
    const decoder = createUtf8StreamDecoder((text) => {
      output += text
    })

    decoder.write('中文.txt\n')
    decoder.end()

    expect(output).toBe('中文.txt\n')
  })
})
