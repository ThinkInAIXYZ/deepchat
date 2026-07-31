import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WORKFLOW_SAVED_MAX_ARGS_BYTES,
  WORKFLOW_SAVED_MAX_FILES
} from '@shared/workflow/savedWorkflow'
import { parseWorkflowSavedArgs } from '@/workflow/savedWorkflowArgs'
import {
  WorkflowSavedConflictError,
  WorkflowSavedPathError,
  WorkflowSavedStore
} from '@/workflow/savedWorkflowStore'

describe('WorkflowSavedStore', () => {
  let workspacePath: string
  let outsidePath: string
  const store = new WorkflowSavedStore()

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'deepchat-workflows-'))
    outsidePath = await mkdtemp(path.join(tmpdir(), 'deepchat-workflows-outside-'))
  })

  afterEach(async () => {
    await Promise.all([
      rm(workspacePath, { force: true, recursive: true }),
      rm(outsidePath, { force: true, recursive: true })
    ])
  })

  it('creates user-readable scripts and protects external edits with a source hash', async () => {
    const canonicalWorkspacePath = await realpath(workspacePath)
    const empty = await store.list(workspacePath)
    expect(empty.workflows).toEqual([])
    expect(empty.directoryPath).toBe(path.join(canonicalWorkspacePath, '.deepchat', 'workflows'))

    const created = await store.save({
      workspacePath,
      name: 'review-change',
      source: 'return await agent("Review this change", { key: "review" })',
      expectedSourceHash: null
    })

    expect(created).toMatchObject({
      name: 'review-change',
      relativePath: '.deepchat/workflows/review-change.js',
      absolutePath: path.join(canonicalWorkspacePath, '.deepchat', 'workflows', 'review-change.js')
    })
    expect((await store.list(workspacePath)).workflows).toEqual([
      expect.objectContaining({
        name: 'review-change'
      })
    ])
    await expect(store.read(workspacePath, 'review-change')).resolves.toEqual(created)

    await writeFile(created.absolutePath, 'return "edited outside DeepChat"', 'utf8')
    await expect(
      store.save({
        workspacePath,
        name: 'review-change',
        source: 'return "overwrite stale edit"',
        expectedSourceHash: created.sourceHash
      })
    ).rejects.toBeInstanceOf(WorkflowSavedConflictError)

    const externallyEdited = await store.read(workspacePath, 'review-change')
    const updated = await store.save({
      workspacePath,
      name: 'review-change',
      source: 'return "accepted edit"',
      expectedSourceHash: externallyEdited.sourceHash
    })
    expect(updated.source).toBe('return "accepted edit"')
    expect(updated.sourceHash).not.toBe(externallyEdited.sourceHash)
  })

  it('rejects traversal names and symbolic-link escapes', async () => {
    await expect(
      store.save({
        workspacePath,
        name: '../escape',
        source: 'return null',
        expectedSourceHash: null
      })
    ).rejects.toThrow()

    await mkdir(path.join(workspacePath, '.deepchat'))
    await symlink(outsidePath, path.join(workspacePath, '.deepchat', 'workflows'))
    await expect(store.list(workspacePath)).rejects.toBeInstanceOf(WorkflowSavedPathError)
    await expect(
      store.save({
        workspacePath,
        name: 'escape',
        source: 'return null',
        expectedSourceHash: null
      })
    ).rejects.toBeInstanceOf(WorkflowSavedPathError)
  })

  it('never reads a saved workflow file through a symbolic link', async () => {
    const directoryPath = path.join(workspacePath, '.deepchat', 'workflows')
    await mkdir(directoryPath, { recursive: true })
    const outsideFile = path.join(outsidePath, 'outside.js')
    await writeFile(outsideFile, 'return "outside"', 'utf8')
    await symlink(outsideFile, path.join(directoryPath, 'linked.js'))

    await expect(store.read(workspacePath, 'linked')).rejects.toBeInstanceOf(WorkflowSavedPathError)
    expect((await store.list(workspacePath)).workflows).toEqual([])
  })

  it('serializes creates so the saved Workflow catalog cannot exceed its file limit', async () => {
    const directoryPath = path.join(workspacePath, '.deepchat', 'workflows')
    await mkdir(directoryPath, { recursive: true })
    await Promise.all(
      Array.from({ length: WORKFLOW_SAVED_MAX_FILES - 1 }, (_, index) =>
        writeFile(path.join(directoryPath, `seed-${String(index).padStart(3, '0')}.js`), 'return 1')
      )
    )

    const results = await Promise.allSettled([
      store.save({
        workspacePath,
        name: 'extra-a',
        source: 'return "a"',
        expectedSourceHash: null
      }),
      store.save({
        workspacePath,
        name: 'extra-b',
        source: 'return "b"',
        expectedSourceHash: null
      })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await store.list(workspacePath)).workflows).toHaveLength(WORKFLOW_SAVED_MAX_FILES)
  })
})

describe('parseWorkflowSavedArgs', () => {
  it('normalizes bounded JSON and rejects unsafe or oversized values', () => {
    expect(parseWorkflowSavedArgs('')).toBeNull()
    expect(parseWorkflowSavedArgs('{"z":1,"a":[true]}')).toEqual({
      a: [true],
      z: 1
    })
    expect(() => parseWorkflowSavedArgs('{"__proto__":{"polluted":true}}')).toThrow('unsafe key')
    expect(() => parseWorkflowSavedArgs('x'.repeat(WORKFLOW_SAVED_MAX_ARGS_BYTES + 1))).toThrow(
      'byte limit'
    )
  })
})
