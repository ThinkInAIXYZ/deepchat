import { isUtf8 } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  constants as fsConstants,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm
} from 'node:fs/promises'
import path from 'node:path'
import {
  WORKFLOW_SAVED_DIRECTORY_SEGMENTS,
  WORKFLOW_SAVED_MAX_FILES,
  WORKFLOW_SAVED_MAX_SOURCE_BYTES,
  WorkflowSavedCatalogSchema,
  WorkflowSavedDocumentSchema,
  WorkflowSavedNameSchema,
  WorkflowSavedSourceHashSchema,
  type WorkflowSavedCatalog,
  type WorkflowSavedDocument,
  type WorkflowSavedSummary
} from '@shared/workflow/savedWorkflow'

const MAX_DIRECTORY_ENTRIES = 1_000

export class WorkflowSavedNotFoundError extends Error {
  constructor(name: string) {
    super(`Saved workflow does not exist: ${name}`)
    this.name = 'WorkflowSavedNotFoundError'
  }
}

export class WorkflowSavedConflictError extends Error {
  constructor(message = 'The saved workflow changed since it was loaded.') {
    super(message)
    this.name = 'WorkflowSavedConflictError'
  }
}

export class WorkflowSavedPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowSavedPathError'
  }
}

export class WorkflowSavedStore {
  private readonly saveTails = new Map<string, Promise<void>>()

  async list(workspacePath: string | null): Promise<WorkflowSavedCatalog> {
    if (workspacePath === null) {
      return WorkflowSavedCatalogSchema.parse({
        directoryPath: null,
        workflows: []
      })
    }

    const directory = await this.resolveDirectory(workspacePath, false)
    if (!directory.exists) {
      return WorkflowSavedCatalogSchema.parse({
        directoryPath: directory.path,
        workflows: []
      })
    }

    const candidateNames: string[] = []
    const handle = await opendir(directory.path)
    let scannedEntries = 0
    try {
      for await (const entry of handle) {
        scannedEntries += 1
        if (scannedEntries > MAX_DIRECTORY_ENTRIES) {
          throw new Error(
            `Saved workflow directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry scan limit.`
          )
        }
        if (!entry.name.endsWith('.js')) {
          continue
        }
        const parsedName = WorkflowSavedNameSchema.safeParse(entry.name.slice(0, -3))
        if (!parsedName.success || entry.isSymbolicLink()) {
          continue
        }
        candidateNames.push(parsedName.data)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }

    candidateNames.sort()
    const workflows = await this.readSummaries(
      directory.path,
      candidateNames,
      WORKFLOW_SAVED_MAX_FILES
    )
    return WorkflowSavedCatalogSchema.parse({
      directoryPath: directory.path,
      workflows
    })
  }

  async read(workspacePath: string | null, rawName: string): Promise<WorkflowSavedDocument> {
    const name = WorkflowSavedNameSchema.parse(rawName)
    if (workspacePath === null) {
      throw new WorkflowSavedPathError('Saved workflows require a parent workspace.')
    }
    const directory = await this.resolveDirectory(workspacePath, false)
    if (!directory.exists) {
      throw new WorkflowSavedNotFoundError(name)
    }
    return await this.readFromDirectory(directory.path, name)
  }

  async save(input: {
    workspacePath: string | null
    name: string
    source: string
    expectedSourceHash: string | null
  }): Promise<WorkflowSavedDocument> {
    const name = WorkflowSavedNameSchema.parse(input.name)
    const expectedSourceHash =
      input.expectedSourceHash === null
        ? null
        : WorkflowSavedSourceHashSchema.parse(input.expectedSourceHash)
    const workspacePath = input.workspacePath
    if (workspacePath === null) {
      throw new WorkflowSavedPathError('Saved workflows require a parent workspace.')
    }
    if (!input.source.trim()) {
      throw new Error('Saved workflow source cannot be empty.')
    }
    const sourceBytes = Buffer.from(input.source, 'utf8')
    if (sourceBytes.byteLength > WORKFLOW_SAVED_MAX_SOURCE_BYTES) {
      throw new Error(
        `Saved workflow source exceeds the ${WORKFLOW_SAVED_MAX_SOURCE_BYTES}-byte limit.`
      )
    }

    const initialDirectory = await this.resolveDirectory(workspacePath, true)
    return await this.withSaveLock(initialDirectory.path, async () => {
      const directory = await this.resolveDirectory(workspacePath, true)
      if (directory.path !== initialDirectory.path) {
        throw new WorkflowSavedPathError('Saved workflow directory changed before the write.')
      }
      const targetPath = this.resolveFilePath(directory.path, name)
      const current = await this.readOptional(directory.path, name)
      this.assertExpectedSource(current, expectedSourceHash)
      if (current === null) {
        await this.assertCreateCapacity(directory.path)
      }

      const temporaryPath = path.join(directory.path, `.${name}.${randomUUID()}.tmp`)
      const mode = current ? (await lstat(targetPath)).mode & 0o777 : 0o644
      let temporaryCreated = false
      try {
        const temporary = await open(
          temporaryPath,
          fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_WRONLY |
            (fsConstants.O_NOFOLLOW ?? 0),
          mode
        )
        temporaryCreated = true
        try {
          await temporary.writeFile(sourceBytes)
          await temporary.sync()
        } finally {
          await temporary.close()
        }

        const resolvedAgain = await this.resolveDirectory(workspacePath, false)
        if (!resolvedAgain.exists || resolvedAgain.path !== directory.path) {
          throw new WorkflowSavedPathError('Saved workflow directory changed during the write.')
        }
        const latest = await this.readOptional(directory.path, name)
        this.assertExpectedSource(latest, expectedSourceHash)

        if (latest === null) {
          try {
            await link(temporaryPath, targetPath)
          } catch (error) {
            if (isErrno(error, 'EEXIST')) {
              throw new WorkflowSavedConflictError()
            }
            throw error
          }
          await rm(temporaryPath)
          temporaryCreated = false
        } else {
          await rename(temporaryPath, targetPath)
          temporaryCreated = false
        }
      } finally {
        if (temporaryCreated) {
          await rm(temporaryPath, { force: true }).catch(() => undefined)
        }
      }

      return await this.readFromDirectory(directory.path, name)
    })
  }

  private async resolveDirectory(
    workspacePath: string,
    create: boolean
  ): Promise<{ path: string; exists: boolean }> {
    const workspace = await realpath(path.resolve(workspacePath))
    const workspaceStats = await lstat(workspace)
    if (!workspaceStats.isDirectory()) {
      throw new WorkflowSavedPathError('Workflow workspace is not a directory.')
    }

    let current = workspace
    for (let index = 0; index < WORKFLOW_SAVED_DIRECTORY_SEGMENTS.length; index += 1) {
      const segment = WORKFLOW_SAVED_DIRECTORY_SEGMENTS[index]
      const candidate = path.join(current, segment)
      let stats
      try {
        stats = await lstat(candidate)
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) {
          throw error
        }
        if (!create) {
          return {
            path: path.join(current, ...WORKFLOW_SAVED_DIRECTORY_SEGMENTS.slice(index)),
            exists: false
          }
        }
        try {
          await mkdir(candidate, { mode: 0o755 })
        } catch (mkdirError) {
          if (!isErrno(mkdirError, 'EEXIST')) {
            throw mkdirError
          }
        }
        stats = await lstat(candidate)
      }

      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new WorkflowSavedPathError(
          `Saved workflow directory component is not a real directory: ${segment}`
        )
      }
      const resolved = await realpath(candidate)
      this.assertContained(resolved, workspace)
      current = resolved
    }
    return { path: current, exists: true }
  }

  private async readOptional(
    directoryPath: string,
    name: string
  ): Promise<WorkflowSavedDocument | null> {
    try {
      return await this.readFromDirectory(directoryPath, name)
    } catch (error) {
      if (error instanceof WorkflowSavedNotFoundError) {
        return null
      }
      throw error
    }
  }

  private async readFromDirectory(
    directoryPath: string,
    name: string
  ): Promise<WorkflowSavedDocument> {
    const filePath = this.resolveFilePath(directoryPath, name)
    let pathStats
    try {
      pathStats = await lstat(filePath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new WorkflowSavedNotFoundError(name)
      }
      throw error
    }
    if (pathStats.isSymbolicLink()) {
      throw new WorkflowSavedPathError('Saved workflow files cannot be symbolic links.')
    }
    if (!pathStats.isFile()) {
      throw new WorkflowSavedPathError('Saved workflow path is not a regular file.')
    }

    let handle
    try {
      handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new WorkflowSavedNotFoundError(name)
      }
      if (isErrno(error, 'ELOOP')) {
        throw new WorkflowSavedPathError('Saved workflow files cannot be symbolic links.')
      }
      throw error
    }

    try {
      const before = await handle.stat()
      if (before.dev !== pathStats.dev || before.ino !== pathStats.ino) {
        throw new WorkflowSavedConflictError('The saved workflow changed before it was read.')
      }
      if (!before.isFile()) {
        throw new WorkflowSavedPathError('Saved workflow path is not a regular file.')
      }
      if (before.size < 1 || before.size > WORKFLOW_SAVED_MAX_SOURCE_BYTES) {
        throw new Error(
          `Saved workflow source must be between 1 and ${WORKFLOW_SAVED_MAX_SOURCE_BYTES} bytes.`
        )
      }
      const bytes = await handle.readFile()
      const after = await handle.stat()
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        throw new WorkflowSavedConflictError('The saved workflow changed while it was read.')
      }
      if (!isUtf8(bytes)) {
        throw new Error('Saved workflow source must be valid UTF-8.')
      }
      const source = bytes.toString('utf8')
      if (!source.trim()) {
        throw new Error('Saved workflow source cannot be empty.')
      }
      return WorkflowSavedDocumentSchema.parse({
        ...this.createSummary(name, bytes.byteLength, after.mtimeMs),
        absolutePath: filePath,
        sourceHash: createHash('sha256').update(bytes).digest('hex'),
        source
      })
    } finally {
      await handle.close()
    }
  }

  private createSummary(name: string, byteLength: number, mtimeMs: number): WorkflowSavedSummary {
    return {
      name,
      relativePath: [...WORKFLOW_SAVED_DIRECTORY_SEGMENTS, `${name}.js`].join('/'),
      byteLength,
      updatedAt: Math.max(0, Math.trunc(mtimeMs))
    }
  }

  private async readSummaries(
    directoryPath: string,
    candidateNames: readonly string[],
    limit: number
  ): Promise<WorkflowSavedSummary[]> {
    const workflows: WorkflowSavedSummary[] = []
    for (const name of candidateNames) {
      if (workflows.length >= limit) {
        break
      }
      try {
        const stats = await lstat(this.resolveFilePath(directoryPath, name))
        if (
          stats.isSymbolicLink() ||
          !stats.isFile() ||
          stats.size < 1 ||
          stats.size > WORKFLOW_SAVED_MAX_SOURCE_BYTES
        ) {
          continue
        }
        workflows.push(this.createSummary(name, stats.size, stats.mtimeMs))
      } catch (error) {
        if (isErrno(error, 'ENOENT') || isErrno(error, 'ELOOP')) {
          continue
        }
        throw error
      }
    }
    return workflows
  }

  private async assertCreateCapacity(directoryPath: string): Promise<void> {
    const handle = await opendir(directoryPath)
    const candidateNames: string[] = []
    let scannedEntries = 0
    try {
      for await (const entry of handle) {
        scannedEntries += 1
        if (scannedEntries > MAX_DIRECTORY_ENTRIES) {
          throw new Error(
            `Saved workflow directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry scan limit.`
          )
        }
        if (!entry.name.endsWith('.js') || entry.isSymbolicLink()) {
          continue
        }
        const parsedName = WorkflowSavedNameSchema.safeParse(entry.name.slice(0, -3))
        if (parsedName.success) {
          candidateNames.push(parsedName.data)
        }
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
    const workflows = await this.readSummaries(
      directoryPath,
      candidateNames,
      WORKFLOW_SAVED_MAX_FILES
    )
    if (workflows.length >= WORKFLOW_SAVED_MAX_FILES) {
      throw new Error(`Saved workflow limit of ${WORKFLOW_SAVED_MAX_FILES} files was reached.`)
    }
  }

  private async withSaveLock<T>(directoryPath: string, action: () => Promise<T>): Promise<T> {
    const previous = this.saveTails.get(directoryPath) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => barrier)
    this.saveTails.set(directoryPath, tail)

    await previous.catch(() => undefined)
    try {
      return await action()
    } finally {
      release()
      if (this.saveTails.get(directoryPath) === tail) {
        this.saveTails.delete(directoryPath)
      }
    }
  }

  private resolveFilePath(directoryPath: string, name: string): string {
    const filePath = path.join(directoryPath, `${name}.js`)
    this.assertContained(filePath, directoryPath)
    return filePath
  }

  private assertContained(candidate: string, root: string): void {
    const relative = path.relative(root, candidate)
    if (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    ) {
      return
    }
    throw new WorkflowSavedPathError('Saved workflow path escapes its workspace directory.')
  }

  private assertExpectedSource(
    current: WorkflowSavedDocument | null,
    expectedSourceHash: string | null
  ): void {
    if (expectedSourceHash === null) {
      if (current !== null) {
        throw new WorkflowSavedConflictError('A saved workflow with this name already exists.')
      }
      return
    }
    if (current?.sourceHash !== expectedSourceHash) {
      throw new WorkflowSavedConflictError()
    }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
