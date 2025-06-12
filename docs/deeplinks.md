# DeepChat DeepLinks 文档 / DeepChat DeepLinks Documentation

DeepChat支持通过深度链接(Deeplinks)进行外部调用。本文档介绍了DeepChat支持的深度链接类型、参数及使用方法。

DeepChat supports external invocation through deeplinks. This documentation introduces the types of deeplinks supported by DeepChat, their parameters, and usage methods.

## 开始聊天 / Start Chat

通过此链接可以快速开始一个新的聊天会话，并可选择指定模型和初始消息。

Use this deeplink to quickly start a new chat session with optional model selection and initial message.

### URL格式 / URL Format

```
deepchat://start?msg={query}&system={systemPrompt}&model={modelId|modelName}
```

### 参数说明 / Parameters

| 参数名 / Parameter | 类型 / Type | 必填 / Required | 说明 / Description                                                                                          |
| ------------------ | ----------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| msg                | string      | 否 / No         | 初始聊天内容 / Initial chat message                                                                         |
| system             | string      | 否 / No         | 系统提示词 / System prompt                                                                                  |
| model              | string      | 否 / No         | 模型ID或名称，如"gpt-3.5-turbo"、"deepseek-chat" / Model ID or name, e.g., "gpt-3.5-turbo", "deepseek-chat" |

### 行为 / Behavior

1. 如果当前不在聊天页面，会自动跳转到聊天页面
2. 如果指定了模型，会尝试匹配并选择相应模型（先精确匹配，再模糊匹配）
3. 如果提供了初始消息，将自动填充到输入框中

1. If not currently on the chat page, it will automatically navigate to the chat page
2. If a model is specified, it will attempt to match and select the corresponding model (exact match first, then fuzzy match)
3. If an initial message is provided, it will be automatically filled in the input box

### 示例 / Examples

基本使用，打开与GPT-3.5的对话：
Basic usage, open a conversation with GPT-3.5:

```
deepchat://start?model=gpt-3.5-turbo
```

指定初始消息：
Specify an initial message:

```
deepchat://start?msg=帮我写一篇关于人工智能的文章
```

完整示例（指定模型、消息和系统提示词）：
Complete example (specifying model, message, and system prompt):

```
deepchat://start?msg=帮我分析这段代码&model=deepseek-coder&system=你是一个代码分析专家
```

## 登录成功 / Login Success

通过此深度链接可以将登录成功后的认证令牌(token)传递到DeepChat客户端。登录成功后，客户端会自动使用令牌获取用户信息。

Use this deeplink to pass authentication token to DeepChat client after successful login. After successful login, the client will automatically fetch user information using the token.

### URL格式 / URL Format

```
deepchat://login/success?token={authToken}
```

### 参数说明 / Parameters

| 参数名 / Parameter | 类型 / Type | 必填 / Required | 说明 / Description                          |
| ------------------ | ----------- | --------------- | ------------------------------------------- |
| token              | string      | 是 / Yes        | 认证令牌 / Authentication token             |

### 行为 / Behavior

1. 如果应用处于最小化状态，会恢复并获得焦点
2. 将接收到的token保存到本地配置中
3. 使用token自动获取用户信息并保存
4. 更新应用的登录状态
5. 如果当前在登录页面，会自动跳转到聊天页面

1. If the application is minimized, it will be restored and brought to focus
2. The received token will be saved to local configuration
3. Automatically fetch and save user information using the token
4. Update the application's login state
5. If currently on the login page, it will automatically navigate to the chat page

### 用户信息API / User Information API

客户端会向以下API发起请求以获取用户信息：

The client will make a request to the following API to obtain user information:

```
GET {apiBaseUrl}/api/user/current
Authorization: Bearer {token}
```

API响应示例：

API response example:

```json
{
  "authProviders": [
    {
      "providerName": "github",
      "providerDisplay": "GitHub",
      "providerUserId": "6119842"
    }
  ],
  "avatarUrl": "https://avatars.githubusercontent.com/u/6119842?v=4",
  "createdAt": "2025-04-25T23:02:05+08:00",
  "email": "eric.yuanxin@gmail.com",
  "id": 1,
  "language": "zh-CN",
  "lastLoginAt": "2025-04-26T23:29:50+08:00",
  "nickname": "Eric.Yuan",
  "status": 1,
  "username": "github_6119842"
}
```

其中apiBaseUrl默认为`https://api.deepchat.dev`，可以通过配置修改。

Where apiBaseUrl defaults to `https://api.deepchat.dev` and can be configured.

### 示例 / Examples

基本使用，传递认证令牌：

Basic usage, pass authentication token:

```
deepchat://login/success?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 安装MCP / Install MCP

通过此深度链接可以安装MCP（模型控制协议）服务配置。

Use this deeplink to install Model Control Protocol (MCP) service configuration.

### URL格式 / URL Format

```
deepchat://mcp/install?code={base64Encode(JSON.stringify(jsonConfig))}
```

### 参数说明 / Parameters

| 参数名 / Parameter | 类型 / Type   | 必填 / Required | 说明 / Description                                                                                 |
| ------------------ | ------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| code               | string (JSON) | 是 / Yes        | MCP服务配置的JSON字符串（需Base64编码）/ JSON string of MCP service configuration (Base64 encoded) |

### 行为 / Behavior

1. 如果MCP功能未启用，会自动启用
2. 自动导航到设置页面的MCP配置部分
3. 打开添加服务器对话框，并自动填充配置数据

1. If the MCP feature is not enabled, it will be automatically enabled
2. Automatically navigate to the MCP configuration section of the settings page
3. Open the add server dialog and automatically fill in the configuration data

### 配置JSON格式 / Configuration JSON Format

MCP配置JSON应包含以下结构：

The MCP configuration JSON should contain the following structure:

最小化的JSON格式样例:

### 包含 command 不包含 url，识别为 stdio
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-filesystem-server",
      "args": [
        "/Users/username/Desktop",
      ]
    }
  }
}
```
### 包含 url 不包含 command ，默认识别为 sse
```json

{
  "mcpServers": {
    "browser-use-mcp-server": {
      "url": "http://localhost:8000/sse"
    }
  }
}
```

完整的JSON格式：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-filesystem-server",
      "args": [
        "/Users/username/Desktop",
      ],
      "env": {},
      "descriptions": "filesystem mcp server",
      "icons": "📁",
      "type" :"stdio",
      "autoApprove": ["all"]
    }
  }
}
```
```json
{
  "mcpServers": {
    "browser-use-mcp-server": {
      "url": "http://localhost:8000/sse",
      "type":"sse",
      "icons": "🏠",
      "autoApprove": ["all"],
    }
  }
}
```

## 如何生成安装 code 参数(How to Generate MCPConfig code params)

```javascript
import { encode } from 'js-base64';

const config = {
  "mcpServers": {
    "browser-use-mcp-server": {
      "url": "http://localhost:8000/sse"
    }
  }
}
const code =encode(JSON.stringify(config))

```

## 聊天唤起样例 (Chat Example)
```
deepchat://start?msg=%E5%A4%A9%E6%B0%94%E4%B8%8D%E9%94%99&system=%E4%BD%A0%E6%98%AF%E4%B8%80%E4%B8%AA%E9%A2%84%E6%8A%A5%E5%91%98%2C%E8%AF%B7%E4%BD%A0%E7%A4%BC%E8%B2%8C%E8%80%8C%E4%B8%93%E4%B8%9A%E5%9B%9E%E7%AD%94%E7%94%A8%E6%88%B7%E9%97%AE%E9%A2%98&model=deepseek-chat
```

## STDIO 安装样例 (Stdio Example)

```
deepchat://mcp/install?code=eyJtY3BTZXJ2ZXJzIjp7ImZpbGVzeXN0ZW0iOnsiY29tbWFuZCI6Im1jcC1maWxlc3lzdGVtLXNlcnZlciIsImFyZ3MiOlsiL1VzZXJzL3VzZXJuYW1lL0Rlc2t0b3AiXX19fQ==
```

## SSE 安装样例 (SSE Example)

```
deepchat://mcp/install?code=eyJtY3BTZXJ2ZXJzIjp7ImJyb3dzZXItdXNlLW1jcC1zZXJ2ZXIiOnsidXJsIjoiaHR0cDovL2xvY2FsaG9zdDo4MDAwL3NzZSJ9fX0=
```