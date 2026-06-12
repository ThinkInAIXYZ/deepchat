import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('启动应用 @smoke', async ({ app }, testInfo) => {
  await waitForAppReady(app.page)

  await expect(app.page.getByTestId('app-main')).toBeVisible()
  await expect(app.page.getByTestId('window-sidebar')).toBeVisible()

  await app.page.screenshot({
    path: testInfo.outputPath('launch.png'),
    fullPage: true
  })
})
