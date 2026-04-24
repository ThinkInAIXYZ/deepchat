import { shell } from 'electron'
import { normalizeExternalUrl } from '@shared/externalUrl'

export function openExternalUrl(url: string, source: string): boolean {
  const externalUrl = normalizeExternalUrl(url)
  if (!externalUrl) {
    console.warn(`Blocked attempt to open disallowed external URL from ${source}: ${url}`)
    return false
  }

  Promise.resolve(shell.openExternal(externalUrl)).catch((error) => {
    console.error(`Failed to open external URL from ${source}: ${externalUrl}`, error)
  })
  return true
}
