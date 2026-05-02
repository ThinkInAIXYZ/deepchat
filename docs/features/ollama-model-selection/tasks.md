# Ollama 模型可选性与跨窗口同步任务拆分

- [x] 为 config/model status 增加 `ensureModelStatus` 语义。
- [x] 调整 Ollama provider 的模型抓取逻辑，合并本地与运行中模型。
- [x] 调整 renderer `ollamaStore`，改为 UI 状态 + 主进程刷新链路。
- [x] 移除 Ollama 模型状态更新的本地短路逻辑，保证显式关闭可持久化。
- [x] 补充 main/store/component 回归测试。
- [x] 运行 `pnpm run format`
- [x] 运行 `pnpm run i18n`
- [x] 运行 `pnpm run lint`
- [x] 运行相关测试并确认通过
