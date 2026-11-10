export function nativeMediaReference(source: string): { task: string; name: string } | null {
  const match = /^imgcache:\/\/dim_(mt_[a-f0-9-]{36})__([a-zA-Z0-9._-]{1,200})$/.exec(source)
  if (!match || !/^mt_[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(match[1])) return null
  return match[2] === '.' || match[2] === '..' ? null : { task: match[1], name: match[2] }
}
