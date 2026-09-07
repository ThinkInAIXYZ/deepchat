import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { TapeSkillMaterializationPayload } from '@/tape/domain/skillMaterialization'
import {
  canonicalSkillExecutionPackagePath,
  validateSkillExecutionPackage
} from '@/tape/domain/skillMaterialization'
import {
  SKILL_EXECUTION_PACKAGE_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES,
  SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_FILES
} from '@shared/types/skill'

const TEMP_DIRECTORY_PREFIX = 'deepchat-skill-exec-'
const OWNERSHIP_MARKER = '.deepchat-package-owner'
const PACKAGE_DIRECTORY = 'package'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export interface OwnedSkillExecutionPackageTree {
  schemaVersion: 1
  rootPath: string
  ownershipToken: string
  packageHash: string
  files: Array<{ relativePath: string; byteCount: number; sha256: string }>
}

export interface MaterializedSkillExecutionPackageTree {
  rootPath: string
  packageRoot: string
  descriptor: Readonly<OwnedSkillExecutionPackageTree>
  resolveFile(relativePath: string): string
  assertIntact(): Promise<void>
  cleanup(): Promise<void>
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function expectedTempParent(): string {
  return path.resolve(os.tmpdir())
}

function assertOwnedTreeDescriptor(
  descriptor: OwnedSkillExecutionPackageTree
): OwnedSkillExecutionPackageTree {
  if (
    descriptor.schemaVersion !== 1 ||
    typeof descriptor.rootPath !== 'string' ||
    typeof descriptor.ownershipToken !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(descriptor.ownershipToken) ||
    typeof descriptor.packageHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(descriptor.packageHash) ||
    !Array.isArray(descriptor.files) ||
    descriptor.files.length > SKILL_EXECUTION_PACKAGE_MAX_FILES
  ) {
    throw new TypeError('Skill execution package tree ownership descriptor is invalid.')
  }

  const rootPath = path.resolve(descriptor.rootPath)
  if (
    path.dirname(rootPath) !== expectedTempParent() ||
    !path.basename(rootPath).startsWith(TEMP_DIRECTORY_PREFIX)
  ) {
    throw new Error('Skill execution package tree is outside the owned temporary namespace.')
  }

  const paths = new Set<string>()
  const portableNodes = new Map<string, { path: string; kind: 'directory' | 'file' }>()
  const directories = new Set<string>()
  let byteCount = 0
  let previousPath: string | null = null
  const files = descriptor.files.map((file) => {
    if (
      !file ||
      typeof file !== 'object' ||
      !Number.isSafeInteger(file.byteCount) ||
      file.byteCount < 0 ||
      file.byteCount > SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new TypeError('Skill execution package tree file evidence is invalid.')
    }
    byteCount += file.byteCount
    if (byteCount > SKILL_EXECUTION_PACKAGE_MAX_BYTES) {
      throw new TypeError('Skill execution package tree byte count is invalid.')
    }
    const relativePath = canonicalSkillExecutionPackagePath(file.relativePath)
    if (
      previousPath !== null &&
      Buffer.compare(Buffer.from(previousPath, 'utf8'), Buffer.from(relativePath, 'utf8')) >= 0
    ) {
      throw new TypeError('Skill execution package tree file evidence is not canonical.')
    }
    previousPath = relativePath
    const segments = relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      const directory = segments.slice(0, length).join('/')
      const foldedDirectory = directory.toLowerCase()
      const existingDirectory = portableNodes.get(foldedDirectory)
      if (
        existingDirectory &&
        (existingDirectory.path !== directory || existingDirectory.kind !== 'directory')
      ) {
        throw new TypeError('Skill execution package tree paths collide on a supported platform.')
      }
      portableNodes.set(foldedDirectory, { path: directory, kind: 'directory' })
      directories.add(directory)
      if (directories.size > SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES) {
        throw new TypeError('Skill execution package tree directory count is invalid.')
      }
    }
    const foldedPath = relativePath.toLowerCase()
    if (paths.has(relativePath) || portableNodes.has(foldedPath)) {
      throw new TypeError('Skill execution package tree paths collide on a supported platform.')
    }
    paths.add(relativePath)
    portableNodes.set(foldedPath, { path: relativePath, kind: 'file' })
    return { relativePath, byteCount: file.byteCount, sha256: file.sha256 }
  })

  return {
    schemaVersion: 1,
    rootPath,
    ownershipToken: descriptor.ownershipToken,
    packageHash: descriptor.packageHash,
    files
  }
}

async function assertOwnedTreeOnDisk(descriptor: OwnedSkillExecutionPackageTree): Promise<void> {
  const rootStat = await fs.promises.lstat(descriptor.rootPath)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Skill execution package tree root is not a private directory.')
  }
  if (process.platform !== 'win32' && (rootStat.mode & 0o077) !== 0) {
    throw new Error('Skill execution package tree root permissions drifted.')
  }
  const markerPath = path.join(descriptor.rootPath, OWNERSHIP_MARKER)
  const markerStat = await fs.promises.lstat(markerPath)
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) {
    throw new Error('Skill execution package tree ownership marker is invalid.')
  }
  if (process.platform !== 'win32' && (markerStat.mode & 0o077) !== 0) {
    throw new Error('Skill execution package tree ownership marker permissions drifted.')
  }
  let marker: unknown
  try {
    marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'))
  } catch {
    throw new Error('Skill execution package tree ownership marker is invalid.')
  }
  if (
    !marker ||
    typeof marker !== 'object' ||
    Array.isArray(marker) ||
    Object.keys(marker).sort().join('\0') !== 'ownershipToken\0packageHash\0schemaVersion' ||
    (marker as Record<string, unknown>).schemaVersion !== 1 ||
    (marker as Record<string, unknown>).ownershipToken !== descriptor.ownershipToken ||
    (marker as Record<string, unknown>).packageHash !== descriptor.packageHash
  ) {
    throw new Error('Skill execution package tree ownership marker drifted.')
  }
}

async function readExpectedPrivateFile(
  absolutePath: string,
  expected: { relativePath: string; byteCount: number; sha256: string }
): Promise<Buffer> {
  const noFollow = process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW
  const handle = await fs.promises.open(absolutePath, fs.constants.O_RDONLY | noFollow)
  try {
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size !== expected.byteCount ||
      (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
    ) {
      throw new Error(
        `Skill execution package file ${expected.relativePath} drifted before dispatch.`
      )
    }

    const bytes = Buffer.alloc(expected.byteCount)
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (result.bytesRead === 0) {
        throw new Error(
          `Skill execution package file ${expected.relativePath} drifted before dispatch.`
        )
      }
      offset += result.bytesRead
    }
    const overflow = Buffer.allocUnsafe(1)
    const overflowRead = await handle.read(overflow, 0, 1, expected.byteCount)
    const after = await handle.stat()
    if (
      overflowRead.bytesRead !== 0 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        `Skill execution package file ${expected.relativePath} drifted before dispatch.`
      )
    }
    return bytes
  } finally {
    await handle.close()
  }
}

export async function assertOwnedSkillExecutionPackageTree(
  input: OwnedSkillExecutionPackageTree
): Promise<OwnedSkillExecutionPackageTree> {
  const descriptor = assertOwnedTreeDescriptor(input)
  await assertOwnedTreeOnDisk(descriptor)
  return descriptor
}

export async function assertSkillExecutionPackageTreeIntact(
  input: OwnedSkillExecutionPackageTree
): Promise<void> {
  const descriptor = await assertOwnedSkillExecutionPackageTree(input)
  const packageRoot = path.join(descriptor.rootPath, PACKAGE_DIRECTORY)
  const packageStat = await fs.promises.lstat(packageRoot)
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
    throw new Error('Skill execution package root is not a private directory.')
  }
  if (process.platform !== 'win32' && (packageStat.mode & 0o077) !== 0) {
    throw new Error('Skill execution package root permissions drifted.')
  }

  const expectedFiles = new Map(descriptor.files.map((file) => [file.relativePath, file]))
  const expectedDirectories = new Set<string>()
  for (const file of descriptor.files) {
    const segments = file.relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      expectedDirectories.add(segments.slice(0, length).join('/'))
    }
  }
  const actualFiles = new Set<string>()
  const actualDirectories = new Set<string>()
  const visit = async (directory: string, segments: string[]): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = [...segments, entry.name].join('/')
      const absolutePath = path.join(directory, entry.name)
      const stat = await fs.promises.lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        throw new Error(`Skill execution package node ${relativePath} is a symbolic link.`)
      }
      if (stat.isDirectory()) {
        const canonicalPath = canonicalSkillExecutionPackagePath(relativePath)
        if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
          throw new Error(`Skill execution package directory ${relativePath} permissions drifted.`)
        }
        actualDirectories.add(canonicalPath)
        await visit(absolutePath, [...segments, entry.name])
        continue
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error(`Skill execution package node ${relativePath} is not a private file.`)
      }
      const canonicalPath = canonicalSkillExecutionPackagePath(relativePath)
      const expected = expectedFiles.get(canonicalPath)
      if (expected && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        throw new Error(`Skill execution package file ${relativePath} permissions drifted.`)
      }
      if (expected && stat.size !== expected.byteCount) {
        throw new Error(`Skill execution package file ${relativePath} drifted before dispatch.`)
      }
      actualFiles.add(canonicalPath)
    }
  }
  await visit(packageRoot, [])

  if (
    actualFiles.size !== descriptor.files.length ||
    descriptor.files.some((file) => !actualFiles.has(file.relativePath))
  ) {
    throw new Error('Skill execution package tree inventory drifted before process dispatch.')
  }
  if (
    actualDirectories.size !== expectedDirectories.size ||
    Array.from(expectedDirectories).some((directory) => !actualDirectories.has(directory))
  ) {
    throw new Error('Skill execution package tree directory inventory drifted before dispatch.')
  }
  for (const file of descriptor.files) {
    const absolutePath = path.join(packageRoot, ...file.relativePath.split('/'))
    await readExpectedPrivateFile(absolutePath, file)
  }
}

export async function cleanupOwnedSkillExecutionPackageTree(
  input: OwnedSkillExecutionPackageTree
): Promise<void> {
  const descriptor = assertOwnedTreeDescriptor(input)
  try {
    await assertOwnedTreeOnDisk(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await fs.promises.rm(descriptor.rootPath, { recursive: true, force: true, maxRetries: 2 })
}

export async function materializeSkillExecutionPackageTree(
  input: TapeSkillMaterializationPayload['executionPackage']
): Promise<MaterializedSkillExecutionPackageTree> {
  const executionPackage = validateSkillExecutionPackage(input)
  const rootPath = await fs.promises.mkdtemp(path.join(expectedTempParent(), TEMP_DIRECTORY_PREFIX))
  const descriptor: OwnedSkillExecutionPackageTree = {
    schemaVersion: 1,
    rootPath,
    ownershipToken: randomUUID(),
    packageHash: executionPackage.packageHash,
    files: executionPackage.files.map(({ relativePath, byteCount, sha256 }) => ({
      relativePath,
      byteCount,
      sha256
    }))
  }
  const packageRoot = path.join(rootPath, PACKAGE_DIRECTORY)

  try {
    await fs.promises.chmod(rootPath, PRIVATE_DIRECTORY_MODE)
    await fs.promises.writeFile(
      path.join(rootPath, OWNERSHIP_MARKER),
      JSON.stringify({
        schemaVersion: 1,
        ownershipToken: descriptor.ownershipToken,
        packageHash: descriptor.packageHash
      }),
      { encoding: 'utf8', flag: 'wx', mode: PRIVATE_FILE_MODE }
    )
    await fs.promises.mkdir(packageRoot, { mode: PRIVATE_DIRECTORY_MODE })

    for (const file of executionPackage.files) {
      const relativePath = canonicalSkillExecutionPackagePath(file.relativePath)
      const destination = path.join(packageRoot, ...relativePath.split('/'))
      const parent = path.dirname(destination)
      await fs.promises.mkdir(parent, {
        recursive: true,
        mode: PRIVATE_DIRECTORY_MODE
      })
      const bytes = Buffer.from(file.base64, 'base64')
      if (bytes.byteLength !== file.byteCount || sha256(bytes) !== file.sha256) {
        throw new Error(
          `Skill execution package file ${relativePath} failed extraction validation.`
        )
      }
      await fs.promises.writeFile(destination, bytes, {
        flag: 'wx',
        mode: PRIVATE_FILE_MODE
      })
      const fileStat = await fs.promises.lstat(destination)
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
        throw new Error(
          `Skill execution package file ${relativePath} is not a private regular file.`
        )
      }
      const persisted = await fs.promises.readFile(destination)
      if (persisted.byteLength !== file.byteCount || sha256(persisted) !== file.sha256) {
        throw new Error(`Skill execution package file ${relativePath} drifted during extraction.`)
      }
    }

    const frozenDescriptor = Object.freeze({
      ...descriptor,
      files: Object.freeze(descriptor.files.map((file) => Object.freeze({ ...file })))
    }) as Readonly<OwnedSkillExecutionPackageTree>
    return {
      rootPath,
      packageRoot,
      descriptor: frozenDescriptor,
      resolveFile(relativePath: string): string {
        const canonicalPath = canonicalSkillExecutionPackagePath(relativePath)
        return path.join(packageRoot, ...canonicalPath.split('/'))
      },
      async assertIntact(): Promise<void> {
        await assertSkillExecutionPackageTreeIntact(frozenDescriptor)
      },
      async cleanup(): Promise<void> {
        await cleanupOwnedSkillExecutionPackageTree(frozenDescriptor)
      }
    }
  } catch (error) {
    await fs.promises.rm(rootPath, { recursive: true, force: true, maxRetries: 2 }).catch(() => {})
    throw error
  }
}
