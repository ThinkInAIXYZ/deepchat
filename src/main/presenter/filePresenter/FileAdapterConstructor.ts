import { BaseFileAdapter } from './BaseFileAdapter'

export type FileAdapterConstructor = new (filePath: string, maxFileSize: number) => BaseFileAdapter
