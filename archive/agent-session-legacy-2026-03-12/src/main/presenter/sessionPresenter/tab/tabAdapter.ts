import type { ITabAdapter } from './tabManager'

export class TabAdapter implements ITabAdapter {
  constructor(private readonly getTabFn: (tabId: number) => Promise<any>) {}

  async getTab(tabId: number): Promise<any> {
    return await this.getTabFn(tabId)
  }

  async switchTab(_tabId: number): Promise<void> {
    throw new Error('switchTab must be implemented by TabPresenter integration')
  }

  getWindowId(_tabId: number): number | undefined {
    throw new Error('getWindowId must be implemented by TabPresenter integration')
  }
}
