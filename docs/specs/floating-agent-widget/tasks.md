# 悬浮 DeepChat Agent 小部件任务清单

- [x] 编写 spec / plan / tasks 文档
- [ ] 新增悬浮小部件共享类型与主进程布局辅助函数
- [ ] 改造 floating preload API，支持 snapshot / language / expand / open-session
- [ ] 重写 floating renderer UI，支持折叠态、展开态、会话状态标识与空状态
- [ ] 改造主进程 floatingButtonPresenter，接入 snapshot 同步、主窗口跳转、拖拽吸附
- [ ] 将 DeepChat / NewAgent / Config 的变更事件同步到 floating widget
- [ ] 补充测试并完成 format、i18n、lint 校验
