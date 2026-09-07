import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'

import { matchesRoleFileName, SHA256_PATTERN } from './package-contract.mjs'

async function hashPackageFile(filePath) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      sha256.update(chunk)
      sha512.update(chunk)
    })
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return {
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('base64')
  }
}

export async function inspectRegularFile(filePath, expectedRoot = path.dirname(filePath)) {
  const absoluteRoot = path.resolve(expectedRoot)
  const absolutePath = path.resolve(filePath)
  const relativePath = path.relative(absoluteRoot, absolutePath)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Package file escapes its expected root: ${filePath}`)
  }

  const fileStat = await lstat(absolutePath)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`Package file must be a regular non-symlink file: ${filePath}`)
  }
  const resolvedRoot = await realpath(absoluteRoot)
  const resolvedFile = await realpath(absolutePath)
  const resolvedRelative = path.relative(resolvedRoot, resolvedFile)
  if (
    resolvedRelative === '' ||
    resolvedRelative === '..' ||
    resolvedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelative)
  ) {
    throw new Error(`Package file resolves outside its expected root: ${filePath}`)
  }

  const digests = await hashPackageFile(absolutePath)
  const postHashStat = await lstat(absolutePath)
  if (
    !postHashStat.isFile() ||
    postHashStat.isSymbolicLink() ||
    postHashStat.size !== fileStat.size ||
    postHashStat.mtimeMs !== fileStat.mtimeMs
  ) {
    throw new Error(`Package file changed while it was being inspected: ${filePath}`)
  }

  return {
    bytes: fileStat.size,
    ...digests
  }
}

export async function findRoleFile(directory, roleDefinition, label) {
  const absoluteDirectory = path.resolve(directory)
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })
  const matches = entries.filter(
    (entry) => entry.isFile() && matchesRoleFileName(entry.name, roleDefinition)
  )
  if (matches.length !== 1) {
    throw new Error(
      `${label} must contain exactly one ${roleDefinition.name} file; found ${matches.length}`
    )
  }
  const filePath = path.join(absoluteDirectory, matches[0].name)
  return {
    name: matches[0].name,
    path: filePath,
    ...(await inspectRegularFile(filePath, absoluteDirectory))
  }
}

export function parseYamlObject(source, label) {
  const document = parseDocument(source, {
    maxAliasCount: 0,
    uniqueKeys: true
  })
  if (document.errors.length > 0) {
    throw new Error(`${label} is invalid YAML: ${document.errors[0].message}`)
  }
  if (document.warnings.length > 0) {
    throw new Error(`${label} contains unsupported YAML: ${document.warnings[0].message}`)
  }
  const value = document.toJS({ maxAliasCount: 0 })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a YAML object`)
  }
  return value
}

export function validateManifestDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

export function resolveContainedRelativePath(rootDirectory, relativePath, label) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must be a non-empty relative path`)
  }
  const normalized = path.normalize(relativePath)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`${label} escapes its package root`)
  }
  return path.resolve(rootDirectory, normalized)
}
