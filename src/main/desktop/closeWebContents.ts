import type { WebContents } from 'electron'

export async function closeWebContents(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return
  await new Promise<void>((resolve, reject) => {
    contents.once('destroyed', resolve)
    try {
      contents.close({ waitForBeforeUnload: false })
    } catch (error) {
      contents.removeListener('destroyed', resolve)
      reject(error)
    }
  })
}
