import {
  isReleaseNotarizationEnabled,
  notarizeReleaseArtifact
} from './apple-notarization.js'

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }
  if (!isReleaseNotarizationEnabled()) {
    console.info('Skipping app notarization because build_for_release is not set')
    return
  }

  const appPath = `${appOutDir}/DeepChat.app`
  console.info(`Notarizing macOS app: ${appPath}`)
  await notarizeReleaseArtifact(appPath)
}
