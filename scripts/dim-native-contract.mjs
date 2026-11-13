const targets = Object.freeze({
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc'
})

export function dimPipeName(name) {
  if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error('Invalid dim pipe name')
  return `\\\\.\\pipe\\${name}`
}

export function dimRustTarget(platform, arch) {
  const target = targets[`${platform}-${arch}`]
  if (!target) throw new Error(`Unsupported native dim target: ${platform}-${arch}`)
  return target
}

/** Refuse incorrectly labelled native artifacts before they enter an application package. */
export function assertDimBinary(bytes, platform, arch) {
  dimRustTarget(platform, arch)
  let actual
  if (
    bytes.length >= 20 &&
    bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) &&
    bytes[4] === 2 &&
    bytes[5] === 1
  ) {
    actual = { 62: 'linux-x64', 183: 'linux-arm64' }[bytes.readUInt16LE(18)]
  } else if (bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    actual = { 0x01000007: 'darwin-x64', 0x0100000c: 'darwin-arm64' }[bytes.readUInt32LE(4)]
  } else if (bytes.length >= 64 && bytes.toString('ascii', 0, 2) === 'MZ') {
    const offset = bytes.readUInt32LE(0x3c)
    if (offset <= bytes.length - 24 && bytes.readUInt32LE(offset) === 0x00004550)
      actual = { 0x8664: 'win32-x64', 0xaa64: 'win32-arm64' }[bytes.readUInt16LE(offset + 4)]
  }
  if (actual !== `${platform}-${arch}`)
    throw new Error(
      `Native dim executable target mismatch: expected ${platform}-${arch}, got ${actual ?? 'invalid binary'}`
    )
}
