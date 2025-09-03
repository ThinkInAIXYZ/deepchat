<p align='center'>
<img src='./build/icon.png' width="150" height="150" alt="DeepChat AI アシスタントアイコン" />
</p>

<h1 align="center">DeepChat - 強力なオープンソースマルチモデルAIチャットプラットフォーム</h1>

<p align="center">DeepChatは、複数のクラウドおよびローカル大規模言語モデルをサポートする機能豊富なオープンソースAIチャットプラットフォームです。強力な検索強化機能とツール呼び出し機能を提供します。</p>

<p align="center">
  <a href="https://github.com/ThinkInAIXYZ/deepchat/stargazers"><img src="https://img.shields.io/github/stars/ThinkInAIXYZ/deepchat" alt="Stars Badge"/></a>
  <a href="https://github.com/ThinkInAIXYZ/deepchat/network/members"><img src="https://img.shields.io/github/forks/ThinkInAIXYZ/deepchat" alt="Forks Badge"/></a>
  <a href="https://github.com/ThinkInAIXYZ/deepchat/pulls"><img src="https://img.shields.io/github/issues-pr/ThinkInAIXYZ/deepchat" alt="Pull Requests Badge"/></a>
  <a href="https://github.com/ThinkInAIXYZ/deepchat/issues"><img src="https://img.shields.io/github/issues/ThinkInAIXYZ/deepchat" alt="Issues Badge"/></a>
  <a href="https://github.com/ThinkInAIXYZ/deepchat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ThinkInAIXYZ/deepchat" alt="License Badge"/></a>
  <a href="https://deepwiki.com/ThinkInAIXYZ/deepchat"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

<div align="center">
  <a href="./README.zh.md">中文</a> / <a href="./README.md">English</a> / <a href="./README.jp.md">日本語</a>
</div>

## 📑 目次

- [📑 目次](#-目次)
- [🚀 プロジェクト紹介](#-プロジェクト紹介)
- [💡 なぜDeepChatを選ぶのか](#-なぜdeepchatを選ぶのか)
- [🔥 主な機能](#-主な機能)
- [🤖 サポートされているモデルプロバイダー](#-サポートされているモデルプロバイダー)
  - [OpenAI/Gemini/Anthropic API形式の任意のモデルプロバイダーと互換性あり](#openaigeminianthropic-api形式の任意のモデルプロバイダーと互換性あり)
- [🔍 ユースケース](#-ユースケース)
- [📦 クイックスタート](#-クイックスタート)
  - [ダウンロードとインストール](#ダウンロードとインストール)
  - [モデルの設定](#モデルの設定)
  - [会話を開始](#会話を開始)
- [💻 開発ガイド](#-開発ガイド)
  - [依存関係のインストール](#依存関係のインストール)
  - [開発を開始](#開発を開始)
  - [ビルド](#ビルド)
- [👥 コミュニティと貢献](#-コミュニティと貢献)
- [⭐ スター履歴](#-スター履歴)
- [👨‍💻 貢献者](#-貢献者)
- [📃 ライセンス](#-ライセンス)

## 🚀 プロジェクト紹介

DeepChatは、様々な大規模言語モデルと対話するための統一されたインターフェースを提供する強力なオープンソースAIチャットプラットフォームです。OpenAI、Gemini、AnthropicなどのクラウドAPIや、ローカルにデプロイされたOllamaモデルを使用する場合でも、DeepChatはスムーズなユーザー体験を提供します。

クロスプラットフォームAIアシスタントアプリケーションとして、DeepChatは基本的なチャット機能をサポートするだけでなく、検索強化、ツール呼び出し、マルチモーダル対話などの高度な機能も提供し、AI機能をより身近で効率的なものにします。

<table align="center">
  <tr>
    <td align="center" style="padding: 10px;">
      <img src='https://github.com/user-attachments/assets/49b32cf8-f114-485f-886e-27e4ac273afa' alt="DeepChat ライトモード" width="400"/>
      <br/>
    </td>
    <td align="center" style="padding: 10px;">
      <img src='https://github.com/user-attachments/assets/1a540ef5-7598-4476-ab32-36cbad306484' alt="DeepChat ダークモード" width="400"/>
      <br/>
    </td>
  </tr>
</table>

## 💡 なぜDeepChatを選ぶのか

他のAIツールと比較して、DeepChatは以下のようなユニークな利点を提供します：

- **統一されたマルチモデル管理**: 1つのアプリケーションでほぼすべての主要なLLMをサポートし、複数のアプリを切り替える必要がありません
- **シームレスなローカルモデル統合**: 組み込みのOllamaサポートにより、コマンドライン操作なしでローカルモデルを管理・使用できます
- **高度なツール呼び出し**: 組み込みのMCPサポートにより、追加設定なしでコード実行、ウェブアクセス、その他のツールを利用可能です
- **強力な検索強化**: 複数の検索エンジンをサポートし、AIの応答をより正確でタイムリーにします。非標準のウェブ検索パラダイムを提供し、迅速なカスタマイズが可能です
- **プライバシー重視**: ローカルデータストレージとネットワークプロキシのサポートにより、情報漏洩のリスクを軽減します
- **ビジネスフレンドリー**: Apache License 2.0の下でオープンソース化され、商用・個人利用の両方に適しています

## 🔥 主な機能

- 🌐 **複数のクラウドLLMプロバイダーサポート**: DeepSeek、OpenAI、SiliconFlow、Grok、Gemini、Anthropicなど
- 🏠 **ローカルモデルデプロイメントサポート**:
  - 包括的な管理機能を備えた統合Ollama
  - コマンドライン操作なしでOllamaモデルのダウンロード、デプロイメント、実行を制御・管理
- 🚀 **豊富で使いやすいチャット機能**
  - 業界最高レベルの [CodeMirror](https://codemirror.net/) を基盤としたコードブロックレンダリングを含む完全なMarkdownレンダリング
  - マルチウィンドウ + マルチタブアーキテクチャで、あらゆる次元でマルチセッション並列動作をサポート。ブラウザのように大規模モデルを使用し、ノンブロッキング体験により優れた効率を実現
  - MCP統合後、トークン消費を大幅に節約する多様な結果表示のためのアーティファクトレンダリングをサポート
  - メッセージは複数のバリエーションを生成するためのリトライをサポート。会話は自由にフォーク可能で、常に適切な思考の流れを確保
  - 画像、Mermaidダイアグラム、その他のマルチモーダルコンテンツのレンダリングをサポート。GPT-4o、Gemini、Grokのテキストから画像生成機能をサポート
  - 検索結果などの外部情報ソースをコンテンツ内でハイライト表示
- 🔍 **強力な検索強化機能**
  - MCPモードで博查搜索、Brave Searchなどの主要な検索APIを組み込み、モデルが検索のタイミングを賢く判断
  - ユーザーのウェブブラウジングをシミュレートすることで、Google、Bing、Baidu、Sogou公式アカウント検索などの主要検索エンジンをサポート
  - あらゆる検索エンジンの読み取りをサポート。検索アシスタントモデルを設定するだけで、内部ネットワーク、APIなしのエンジン、垂直ドメイン検索エンジンなど、様々な情報ソースをモデルに接続可能
- 🔧 **優れたMCP（Model Context Protocol）サポート**
  - MCPプロトコルのResources/Prompts/Tools三大コア機能を完全サポート
  - セマンティックワークフローをサポートし、タスクの意味とコンテキストを理解することで、より複雑でインテリジェントな自動化を実現します。
  - 非常にユーザーフレンドリーな設定インターフェース
  - 美しく明確なツール呼び出し表示
  - ツールパラメータとリターンデータの自動フォーマット機能を備えた詳細なツール呼び出しデバッグウィンドウ
  - 組み込みNode.js実行環境。npx/node類似のサービスは追加設定不要で開箱即用
  - StreamableHTTP/SSE/Stdioプロトコル トランスポートをサポート
  - コード実行、ウェブ情報取得、ファイル操作などの組み込みユーティリティを備えたinMemoryサービスをサポート。二次インストールなしで一般的なユースケースに対応
  - 組み込みMCPサービスを通じて、視覚モデル機能を任意のモデルで使用可能な普遍的な機能に変換
- 💻 **マルチプラットフォームサポート**: Windows、macOS、Linux
- 🎨 **美しく使いやすいインターフェース**、ユーザー志向の設計、丁寧なライト/ダークモードテーマ
- 🔗 **豊富なDeepLinkサポート**: リンクを通じて会話を開始し、他のアプリケーションとシームレスに統合。MCPサービスのワンクリックインストールもサポートし、シンプルさとスピードを実現
- 🚑 **セキュリティ重視の設計**: チャットデータと設定データに暗号化インターフェースとコード難読化機能を備える
- 🛡️ **プライバシー保護**: スクリーン投影の非表示、ネットワークプロキシなどのプライバシー保護方法をサポートし、情報漏洩のリスクを軽減
- 💰 **ビジネスフレンドリー**:
  - オープンソースを採用し、Apache License 2.0ライセンスに基づく、企業利用も安心
  - 企業統合では最小限の設定コード変更のみで予約された暗号化難読化セキュリティ機能を使用可能
  - コード構造が明確で、モデルプロバイダーもMCPサービスも高度に分離されており、最小コストで自由にカスタマイズ可能
  - 合理的なアーキテクチャ、データ相互作用とUI動作の分離により、Electronの機能を十分に活用し、単純なウェブラッパーを拒否、優れたパフォーマンス

## 🤖 サポートされているモデルプロバイダー

<table>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/ollama.svg" width="50" height="50" alt="Ollama Icon"><br/>
      <a href="https://ollama.com">Ollama</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/deepseek-color.svg" width="50" height="50" alt="Deepseek Icon"><br/>
      <a href="https://deepseek.com/">Deepseek</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/ppio-color.svg" width="50" height="50" alt="PPIO Icon"><br/>
      <a href="https://ppinfra.com/">PPIO</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/alibabacloud-color.svg" width="50" height="50" alt="DashScope Icon"><br/>
      <a href="https://www.aliyun.com/product/bailian">DashScope</a>
    </td>
  </tr>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/doubao-color.svg" width="50" height="50" alt="Doubao Icon"><br/>
      <a href="https://console.volcengine.com/ark/">Doubao</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/minimax-color.svg" width="50" height="50" alt="MiniMax Icon"><br/>
      <a href="https://platform.minimaxi.com/">MiniMax</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/fireworks-color.svg" width="50" height="50" alt="Fireworks Icon"><br/>
      <a href="https://fireworks.ai/">Fireworks</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/302ai.svg" width="50" height="50" alt="302.AI Icon"><br/>
      <a href="https://302.ai/">302.AI</a>
    </td>
  </tr>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/openai.svg" width="50" height="50" alt="OpenAI Icon"><br/>
      <a href="https://openai.com/">OpenAI</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/gemini-color.svg" width="50" height="50" alt="Gemini Icon"><br/>
      <a href="https://gemini.google.com/">Gemini</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/github.svg" width="50" height="50" alt="GitHub Models Icon"><br/>
      <a href="https://github.com/marketplace/models">GitHub Models</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/moonshot.svg" width="50" height="50" alt="Moonshot Icon"><br/>
      <a href="https://moonshot.ai/">Moonshot</a>
    </td>
  </tr>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/openrouter.svg" width="50" height="50" alt="OpenRouter Icon"><br/>
      <a href="https://openrouter.ai/">OpenRouter</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/azure-color.svg" width="50" height="50" alt="Azure OpenAI Icon"><br/>
      <a href="https://azure.microsoft.com/en-us/products/ai-services/openai-service">Azure OpenAI</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/qiniu.svg" width="50" height="50" alt="Qiniu Icon"><br/>
      <a href="https://www.qiniu.com/products/ai-token-api">Qiniu</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/grok.svg" width="50" height="50" alt="Grok Icon"><br/>
      <a href="https://x.ai/">Grok</a>
    </td>
  </tr>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/zhipu-color.svg" width="50" height="50" alt="Zhipu Icon"><br/>
      <a href="https://open.bigmodel.cn/">Zhipu</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/siliconcloud.svg" width="50" height="50" alt="SiliconFlow Icon"><br/>
      <a href="https://www.siliconflow.cn/">SiliconFlow</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/aihubmix.png" width="50" height="50" alt="AIHubMix Icon"><br/>
      <a href="https://aihubmix.com/">AIHubMix</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/hunyuan-color.svg" width="50" height="50" alt="Hunyuan Icon"><br/>
      <a href="https://cloud.tencent.com/product/hunyuan">Hunyuan</a>
    </td>
  </tr>
  <tr align="center">
    <td>
      <img src="./src/renderer/src/assets/llm-icons/lmstudio.svg" width="50" height="50" alt="LM Studio Icon"><br/>
      <a href="https://lmstudio.ai/">LM Studio</a>
    </td>
    <td>
      <img src="./src/renderer/src/assets/llm-icons/groq.svg" width="50" height="50" alt="Groq Icon"><br/>
      <a href="https://groq.com/">Groq</a>
    </td>
    <td></td>
    <td></td>
  </tr>

</table>

### OpenAI/Gemini/Anthropic API形式の任意のモデルプロバイダーと互換性あり

## 🔍 ユースケース

DeepChatは様々なAIアプリケーションシナリオに適しています：

- **日常アシスタント**: 質問への回答、提案の提供、文章作成の支援
- **開発支援**: コード生成、デバッグ、技術的問題の解決
- **学習ツール**: 概念の説明、知識の探求、学習ガイダンス
- **コンテンツ作成**: コピーライティング、クリエイティブなインスピレーション、コンテンツの最適化
- **データ分析**: データの解釈、チャート生成、レポート作成

## 📦 クイックスタート

### ダウンロードとインストール

[GitHub Releases](https://github.com/ThinkInAIXYZ/deepchat/releases)ページからお使いのシステム用の最新バージョンをダウンロードしてください：

- Windows: `.exe`インストールファイル
- macOS: `.dmg`インストールファイル
- Linux: `.AppImage`または`.deb`インストールファイル

### モデルの設定

1. DeepChatアプリケーションを起動
2. 設定アイコンをクリック
3. "モデルプロバイダー"タブを選択
4. APIキーを追加するか、ローカルOllamaを設定

### 会話を開始

1. "+"ボタンをクリックして新しい会話を作成
2. 使用したいモデルを選択
3. AIアシスタントとの対話を開始

## 💻 開発ガイド

[貢献ガイドライン](./CONTRIBUTING.md)をお読みください。

WindowsとLinuxはGitHub Actionによってパッケージングされます。
Mac関連の署名とパッケージングについては、[Mac リリースガイド](https://github.com/ThinkInAIXYZ/deepchat/wiki/Mac-Release-Guide)を参照してください。

### 依存関係のインストール

```bash
$ pnpm install
$ pnpm run installRuntime
# エラーが出た場合: No module named 'distutils'
$ pip install setuptools
```

* For Windows: 非管理者ユーザーがシンボリックリンクやハードリンクを作成できるようにするには、設定で「開発者モード」を有効にするか、管理者アカウントを使用してください。それ以外の場合、pnpm の操作は失敗します。

### 開発を開始

```bash
$ pnpm run dev
```

### ビルド

```bash
# Windowsの場合
$ pnpm run build:win

# macOSの場合
$ pnpm run build:mac

# Linuxの場合
$ pnpm run build:linux

# アーキテクチャを指定してパッケージング
$ pnpm run build:win:x64
$ pnpm run build:win:arm64
$ pnpm run build:mac:x64
$ pnpm run build:mac:arm64
$ pnpm run build:linux:x64
$ pnpm run build:linux:arm64
```

## 👥 コミュニティと貢献

DeepChatはアクティブなオープンソースコミュニティプロジェクトであり、様々な形での貢献を歓迎します：

- 🐛 [問題を報告する](https://github.com/ThinkInAIXYZ/deepchat/issues)
- 💡 [機能の提案を提出する](https://github.com/ThinkInAIXYZ/deepchat/issues)
- 🔧 [コードの改善を提出する](https://github.com/ThinkInAIXYZ/deepchat/pulls)
- 📚 [ドキュメントを改善する](https://github.com/ThinkInAIXYZ/deepchat/wiki)
- 🌍 [翻訳を手伝う](https://github.com/ThinkInAIXYZ/deepchat/tree/main/locales)

プロジェクトへの参加方法について詳しく知るには、[貢献ガイドライン](./CONTRIBUTING.md)をご確認ください。

## ⭐ スター履歴

[![Star History Chart](https://api.star-history.com/svg?repos=ThinkInAIXYZ/deepchat&type=Timeline)](https://www.star-history.com/#ThinkInAIXYZ/deepchat&Timeline)

## 👨‍💻 貢献者

deepchatへの貢献をご検討いただきありがとうございます！貢献ガイドは[貢献ガイドライン](./CONTRIBUTING.md)でご確認いただけます。

<a href="https://openomy.com/thinkinaixyz/deepchat" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=thinkinaixyz/deepchat&chart=bubble&latestMonth=3" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>

## 🙏🏻 謝辞

このプロジェクトは、以下の素晴らしいライブラリの支援により構築されています：

- [Vue](https://vuejs.org/)
- [Electron](https://www.electronjs.org/)
- [Electron-Vite](https://electron-vite.org/)
- [oxlint](https://github.com/oxc-project/oxc)

## 📃 ライセンス

[LICENSE](./LICENSE)
