# mygo 验证工程

这不是产品代码，只用于回答 `docs/features/mygo-rewrite/m0-spike.md` 里的问题。结论见
`docs/features/mygo-rewrite/m0-report.md`。

## 需要

- Go 1.27.3+（`brew install go`）
- 若要加载真实渲染层，先在仓库根目录执行 `pnpm exec electron-vite build --outDir out`

## 运行

```bash
cd shell/spike

# 生成 TypeScript 客户端，不开窗口
MYGO_GENERATE=./frontend/mygo.gen.ts go run .

# 内置探针页：验证绑定、事件、流式通道、自定义协议、截图、PDF、Eval、密钥库
go run . -seconds 10

# 加载 DeepChat 真实渲染层并截图
go run . -seconds 12 -renderer ../../out/renderer -shot /tmp/renderer.png
```

`-probe '<js>'` 可以在页面加载后执行一段脚本并打印返回值。

## 说明

- `frontend/mygo.gen.ts` 是生成物，不提交。
- `main.go` 里的 `deepchatBridgeStub` 是 `window.deepchat` / `window.api` 的最小桩，只保证渲染层能启动；
  真实实现应当把这些调用转给 Node sidecar。

## 最快跑起来

```bash
./shell/spike/run.sh          # 窗口保持 120 秒
./shell/spike/run.sh 30       # 或者自定义秒数
```

脚本会依次构建渲染层、preload 桥、sidecar，然后用一个**临时 profile 目录**启动，不会碰到你的真实 DeepChat 数据。

## 构建顺序

`-sidecar` 模式需要先构建两样东西：

```bash
pnpm run sidecar:build   # out/sidecar/entry.mjs
pnpm run preload:build   # out/preload/bridge.js（应用自己的 createBridge）
```

`-bridge` 可指向别的路径；找不到时会退回到内置替身并在输出里打印 `bridge.missing`。
`-dump-preload <path>` 可以把最终注入的 preload 写出来，配合 `node --check` 排查语法问题。
