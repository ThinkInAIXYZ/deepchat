import { StringDecoder } from 'string_decoder'
import type { CommandShellDialect } from '@shared/commandShell'

const POWERSHELL_UTF8_PREAMBLE =
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)'

const CMD_UTF8_PREAMBLE = 'chcp 65001 > nul'

export function prepareProcessEnvForUtf8Output(
  env: Record<string, string>
): Record<string, string> {
  if (process.platform !== 'win32') {
    return env
  }

  return {
    ...env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
}

export function prepareShellCommandForUtf8Output(
  dialect: CommandShellDialect,
  command: string
): string {
  if (process.platform !== 'win32') {
    return command
  }

  switch (dialect) {
    case 'powershell':
      return `${POWERSHELL_UTF8_PREAMBLE}; ${command}`
    case 'cmd':
      return `${CMD_UTF8_PREAMBLE} && ${command}`
    case 'posix':
      return command
  }
}

export function createUtf8StreamDecoder(onText: (text: string) => void): {
  write: (chunk: Buffer | string) => void
  end: () => void
} {
  const decoder = new StringDecoder('utf8')

  return {
    write(chunk) {
      if (typeof chunk === 'string') {
        if (chunk) {
          onText(chunk)
        }
        return
      }

      const text = decoder.write(chunk)
      if (text) {
        onText(text)
      }
    },
    end() {
      const text = decoder.end()
      if (text) {
        onText(text)
      }
    }
  }
}

export function createUtf8OutputDecoderPair(onText: (text: string) => void): {
  writeStdout: (chunk: Buffer | string) => void
  writeStderr: (chunk: Buffer | string) => void
  flushStdout: () => void
  flushStderr: () => void
  flush: () => void
} {
  const stdout = createUtf8StreamDecoder(onText)
  const stderr = createUtf8StreamDecoder(onText)
  let stdoutFlushed = false
  let stderrFlushed = false

  const flushStdout = () => {
    if (stdoutFlushed) {
      return
    }
    stdoutFlushed = true
    stdout.end()
  }

  const flushStderr = () => {
    if (stderrFlushed) {
      return
    }
    stderrFlushed = true
    stderr.end()
  }

  return {
    writeStdout(chunk) {
      stdout.write(chunk)
    },
    writeStderr(chunk) {
      stderr.write(chunk)
    },
    flushStdout,
    flushStderr,
    flush() {
      flushStdout()
      flushStderr()
    }
  }
}
