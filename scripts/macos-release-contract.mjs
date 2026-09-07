export function isReleaseNotarizationEnabled(env = process.env) {
  return typeof env.build_for_release === 'string' && env.build_for_release.length > 0
}
