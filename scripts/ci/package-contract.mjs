import path from 'node:path'

export const PACKAGE_MANIFEST_SCHEMA_VERSION = 2
export const PACKAGE_SIZE_BASELINE_SCHEMA_VERSION = 1
export const PACKAGE_SIZE_POLICY_SCHEMA_VERSION = 1
export const RELEASE_INDEX_SCHEMA_VERSION = 2

export const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/
export const SHA256_PATTERN = /^[a-f0-9]{64}$/
export const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/

export const SUPPORTED_ARCHITECTURES = Object.freeze(['x64', 'arm64'])
export const SUPPORTED_ARTIFACT_PURPOSES = Object.freeze(['distribution', 'verification'])
export const DARWIN_DISTRIBUTION_CHECK_NAMES = Object.freeze([
  'cuaMacHelperDistribution',
  'macAppDistribution',
  'macZipDistribution',
  'macDmgDistribution'
])

const MIB = 1024 * 1024
export const DEFAULT_INSTALLER_DELTA_BYTES = 90 * MIB
export const PACKAGE_SIZE_TRANSIENT_DELTA = Object.freeze({
  reason: 'stop-shipping-bundled-node',
  baselineCommit: 'dfb4ba0f34c008c27cfb6bd98a08fdbd36f7b343',
  bytes: -50 * MIB
})

const role = (name, directory, suffixes, options = {}) =>
  Object.freeze({
    name,
    directory,
    suffixes: Object.freeze(suffixes),
    public: options.public ?? true,
    measured: options.measured ?? false,
    updaterPayload: options.updaterPayload ?? false,
    sidecarFor: options.sidecarFor ?? null
  })

const rawMetadata = (name) =>
  role('update-metadata', 'metadata', [name], {
    public: false
  })

const targetDefinitions = [
  {
    id: 'win32-x64',
    platform: 'win32',
    arch: 'x64',
    artifactName: 'deepchat-package-win32-x64',
    legacyArtifactName: 'deepchat-win-x64',
    unpackedDirectory: 'win-unpacked',
    metadataName: 'latest.yml',
    roles: [
      role('installer', 'files', ['-windows-x64.exe'], {
        measured: true,
        updaterPayload: true
      }),
      role('installer-blockmap', 'files', ['-windows-x64.exe.blockmap'], {
        sidecarFor: 'installer'
      }),
      rawMetadata('latest.yml')
    ]
  },
  {
    id: 'win32-arm64',
    platform: 'win32',
    arch: 'arm64',
    artifactName: 'deepchat-package-win32-arm64',
    legacyArtifactName: 'deepchat-win-arm64',
    unpackedDirectory: 'win-arm64-unpacked',
    metadataName: 'latest.yml',
    roles: [
      role('installer', 'files', ['-windows-arm64.exe'], {
        measured: true,
        updaterPayload: true
      }),
      role('installer-blockmap', 'files', ['-windows-arm64.exe.blockmap'], {
        sidecarFor: 'installer'
      }),
      rawMetadata('latest.yml')
    ]
  },
  {
    id: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    artifactName: 'deepchat-package-linux-x64',
    legacyArtifactName: 'deepchat-linux-x64',
    unpackedDirectory: 'linux-unpacked',
    metadataName: 'latest-linux.yml',
    roles: [
      role('installer', 'files', ['-linux-x64.AppImage', '-linux-x86_64.AppImage'], {
        measured: true,
        updaterPayload: true
      }),
      role('archive', 'files', ['-linux-x64.tar.gz', '-linux-x86_64.tar.gz'], {
        measured: true
      }),
      rawMetadata('latest-linux.yml')
    ]
  },
  {
    id: 'linux-arm64',
    platform: 'linux',
    arch: 'arm64',
    artifactName: 'deepchat-package-linux-arm64',
    legacyArtifactName: 'deepchat-linux-arm64',
    unpackedDirectory: 'linux-arm64-unpacked',
    metadataName: 'latest-linux-arm64.yml',
    roles: [
      role('installer', 'files', ['-linux-arm64.AppImage', '-linux-aarch64.AppImage'], {
        measured: true,
        updaterPayload: true
      }),
      role('archive', 'files', ['-linux-arm64.tar.gz', '-linux-aarch64.tar.gz'], {
        measured: true
      }),
      rawMetadata('latest-linux-arm64.yml')
    ]
  },
  {
    id: 'darwin-x64',
    platform: 'darwin',
    arch: 'x64',
    artifactName: 'deepchat-package-darwin-x64',
    legacyArtifactName: 'deepchat-mac-x64',
    unpackedDirectory: 'mac',
    metadataName: 'latest-mac.yml',
    roles: [
      role('installer', 'files', ['-mac-x64.dmg'], { measured: true }),
      role('updater-payload', 'files', ['-mac-x64.zip'], {
        measured: true,
        updaterPayload: true
      }),
      role('updater-blockmap', 'files', ['-mac-x64.zip.blockmap'], {
        sidecarFor: 'updater-payload'
      }),
      rawMetadata('latest-mac.yml')
    ]
  },
  {
    id: 'darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    artifactName: 'deepchat-package-darwin-arm64',
    legacyArtifactName: 'deepchat-mac-arm64',
    unpackedDirectory: 'mac-arm64',
    metadataName: 'latest-mac.yml',
    roles: [
      role('installer', 'files', ['-mac-arm64.dmg'], { measured: true }),
      role('updater-payload', 'files', ['-mac-arm64.zip'], {
        measured: true,
        updaterPayload: true
      }),
      role('updater-blockmap', 'files', ['-mac-arm64.zip.blockmap'], {
        sidecarFor: 'updater-payload'
      }),
      rawMetadata('latest-mac.yml')
    ]
  }
].map((definition) =>
  Object.freeze({
    ...definition,
    roles: Object.freeze(definition.roles)
  })
)

export const TARGET_DEFINITIONS = Object.freeze(targetDefinitions)
export const TARGET_IDS = Object.freeze(targetDefinitions.map(({ id }) => id))

const targetById = new Map(targetDefinitions.map((definition) => [definition.id, definition]))

export function targetId(platform, arch) {
  return `${platform}-${arch}`
}

export function getTargetDefinition(idOrPlatform, maybeArch) {
  const id = maybeArch === undefined ? idOrPlatform : targetId(idOrPlatform, maybeArch)
  const definition = targetById.get(id)
  if (!definition) {
    throw new Error(`Unsupported package target: ${id}`)
  }
  return definition
}

export function validateSourceSha(value, label = 'source SHA') {
  if (typeof value !== 'string' || !SOURCE_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a 40-character lowercase Git SHA`)
  }
  return value
}

export function validateArtifactPurpose(value) {
  if (!SUPPORTED_ARTIFACT_PURPOSES.includes(value)) {
    throw new Error(`Unsupported artifact purpose: ${value}`)
  }
  return value
}

export function getRoleDefinition(target, roleName) {
  const definition =
    typeof target === 'string' ? getTargetDefinition(target) : getTargetDefinition(target.id)
  const roleDefinition = definition.roles.find(({ name }) => name === roleName)
  if (!roleDefinition) {
    throw new Error(`Target ${definition.id} does not define role ${roleName}`)
  }
  return roleDefinition
}

export function getMeasuredRoles(target) {
  const definition =
    typeof target === 'string' ? getTargetDefinition(target) : getTargetDefinition(target.id)
  return definition.roles.filter(({ measured }) => measured)
}

export function getPublicRoles(target) {
  const definition =
    typeof target === 'string' ? getTargetDefinition(target) : getTargetDefinition(target.id)
  return definition.roles.filter(({ public: isPublic }) => isPublic)
}

export function getUpdaterPayloadRole(target) {
  const definition =
    typeof target === 'string' ? getTargetDefinition(target) : getTargetDefinition(target.id)
  const matches = definition.roles.filter(({ updaterPayload }) => updaterPayload)
  if (matches.length !== 1) {
    throw new Error(`Target ${definition.id} must define exactly one updater payload`)
  }
  return matches[0]
}

export function matchesRoleFileName(fileName, roleDefinition) {
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    path.basename(fileName) !== fileName
  ) {
    return false
  }
  return roleDefinition.suffixes.some((suffix) =>
    suffix.startsWith('-') ? fileName.endsWith(suffix) : fileName === suffix
  )
}

export function compareFileNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function expectedReleaseAssetCount() {
  const packageAssetCount = targetDefinitions.reduce(
    (count, definition) => count + getPublicRoles(definition).length,
    0
  )
  return packageAssetCount + 4 + 1
}

export function resolvePackageSizeExpectedDelta(policy, baselineCommit) {
  const expected = policy?.expectedDelta
  if (!expected) return 0
  if (expected.baselineCommit !== baselineCommit) return 0
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes > 0) {
    throw new Error('Package-size policy expectedDelta.bytes must be a non-positive integer')
  }
  return expected.bytes
}

export function createDefaultPackageSizePolicy() {
  return {
    schemaVersion: PACKAGE_SIZE_POLICY_SCHEMA_VERSION,
    expectedDelta: {
      baselineCommit: PACKAGE_SIZE_TRANSIENT_DELTA.baselineCommit,
      bytes: PACKAGE_SIZE_TRANSIENT_DELTA.bytes
    },
    targets: Object.fromEntries(
      targetDefinitions.map((definition) => [
        definition.id,
        Object.fromEntries(
          getMeasuredRoles(definition).map(({ name }) => [
            name,
            {
              maxGrowthBytes: DEFAULT_INSTALLER_DELTA_BYTES,
              maxShrinkBytes: DEFAULT_INSTALLER_DELTA_BYTES
            }
          ])
        )
      ])
    )
  }
}
