import path from 'path'
import { StringDecoder } from 'string_decoder'

const POWERSHELL_UTF8_PREAMBLE =
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  '$OutputEncoding = [System.Text.UTF8Encoding]::new($false);'

const CMD_UTF8_PREAMBLE = 'chcp 65001 > nul'

export function prepareShellCommandForUtf8Output(shell: string, command: string): string {
  if (process.platform !== 'win32') {
    return command
  }

  const shellName = path.basename(shell).toLowerCase()
  if (
    shellName === 'powershell.exe' ||
    shellName === 'powershell' ||
    shellName === 'pwsh.exe' ||
    shellName === 'pwsh'
  ) {
    return `${POWERSHELL_UTF8_PREAMBLE} ${command}`
  }

  if (shellName === 'cmd.exe' || shellName === 'cmd') {
    return `${CMD_UTF8_PREAMBLE} && ${command}`
  }

  return command
}

export function createUtf8StreamDecoder(onText: (text: string) => void): {
  write: (chunk: Buffer | string) => void
  end: () => void
} {
  const decoder = new StringDecoder('utf8')

  return {
    write(chunk) {
      const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : decoder.write(Buffer.from(chunk))
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
