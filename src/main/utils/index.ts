import { presenter } from '@/presenter'

export function handleShowHiddenWindow(mustShow: boolean) {
  const allWindows = presenter.windowPresenter.getAllWindows()
  if (allWindows.length === 0) {
    presenter.windowPresenter.createShellWindow({
      initialTab: {
        url: 'local://chat'
      }
    })
  } else {
    // 查找目标窗口 (焦点窗口或第一个窗口)
    const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows[0]

    if (!targetWindow.isDestroyed()) {
      // 逻辑: 如果窗口可见且不是从托盘点击触发，则隐藏；否则显示并置顶
      if (targetWindow.isVisible() && !mustShow) {
        presenter.windowPresenter.hide(targetWindow.id)
      } else {
        presenter.windowPresenter.show(targetWindow.id)
        targetWindow.focus() // 确保窗口置顶
      }
    } else {
      console.warn('Target window for SHOW_HIDDEN_WINDOW event is destroyed.') // 保持 warn
      // 如果目标窗口已销毁，创建新窗口
      presenter.windowPresenter.createShellWindow({
        initialTab: {
          url: 'local://chat'
        }
      })
    }
  }
}
