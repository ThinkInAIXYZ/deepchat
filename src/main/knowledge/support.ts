const SUPPORTED_OS = ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64']

export function isBuiltinKnowledgeSupported(): boolean {
  return SUPPORTED_OS.includes(`${process.platform}-${process.arch}`)
}
