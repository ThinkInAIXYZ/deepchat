export type NativeMediaReference =
  | { kind: 'task'; task: string; name: string }
  | { kind: 'file'; fileId: string; name: string }
export function nativeMediaReference(source: string): NativeMediaReference | null {
  const file =
    /^imgcache:\/\/dim_file_([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})__([a-zA-Z0-9._-]{1,200})$/.exec(
      source
    )
  if (file)
    return file[2] === '.' || file[2] === '..'
      ? null
      : { kind: 'file', fileId: file[1], name: file[2] }
  const match = /^imgcache:\/\/dim_(mt_[a-f0-9-]{36})__([a-zA-Z0-9._-]{1,200})$/.exec(source)
  if (!match || !/^mt_[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(match[1])) return null
  return match[2] === '.' || match[2] === '..'
    ? null
    : { kind: 'task', task: match[1], name: match[2] }
}
