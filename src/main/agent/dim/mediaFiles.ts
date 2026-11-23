import type { DimRuntimeSupervisor } from './runtimeSupervisor'

export interface DimMediaFileMetadata {
  name: string
  mediaType: string
  bytes: number
  sha256: string
}

/** Session-owned immutable files; reads never need a live conversation or media task. */
export class DimMediaFiles {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  async describe(fileId: string): Promise<DimMediaFileMetadata> {
    return (await this.host.start()).call('deepchat.media_files.describe', { fileId })
  }

  async readChunk(fileId: string, offset: number, length: number): Promise<Buffer> {
    const result = await (
      await this.host.start()
    ).call<{ data_base64: string }>('deepchat.media_files.read', { fileId, offset, length })
    return Buffer.from(result.data_base64, 'base64')
  }
}
