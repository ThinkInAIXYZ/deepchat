<p align='center'>
<img src='./build/icon.png' width="150" height="150" alt="DeepChat AI Assistant Icon" />
</p>

<h1 align="center">DeepChat - Powerful Open-Source Multi-Model AI Chat Platform</h1>

<p align="center">DeepChat is a feature-rich open-source AI chat platform supporting multiple cloud and local large language models with powerful search enhancement and tool calling capabilities.</p>

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

## 📑 Table of Contents

- [📑 Table of Contents](#-table-of-contents)
- [🚀 Project Introduction](#-project-introduction)
- [💡 Why Choose DeepChat](#-why-choose-deepchat)
- [🔥 Main Features](#-main-features)
- [🤖 Supported Model Providers](#-supported-model-providers)
  - [Compatible with any model provider in OpenAI/Gemini/Anthropic API format](#compatible-with-any-model-provider-in-openaigeminianthropic-api-format)
- [🔍 Use Cases](#-use-cases)
- [📦 Quick Start](#-quick-start)
  - [Download and Install](#download-and-install)
  - [Configure Models](#configure-models)
  - [Start Conversations](#start-conversations)
- [💻 Development Guide](#-development-guide)
  - [Install Dependencies](#install-dependencies)
  - [Start Development](#start-development)
  - [Build](#build)
- [👥 Community \& Contribution](#-community--contribution)
- [⭐ Star History](#-star-history)
- [👨‍💻 Contributors](#-contributors)
- [📃 License](#-license)

## 🚀 Project Introduction

DeepChat is a powerful open-source AI chat platform providing a unified interface for interacting with various large language models. Whether you're using cloud APIs like OpenAI, Gemini, Anthropic, or locally deployed Ollama models, DeepChat delivers a smooth user experience.

As a cross-platform AI assistant application, DeepChat not only supports basic chat functionality but also offers advanced features such as search enhancement, tool calling, and multimodal interaction, making AI capabilities more accessible and efficient.

<table align="center">
  <tr>
    <td align="center" style="padding: 10px;">
      <img src='https://github.com/user-attachments/assets/5df4ed93-e4b5-4430-a1e3-bd9beba79e64' alt="DeepChat Light Mode" width="400"/>
      <br/>
    </td>
    <td align="center" style="padding: 10px;">
      <img src='https://github.com/user-attachments/assets/79be4873-f80e-43a9-bfac-e1efb246ea99' alt="DeepChat Dark Mode" width="400"/>
      <br/>
    </td>
  </tr>
</table>

## 💡 Why Choose DeepChat

Compared to other AI tools, DeepChat offers the following unique advantages:

- **Unified Multi-Model Management**: One application supports almost all mainstream LLMs, eliminating the need to switch between multiple apps
- **Seamless Local Model Integration**: Built-in Ollama support allows you to manage and use local models without command-line operations
- **Advanced Tool Calling**: Built-in MCP support enables code execution, web access, and other tools without additional configuration
- **Powerful Search Enhancement**: Support for multiple search engines makes AI responses more accurate and timely, providing non-standard web search paradigms that can be quickly customized
- **Privacy-Focused**: Local data storage and network proxy support reduce the risk of information leakage
- **Business-Friendly**: Embraces open source under the Apache License 2.0, suitable for both commercial and personal use

## 🔥 Main Features

- 🌐 **Multiple Cloud LLM Provider Support**: DeepSeek, OpenAI, SiliconFlow, Grok, Gemini, Anthropic, and more
- 🏠 **Local Model Deployment Support**:
  - Integrated Ollama with comprehensive management capabilities
  - Control and manage Ollama model downloads, deployments, and runs without command-line operations
- 🚀 **Rich and Easy-to-Use Chat Capabilities**
  - Complete Markdown rendering with code block rendering based on industry-leading [CodeMirror](https://codemirror.net/)
  - Multi-window + multi-tab architecture supporting parallel multi-session operations across all dimensions, use large models like using a browser, non-blocking experience brings excellent efficiency
  - Supports Artifacts rendering for diverse result presentation, significantly saving token consumption after MCP integration
  - Messages support retry to generate multiple variations; conversations can be forked freely, ensuring there's always a suitable line of thought
  - Supports rendering images, Mermaid diagrams, and other multi-modal content; supports GPT-4o, Gemini, Grok text-to-image capabilities
  - Supports highlighting external information sources like search results within the content
- 🔍 **Robust Search Extension Capabilities**
  - Built-in integration with leading search APIs like BoSearch, Brave Search via MCP mode, allowing the model to intelligently decide when to search
  - Supports mainstream search engines like Google, Bing, Baidu, and Sogou Official Accounts search by simulating user web browsing, enabling the LLM to read search engines like a human
  - Supports reading any search engine; simply configure a search assistant model to connect various search sources, whether internal networks, API-less engines, or vertical domain search engines, as information sources for the model
- 🔧 **Excellent MCP (Model Context Protocol) Support**
  - Complete support for the three core capabilities of Resources/Prompts/Tools in the MCP protocol
  - Supports semantic workflows, enabling more complex and intelligent automation by understanding the meaning and context of tasks.
  - Extremely user-friendly configuration interface
  - Aesthetically pleasing and clear tool call display
  - Detailed tool call debugging window with automatic formatting of tool parameters and return data
  - Built-in Node.js runtime environment; npx/node-like services require no extra configuration and work out-of-the-box
  - Supports StreamableHTTP/SSE/Stdio protocol Transports
  - Supports inMemory services with built-in utilities like code execution, web information retrieval, and file operations; ready for most common use cases out-of-the-box without secondary installation
  - Converts visual model capabilities into universally usable functions for any model via the built-in MCP service
- 💻 **Multi-Platform Support**: Windows, macOS, Linux
- 🎨 **Beautiful and User-Friendly Interface**, user-oriented design, meticulously themed light and dark modes
- 🔗 **Rich DeepLink Support**: Initiate conversations via links for seamless integration with other applications. Also supports one-click installation of MCP services for simplicity and speed
- 🚑 **Security-First Design**: Chat data and configuration data have reserved encryption interfaces and code obfuscation capabilities
- 🛡️ **Privacy Protection**: Supports screen projection hiding, network proxies, and other privacy protection methods to reduce the risk of information leakage
- 💰 **Business-Friendly**:
  - Embraces open source, based on the Apache License 2.0 protocol, enterprise use without worry
  - Enterprise integration requires only minimal configuration code changes to use reserved encrypted obfuscation security capabilities
  - Clear code structure, both model providers and MCP services are highly decoupled, can be freely customized with minimal cost
  - Reasonable architecture, data interaction and UI behavior separation, fully utilizing Electron's capabilities, rejecting simple web wrappers, excellent performance

For more details on how to use these features, see the [User Guide](./docs/user-guide.md).

## 🤖 Supported Model Providers

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

### Compatible with any model provider in OpenAI/Gemini/Anthropic API format

## 🔍 Use Cases

DeepChat is suitable for various AI application scenarios:

- **Daily Assistant**: Answering questions, providing suggestions, assisting with writing and creation
- **Development Aid**: Code generation, debugging, technical problem solving
- **Learning Tool**: Concept explanation, knowledge exploration, learning guidance
- **Content Creation**: Copywriting, creative inspiration, content optimization
- **Data Analysis**: Data interpretation, chart generation, report writing

## 📦 Quick Start

### Download and Install

Download the latest version for your system from the [GitHub Releases](https://github.com/ThinkInAIXYZ/deepchat/releases) page:

- Windows: `.exe` installation file
- macOS: `.dmg` installation file
- Linux: `.AppImage` or `.deb` installation file

### Configure Models

1. Launch the DeepChat application
2. Click the settings icon
3. Select the "Model Providers" tab
4. Add your API keys or configure local Ollama

### Start Conversations

1. Click the "+" button to create a new conversation
2. Select the model you want to use
3. Start communicating with your AI assistant

For a comprehensive guide on getting started and using all features, please refer to the [User Guide](./docs/user-guide.md).

## 💻 Development Guide

Please read the [Contribution Guidelines](./CONTRIBUTING.md)

Windows and Linux are packaged by GitHub Action.
For Mac-related signing and packaging, please refer to the [Mac Release Guide](https://github.com/ThinkInAIXYZ/deepchat/wiki/Mac-Release-Guide).

### Install Dependencies

```bash
$ pnpm install
$ pnpm run installRuntime
# if got err: No module named 'distutils'
$ pip install setuptools
```

* For Windows: To allow non-admin users to create symlinks and hardlinks, enable `Developer Mode` in Settings or use an administrator account. Otherwise `pnpm` ops will fail.

### Start Development

```bash
$ pnpm run dev
```

### Build

```bash
# For Windows
$ pnpm run build:win

# For macOS
$ pnpm run build:mac

# For Linux
$ pnpm run build:linux

# Specify architecture packaging
$ pnpm run build:win:x64
$ pnpm run build:win:arm64
$ pnpm run build:mac:x64
$ pnpm run build:mac:arm64
$ pnpm run build:linux:x64
$ pnpm run build:linux:arm64
```

For a more detailed guide on development, project structure, and architecture, please see the [Developer Guide](./docs/developer-guide.md).

## 👥 Community & Contribution

DeepChat is an active open-source community project, and we welcome various forms of contribution:

- 🐛 [Report issues](https://github.com/ThinkInAIXYZ/deepchat/issues)
- 💡 [Submit feature suggestions](https://github.com/ThinkInAIXYZ/deepchat/issues)
- 🔧 [Submit code improvements](https://github.com/ThinkInAIXYZ/deepchat/pulls)
- 📚 [Improve documentation](https://github.com/ThinkInAIXYZ/deepchat/wiki)
- 🌍 [Help with translation](https://github.com/ThinkInAIXYZ/deepchat/tree/main/locales)

Check the [Contribution Guidelines](./CONTRIBUTING.md) to learn more about ways to participate in the project.

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ThinkInAIXYZ/deepchat&type=Timeline)](https://www.star-history.com/#ThinkInAIXYZ/deepchat&Timeline)

## 👨‍💻 Contributors

Thank you for considering contributing to deepchat! The contribution guide can be found in the [Contribution Guidelines](./CONTRIBUTING.md).

<a href="https://openomy.com/thinkinaixyz/deepchat" target="_blank" style="display: block; width: 100%;" align="center">
  <img src="https://openomy.com/svg?repo=thinkinaixyz/deepchat&chart=bubble&latestMonth=3" target="_blank" alt="Contribution Leaderboard" style="display: block; width: 100%;" />
</a>

## 🙏🏻 Thanks

This project is built with the help of these awesome libraries:

- [Vue](https://vuejs.org/)
- [Electron](https://www.electronjs.org/)
- [Electron-Vite](https://electron-vite.org/)
- [oxlint](https://github.com/oxc-project/oxc)

## 📃 License

[LICENSE](./LICENSE)

