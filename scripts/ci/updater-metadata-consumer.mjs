import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const PROVIDER_RELATIVE_PATH = path.join('out', 'providers', 'Provider.js')
const CONSUMER_REQUIREMENT =
  'Release metadata validation requires the installed electron-updater package to expose ' +
  'out/providers/Provider.js#parseUpdateInfo'

export function loadElectronUpdaterMetadataParser({
  resolvePackage = (specifier) => require.resolve(specifier),
  loadProvider = (specifier) => require(specifier)
} = {}) {
  try {
    const updaterRoot = path.dirname(resolvePackage('electron-updater/package.json'))
    const provider = loadProvider(path.join(updaterRoot, PROVIDER_RELATIVE_PATH))
    if (typeof provider?.parseUpdateInfo !== 'function') {
      throw new TypeError('parseUpdateInfo is not a function')
    }
    return provider.parseUpdateInfo
  } catch (cause) {
    throw new Error(CONSUMER_REQUIREMENT, { cause })
  }
}

const parseUpdateInfo = loadElectronUpdaterMetadataParser()

export function parseElectronUpdaterMetadata(rawData, channelFile, channelFileUrl) {
  const metadata = parseUpdateInfo(rawData, channelFile, channelFileUrl)
  const prototype =
    metadata && typeof metadata === 'object' ? Object.getPrototypeOf(metadata) : undefined
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new Error(`${channelFile} must contain an updater metadata object`)
  }
  return metadata
}
