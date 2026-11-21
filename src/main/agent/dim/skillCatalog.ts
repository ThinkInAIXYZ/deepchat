import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRef } from './sessionConnection'
import { createHash } from 'node:crypto'

/** Catalog bytes and lifetime belong to native Session files, including fork/backup/GC. */
export class DimSkillCatalog {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  readonly publish = async (
    ref: DimSessionRef,
    content: string,
    signal: AbortSignal
  ): Promise<{ path: string; catalogHash: string; fileId: string }> => {
    signal.throwIfAborted()
    const result = await (
      await this.host.start()
    ).call<{ path: string; catalogHash: string; fileId: string }>(
      'session.deepchat_skills.catalog',
      { ...ref, content }
    )
    signal.throwIfAborted()
    if (
      !result.path ||
      !result.fileId ||
      result.catalogHash !== createHash('sha256').update(content).digest('hex')
    )
      throw new Error('Invalid native skill catalog receipt')
    return result
  }
}
