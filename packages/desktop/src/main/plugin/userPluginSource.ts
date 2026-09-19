import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  extractSkillArchive,
  assertRegularZipEntries,
  DEFAULT_SKILL_ARCHIVE_LIMITS
} from '@/skill/archive'
import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import type { PreparedUserPlugin, UserPluginSource } from '@shared/types/userPlugin'
import { pluginRelativePath, readUserPluginPackage } from './userPluginPackage'

const LIMITS = DEFAULT_SKILL_ARCHIVE_LIMITS

/** Uses lstat on every entry. Neither imported links nor device files are materialized. */
export async function snapshotPluginTree(
  source: string,
  destination?: string,
  signal?: AbortSignal
): Promise<string> {
  const hash = createHash('sha256')
  const seen = new Set<string>()
  let count = 0
  let total = 0
  const walk = async (relative: string): Promise<void> => {
    signal?.throwIfAborted()
    const filename = relative ? pluginRelativePath(source, relative) : source
    const stat = await fs.promises.lstat(filename)
    if (
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !stat.isFile()) ||
      (stat.isFile() && stat.nlink > 1)
    )
      throw new Error(`Unsupported plugin file kind: ${relative}`)
    if (++count > LIMITS.maxEntries) throw new Error('Plugin contains too many files')
    const key = relative.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new Error(`Duplicate portable path: ${relative}`)
    seen.add(key)
    if (stat.isDirectory()) {
      if (destination)
        await fs.promises.mkdir(
          relative ? pluginRelativePath(destination, relative) : destination,
          { recursive: true }
        )
      for (const entry of (await fs.promises.readdir(filename)).sort()) {
        if (entry === '.git') continue
        await walk(relative ? `${relative}/${entry}` : entry)
      }
    } else {
      if (stat.size > LIMITS.maxEntryBytes || (total += stat.size) > LIMITS.maxExtractedBytes)
        throw new Error('Plugin exceeds extracted size limits')
      // Reject a source changed into a link between inspection and opening.
      const file = await fs.promises.open(
        filename,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
      )
      let bytes: Buffer
      try {
        const opened = await file.stat()
        if (!opened.isFile() || opened.size !== stat.size || opened.ino !== stat.ino)
          throw new Error('Plugin source changed during inspection')
        bytes = await file.readFile()
      } finally {
        await file.close()
      }
      if (bytes.length !== stat.size) throw new Error('Plugin source changed during inspection')
      hash.update(`${relative}\0${bytes.length}\0${stat.mode & 0o111 ? 'x' : '-'}\0`).update(bytes)
      if (destination)
        await fs.promises.writeFile(pluginRelativePath(destination, relative), bytes, {
          flag: 'wx',
          mode: stat.mode & 0o111 ? 0o700 : 0o600
        })
    }
  }
  await walk('')
  return hash.digest('hex')
}

async function runGit(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'credential.helper=',
        '-c',
        'protocol.file.allow=never',
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'http.followRedirects=false',
        ...args
      ],
      {
        cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: {
          ...createMinimalProcessEnvironment(process.env, process.platform),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_LFS_SKIP_SMUDGE: '1'
        }
      }
    )
    let output = ''
    let bytes = 0
    let settled = false
    let checkingSize = false
    const checkSize = async () => {
      if (checkingSize || settled) return
      checkingSize = true
      try {
        let bytes = 0
        let entries = 0
        const visit = async (directory: string): Promise<void> => {
          for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
            if (settled) return
            if (++entries > 8192) throw new Error('Git transport contains too many files')
            const filename = path.join(directory, entry.name)
            if (entry.isDirectory()) await visit(filename)
            else if (entry.isFile()) {
              bytes += (await fs.promises.stat(filename)).size
              if (bytes > LIMITS.maxArchiveBytes) throw new Error('Git transport exceeds 200 MiB')
            }
          }
        }
        await visit(cwd)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      } finally {
        checkingSize = false
      }
    }
    const sizeTimer = setInterval(() => {
      void checkSize()
    }, 100)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(sizeTimer)
      signal.removeEventListener('abort', abort)
      if (error) {
        void terminateProcessTree(child, { graceMs: 100 }).finally(() => reject(error))
      } else resolve(output.trim())
    }
    const abort = () => finish(new Error('Plugin source operation cancelled'))
    const timer = setTimeout(() => finish(new Error('Git operation timed out')), 60000)
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 65536) finish(new Error('Git output exceeded its limit'))
      else output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 65536) finish(new Error('Git output exceeded its limit'))
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) =>
      finish(
        code === 0 ? undefined : new Error(`Git failed (${code}); check the public URL and ref`)
      )
    )
  })
}

async function extractPluginArchive(
  archive: string,
  destination: string,
  signal: AbortSignal
): Promise<void> {
  const executables = await assertRegularZipEntries(archive)
  await extractSkillArchive(archive, destination, {}, signal)
  for (const name of executables) {
    signal.throwIfAborted()
    await fs.promises.chmod(pluginRelativePath(destination, name), 0o700)
  }
}

export class UserPluginSources {
  private readonly prepared = new Map<
    string,
    PreparedUserPlugin & { root: string; staging: string; expiresAt: number }
  >()
  private readonly operations = new Map<string, AbortController>()

  constructor(private readonly installRoot: string) {}

  async cleanupInterrupted(): Promise<void> {
    if (this.operations.size || this.prepared.size) return
    await fs.promises.rm(path.join(this.installRoot, '.staging'), { recursive: true, force: true })
  }

  async inspect(source: UserPluginSource, requestId: string): Promise<PreparedUserPlugin> {
    if (this.operations.has(requestId)) throw new Error('Source operation already running')
    for (const [id, prepared] of this.prepared) {
      if (prepared.expiresAt < Date.now()) await this.discard(id)
    }
    if (this.prepared.size + this.operations.size >= 4)
      throw new Error('Close another plugin inspection before preparing a new package')
    const controller = new AbortController()
    this.operations.set(requestId, controller)
    const signal = controller.signal
    const operationId = randomUUID()
    const staging = path.join(this.installRoot, '.staging', operationId)
    await fs.promises.mkdir(staging, { recursive: true, mode: 0o700 })
    try {
      let inputRoot: string
      let resolvedSource = { ...source }
      if (source.kind === 'git') {
        const url = new URL(source.url)
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
          throw new Error('Use a public HTTPS Git URL without credentials or query parameters')
        if (
          source.ref &&
          (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$/.test(source.ref) || source.ref.includes('..'))
        )
          throw new Error('Invalid Git ref')
        const repo = path.join(staging, 'repo')
        await fs.promises.mkdir(repo)
        await runGit(['init', '--bare', '--template=', repo], staging, signal)
        await runGit(
          [
            '-C',
            repo,
            'fetch',
            '--depth=1',
            '--no-tags',
            '--no-recurse-submodules',
            url.href,
            source.ref || 'HEAD'
          ],
          staging,
          signal
        )
        const commit = await runGit(
          ['-C', repo, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
          staging,
          signal
        )
        if (!/^[a-f0-9]{40,64}$/.test(commit))
          throw new Error('Git did not resolve an immutable commit')
        const archive = path.join(staging, 'source.zip')
        await runGit(
          ['-C', repo, 'archive', '--format=zip', `--output=${archive}`, commit],
          staging,
          signal
        )
        inputRoot = path.join(staging, 'extracted')
        await extractPluginArchive(archive, inputRoot, signal)
        resolvedSource = { ...source, commit }
      } else if (source.kind === 'zip') {
        inputRoot = path.join(staging, 'extracted')
        await extractPluginArchive(source.path, inputRoot, signal)
      } else inputRoot = source.path
      signal.throwIfAborted()
      // Snapshot before parsing so inspection and publication use the same bytes.
      const snapshot = path.join(staging, 'snapshot')
      await snapshotPluginTree(inputRoot, snapshot, signal)
      let root = source.subdirectory ? pluginRelativePath(snapshot, source.subdirectory) : snapshot
      if (!fs.existsSync(path.join(root, '.codex-plugin/plugin.json'))) {
        const candidates: string[] = []
        const search = (directory: string, relative: string, depth: number) => {
          if (fs.existsSync(path.join(directory, '.codex-plugin/plugin.json'))) {
            candidates.push(relative)
            return
          }
          if (depth >= 4) return
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith('.'))
              search(
                path.join(directory, entry.name),
                relative ? `${relative}/${entry.name}` : entry.name,
                depth + 1
              )
          }
        }
        search(root, '', 0)
        if (candidates.length !== 1)
          throw new Error(
            candidates.length
              ? `Choose a package subdirectory: ${candidates.join(', ')}`
              : 'No .codex-plugin/plugin.json found'
          )
        root = pluginRelativePath(root, candidates[0])
      }
      const result: PreparedUserPlugin = {
        operationId,
        source: resolvedSource,
        digest: await snapshotPluginTree(root, undefined, signal),
        package: readUserPluginPackage(root)
      }
      this.prepared.set(operationId, {
        ...result,
        root,
        staging,
        expiresAt: Date.now() + 30 * 60 * 1000
      })
      return result
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true })
      throw error
    } finally {
      this.operations.delete(requestId)
    }
  }

  get(operationId: string) {
    const prepared = this.prepared.get(operationId)
    if (!prepared || prepared.expiresAt < Date.now())
      throw new Error('Plugin inspection expired; inspect the source again')
    return prepared
  }

  async discard(operationId: string): Promise<void> {
    this.operations.get(operationId)?.abort()
    const prepared = this.prepared.get(operationId)
    this.prepared.delete(operationId)
    if (prepared) await fs.promises.rm(prepared.staging, { recursive: true, force: true })
  }

  shutdown(): void {
    for (const controller of this.operations.values()) controller.abort()
  }
}
