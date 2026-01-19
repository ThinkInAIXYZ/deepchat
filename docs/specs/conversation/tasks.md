# Conversation Domain Tasks

## Todo (Ordered)
- [ ] 1. 对齐数据模型为 Conversation（持久化）与 Session（运行态）。(Plan Step 1)
- [ ] 2. 对齐协议边界为 IThreadPresenter + 运行态适配层（ACP/Agent/Exporter）。(Plan Step 1)
- [ ] 3. 抽离会话核心 store 边界（生命周期 + 消息访问）。(Plan Step 2)
- [ ] 4. 建立执行适配层（发送 + 流式处理）。(Plan Step 3)
- [ ] 5. 建立 ACP 运行态适配层（workdir/mode/model）。(Plan Step 4)
- [ ] 6. 建立工具结果适配层（MCP tool results）。(Plan Step 5)
- [ ] 7. 建立导出适配层（Export/NowledgeMem）。(Plan Step 5)
- [ ] 8. 补齐最小测试（生命周期、分支、流式、ACP 运行态、导出）。(Plan Step 6)

## Deferred (Out of Scope)
- [ ] Message variants.
- [ ] Child session creation from selection.
- [ ] Search/RAG integration.
- [ ] Artifacts integration.
- [ ] Audio features.
