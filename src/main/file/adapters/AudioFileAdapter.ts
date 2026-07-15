import { BaseFileAdapter } from './BaseFileAdapter'

export class AudioFileAdapter extends BaseFileAdapter {
  public async getLLMContent(): Promise<string | undefined> {
    // Return only file path information, do not read content
    return `Audio file path: ${this.filePath}`
  }

  constructor(filePath: string) {
    super(filePath)
  }

  protected getFileDescription(): string | undefined {
    return 'Audio File'
  }

  async getContent(): Promise<string | undefined> {
    // For audio files, return only path information, do not read content
    return `Audio file path: ${this.filePath}`
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
