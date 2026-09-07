export interface DeviceServicePort {
  getAppVersion(): Promise<string>
  getDeviceInfo(): Promise<DeviceInfo>
  getCPUUsage(): Promise<number>
  getMemoryUsage(): Promise<MemoryInfo>
  getDiskSpace(): Promise<DiskInfo>
  resetData(): Promise<void>
  resetDataByType(resetType: 'chat' | 'knowledge' | 'config' | 'all'): Promise<void>
  selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }>
  selectFiles(options?: {
    filters?: { name: string; extensions: string[] }[]
    multiple?: boolean
  }): Promise<{ canceled: boolean; filePaths: string[] }>
  restartApp(): Promise<void>
  cacheImage(imageData: string): Promise<string>
  sanitizeSvgContent(svgContent: string): Promise<string | null>
}

export type DeviceInfo = {
  platform: string
  arch: string
  cpuModel: string
  totalMemory: number
  osVersion: string
  osVersionMetadata: Array<{ name: string; build: number }>
}

export type MemoryInfo = {
  total: number
  free: number
  used: number
}

export type DiskInfo = {
  total: number
  free: number
  used: number
}
