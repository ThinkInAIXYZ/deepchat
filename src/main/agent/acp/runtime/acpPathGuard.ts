import * as fs from 'fs/promises'
import * as path from 'path'
import { RequestError } from '@agentclientprotocol/sdk'

export class AcpPathGuard {
  constructor(private readonly workspaceRoot: string | null) {}

  async resolveReadPath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath)
    await this.assertInsideWorkspace(resolved, filePath)
    await this.assertInsideWorkspace(await this.realpath(resolved), filePath, true)
    return resolved
  }

  async resolveWritePath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath)
    await this.assertInsideWorkspace(resolved, filePath)

    try {
      await this.assertInsideWorkspace(await this.realpath(resolved), filePath, true)
      return resolved
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    const parent = await this.findExistingParent(path.dirname(resolved))
    await this.assertInsideWorkspace(await this.realpath(parent), filePath, true)
    return resolved
  }

  private async assertInsideWorkspace(
    targetPath: string,
    originalPath: string,
    useRealWorkspaceRoot = false
  ): Promise<void> {
    if (!this.workspaceRoot) return

    const workspaceRoot = useRealWorkspaceRoot
      ? await this.realpath(this.workspaceRoot)
      : path.resolve(this.workspaceRoot)
    const relative = path.relative(workspaceRoot, path.resolve(targetPath))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw RequestError.invalidParams(
        { path: originalPath },
        `Path escapes workspace: ${originalPath}`
      )
    }
  }

  private async findExistingParent(dir: string): Promise<string> {
    let current = path.resolve(dir)
    while (current && current !== path.dirname(current)) {
      try {
        const stat = await fs.stat(current)
        if (stat.isDirectory()) return current
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      current = path.dirname(current)
    }
    return current
  }

  private async realpath(targetPath: string): Promise<string> {
    try {
      return await fs.realpath(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw error
      }
      return path.resolve(targetPath)
    }
  }
}
