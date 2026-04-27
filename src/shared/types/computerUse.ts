export const COMPUTER_USE_SERVER_NAME = 'deepchat/computer-use'
export const COMPUTER_USE_SOURCE = 'deepchat'
export const COMPUTER_USE_SOURCE_ID = 'computer-use'

export type ComputerUsePlatform = 'darwin' | 'unsupported'
export type ComputerUsePermissionName = 'accessibility' | 'screenRecording'
export type ComputerUsePermissionState = 'granted' | 'missing' | 'unknown'
export type ComputerUseMcpState = 'notRegistered' | 'registered' | 'running' | 'error'
export type ComputerUsePermissionTarget = 'all' | ComputerUsePermissionName
export type ComputerUseArch = 'arm64' | 'x64' | 'unknown'

export interface ComputerUsePermissionStatus {
  accessibility: ComputerUsePermissionState
  screenRecording: ComputerUsePermissionState
}

export interface ComputerUseStatus {
  platform: ComputerUsePlatform
  available: boolean
  enabled: boolean
  arch: ComputerUseArch
  helperPath?: string
  helperVersion?: string
  permissions: ComputerUsePermissionStatus
  mcpServer: ComputerUseMcpState
  lastError?: string
}
