export const CUA_DARWIN_HELPER_APP_NAME = 'DeepChat Computer Use.app'
export const CUA_DARWIN_HELPER_EXECUTABLE_NAME = 'deepchat-cua-driver'
export const CUA_DARWIN_HELPER_BUNDLE_IDENTIFIER = 'com.deepchat.computeruse.helper'
export const CUA_DARWIN_ALLOWED_ENTITLEMENTS = Object.freeze({
  'com.apple.security.automation.apple-events': true,
  'com.apple.security.device.screen-capture': true
})

const RELATIVE_LOAD_PATH_PREFIXES = Object.freeze([
  '@executable_path/',
  '@loader_path/',
  '@rpath/'
])
const SYSTEM_LOAD_PATH_PREFIXES = Object.freeze(['/System/Library/', '/usr/lib/'])
const FRAMEWORK_RELATIVE_LOAD_PATH_PREFIXES = new Set([
  '@executable_path/',
  '@loader_path/'
])

function unique(values) {
  return [...new Set(values)]
}

export function parseDarwinRpaths(output) {
  if (typeof output !== 'string') {
    throw new TypeError('otool load-command output must be a string')
  }

  const rpaths = []
  let expectsRpath = false
  for (const line of output.split(/\r?\n/)) {
    const command = line.match(/^\s*cmd (LC_[A-Z0-9_]+)\s*$/)?.[1]
    if (command) {
      expectsRpath = command === 'LC_RPATH'
      continue
    }
    if (!expectsRpath) {
      continue
    }
    const rpath = line.match(/^\s*path (.+?) \(offset \d+\)\s*$/)?.[1]
    if (rpath) {
      rpaths.push(rpath)
      expectsRpath = false
    }
  }
  return unique(rpaths)
}

export function parseDarwinLinkedLibraries(output) {
  if (typeof output !== 'string') {
    throw new TypeError('otool linked-library output must be a string')
  }

  return unique(
    output
      .split(/\r?\n/)
      .map(
        (line) =>
          line.match(
            /^\s+(.+?) \((?:compatibility version|current version|offset) .+\)\s*$/
          )?.[1]
      )
      .filter(Boolean)
  )
}

export function isAllowedDarwinLoadPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return false
  }

  const relativePrefix = RELATIVE_LOAD_PATH_PREFIXES.find((prefix) =>
    value.startsWith(prefix)
  )
  if (relativePrefix) {
    const segments = value.slice(relativePrefix.length).split('/')
    if (segments.length === 0 || segments[0] === '') {
      return false
    }
    if (!segments.some((segment) => segment === '.' || segment === '..')) {
      return true
    }
    return (
      FRAMEWORK_RELATIVE_LOAD_PATH_PREFIXES.has(relativePrefix) &&
      segments[0] === '..' &&
      segments[1] === 'Frameworks' &&
      !segments.slice(2).some((segment) => segment === '.' || segment === '..')
    )
  }

  if (value.split('/').some((segment) => segment === '.' || segment === '..')) {
    return false
  }

  return SYSTEM_LOAD_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function findDisallowedDarwinLoadPaths(values) {
  return unique(values.filter((value) => !isAllowedDarwinLoadPath(value)))
}
