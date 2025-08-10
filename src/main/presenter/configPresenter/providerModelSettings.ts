import { ModelType } from '@shared/model'
import { ModelConfig } from '@shared/presenter'

// 定义每个provider的模型匹配规则和配置的接口，与modelDefaultSettings保持一致的风格
export interface ProviderModelSetting {
  id: string // 模型ID
  name: string // 模型名称
  match: string[] // 用于匹配模型ID的字符串数组
  maxTokens: number // 最大生成token数
  contextLength: number // 上下文长度
  temperature?: number // 温度参数
  vision?: boolean // 是否支持视觉
  functionCall?: boolean // 是否支持函数调用
  reasoning?: boolean // 是否支持推理能力
  type?: ModelType // 模型类型，默认为Chat
  // GPT-5 系列新参数
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  maxCompletionTokens?: number // GPT-5 系列使用此参数替代 maxTokens
}

// 为每个提供商创建映射对象，使用models数组包装模型配置
export const providerModelSettings: Record<string, { models: ProviderModelSetting[] }> = {
  // OpenAI提供商特定模型配置
  openai: {
    models: [
      {
        id: 'gpt-5-chat',
        name: 'GPT-5 Chat',
        maxTokens: 16384,
        contextLength: 272000,
        match: ['gpt-5-chat', 'gpt-5-chat-latest'],
        vision: true,
        functionCall: false,
        reasoning: true,
        reasoningEffort: 'medium',
        verbosity: 'medium',
        maxCompletionTokens: 16384
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        maxTokens: 128000,
        contextLength: 272000,
        match: ['gpt-5-mini', 'gpt-5-mini-2025-08-07'],
        vision: true,
        functionCall: true,
        reasoning: true,
        reasoningEffort: 'medium',
        verbosity: 'medium',
        maxCompletionTokens: 128000
      },
      {
        id: 'gpt-5-nano',
        name: 'GPT-5 Nano',
        maxTokens: 128000,
        contextLength: 272000,
        match: ['gpt-5-nano', 'gpt-5-nano-2025-08-07'],
        vision: true,
        functionCall: true,
        reasoning: true,
        reasoningEffort: 'medium',
        verbosity: 'medium',
        maxCompletionTokens: 128000
      },
      {
        id: 'gpt-5',
        name: 'GPT-5',
        maxTokens: 128000,
        contextLength: 272000,
        match: ['gpt-5', 'gpt-5-2025-08-07'],
        vision: true,
        functionCall: true,
        reasoning: true,
        reasoningEffort: 'medium',
        verbosity: 'medium',
        maxCompletionTokens: 128000
      }
    ]
  },

  // 火山引擎(Doubao)提供商特定模型配置
  doubao: {
    models: []
  },

  // Anthropic提供商特定模型配置
  anthropic: {
    models: [
      {
        id: 'claude-opus-4-1',
        name: 'Claude Opus 4.1',
        temperature: 0.7,
        maxTokens: 32000,
        contextLength: 204800,
        match: ['claude-opus-4-1', 'claude-opus-4-1-20250805'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-opus-4',
        name: 'Claude Opus 4',
        temperature: 0.7,
        maxTokens: 32000,
        contextLength: 204800,
        match: ['claude-opus-4', 'claude-opus-4-20250514'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        temperature: 0.7,
        maxTokens: 64000,
        contextLength: 204800,
        match: ['claude-sonnet-4', 'claude-sonnet-4-20250514'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        temperature: 1,
        maxTokens: 64000,
        contextLength: 204800,
        match: ['claude-3-7-sonnet', 'claude-3.7-sonnet'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 204800,
        match: ['claude-3-5-sonnet', 'claude-3.5-sonnet'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 204800,
        match: ['claude-3-opus', 'claude-3.opus'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3-haiku',
        name: 'Claude 3 Haiku',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 204800,
        match: ['claude-3-haiku', 'claude-3.haiku', 'claude-3-5-haiku', 'claude-3.5-haiku'],
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]
  },

  // Gemini提供商特定模型配置
  gemini: {
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        temperature: 0.7,
        maxTokens: 65536,
        contextLength: 1048576,
        match: ['gemini-2.5-pro'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'models/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        temperature: 0.7,
        maxTokens: 65536,
        contextLength: 1048576,
        match: ['models/gemini-2.5-flash', 'gemini-2.5-flash'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'models/gemini-2.5-flash-lite-preview-06-17',
        name: 'Gemini 2.5 Flash-Lite Preview',
        temperature: 0.7,
        maxTokens: 64000,
        contextLength: 1000000,
        match: ['models/gemini-2.5-flash-lite-preview-06-17', 'gemini-2.5-flash-lite-preview'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'models/gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 1048576,
        match: ['models/gemini-2.0-flash', 'gemini-2.0-flash'],
        vision: true,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'models/gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash Lite',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 1048576,
        match: ['models/gemini-2.0-flash-lite', 'gemini-2.0-flash-lite'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'models/gemini-2.0-flash-preview-image-generation',
        name: 'Gemini 2.0 Flash Preview Image Generation',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32000,
        match: [
          'models/gemini-2.0-flash-preview-image-generation',
          'gemini-2.0-flash-preview-image-generation'
        ],
        vision: true,
        functionCall: true,
        reasoning: false,
        type: ModelType.ImageGeneration
      },
      {
        id: 'models/gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 1048576,
        match: ['models/gemini-1.5-flash', 'gemini-1.5-flash'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'models/gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 2097152,
        match: ['models/gemini-1.5-pro', 'gemini-1.5-pro'],
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]
  },

  // 华为云Hunyuan提供商特定模型配置
  hunyuan: {
    models: []
  },

  // DeepSeek提供商特定模型配置
  deepseek: {
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek chat',
        temperature: 1,
        maxTokens: 8192,
        contextLength: 65536,
        match: ['deepseek-chat'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        temperature: 1,
        maxTokens: 65536,
        contextLength: 65536,
        match: ['deepseek-reasoner'],
        vision: false,
        functionCall: true,
        reasoning: true
      }
    ]
  },

  // MiniMax提供商特定模型配置
  minimax: {
    models: []
  },

  // 智谱AI提供商特定模型配置
  zhipu: {
    models: [
      // GLM 4.5 系列模型
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 128000,
        match: ['glm-4.5'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'glm-4.5-air',
        name: 'GLM-4.5-Air',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 128000,
        match: ['glm-4.5-air'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'glm-4.5-x',
        name: 'GLM-4.5-X',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 128000,
        match: ['glm-4.5-x'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'glm-4.5-airx',
        name: 'GLM-4.5-AirX',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 128000,
        match: ['glm-4.5-airx'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'glm-4.5-flash',
        name: 'GLM-4.5-Flash',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 128000,
        match: ['glm-4.5-flash'],
        vision: false,
        functionCall: true,
        reasoning: true
      }
    ]
  },

  // Moonshot提供商特定模型配置
  moonshot: {
    models: []
  },

  // Ollama提供商特定模型配置
  ollama: {
    models: [
      // OpenAI开源模型
      {
        id: 'gpt-oss:20b',
        name: 'GPT-OSS 20B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 32768,
        match: ['gpt-oss:20b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'gpt-oss:120b',
        name: 'GPT-OSS 120B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['gpt-oss:120b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      // DeepSeek推理模型系列
      {
        id: 'deepseek-r1:1.5b',
        name: 'DeepSeek R1 1.5B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['deepseek-r1:1.5b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:7b',
        name: 'DeepSeek R1 7B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['deepseek-r1:7b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:8b',
        name: 'DeepSeek R1 8B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['deepseek-r1:8b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:14b',
        name: 'DeepSeek R1 14B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['deepseek-r1:14b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:32b',
        name: 'DeepSeek R1 32B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 65536,
        match: ['deepseek-r1:32b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:70b',
        name: 'DeepSeek R1 70B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['deepseek-r1:70b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-r1:671b',
        name: 'DeepSeek R1 671B',
        temperature: 0.7,
        maxTokens: 65536,
        contextLength: 131072,
        match: ['deepseek-r1:671b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      // DeepSeek V3/V2.5系列
      {
        id: 'deepseek-v3:671b',
        name: 'DeepSeek V3 671B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['deepseek-v3:671b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'deepseek-v2.5:236b',
        name: 'DeepSeek V2.5 236B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['deepseek-v2.5:236b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Gemma3系列
      {
        id: 'gemma3:1b',
        name: 'Gemma3 1B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma3:1b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma3:4b',
        name: 'Gemma3 4B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma3:4b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma3:12b',
        name: 'Gemma3 12B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 65536,
        match: ['gemma3:12b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma3:27b',
        name: 'Gemma3 27B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 65536,
        match: ['gemma3:27b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Gemma2系列
      {
        id: 'gemma2:2b',
        name: 'Gemma2 2B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma2:2b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma2:9b',
        name: 'Gemma2 9B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma2:9b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma2:27b',
        name: 'Gemma2 27B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 65536,
        match: ['gemma2:27b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Gemma系列
      {
        id: 'gemma:2b',
        name: 'Gemma 2B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma:2b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemma:7b',
        name: 'Gemma 7B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['gemma:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Qwen3系列
      {
        id: 'qwen3:0.6b',
        name: 'Qwen3 0.6B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:0.6b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:1.7b',
        name: 'Qwen3 1.7B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:1.7b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:4b',
        name: 'Qwen3 4B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:4b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:8b',
        name: 'Qwen3 8B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:8b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:14b',
        name: 'Qwen3 14B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:14b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:30b',
        name: 'Qwen3 30B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 40960,
        match: ['qwen3:30b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:32b',
        name: 'Qwen3 32B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 40960,
        match: ['qwen3:32b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:235b',
        name: 'Qwen3 235B',
        temperature: 0.6,
        maxTokens: 32768,
        contextLength: 40960,
        match: ['qwen3:235b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      // Qwen3编程模型
      {
        id: 'qwen3-coder:30b',
        name: 'Qwen3 Coder 30B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 40960,
        match: ['qwen3-coder:30b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      // Qwen2.5系列
      {
        id: 'qwen2.5:0.5b',
        name: 'Qwen2.5 0.5B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5:0.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:1.5b',
        name: 'Qwen2.5 1.5B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5:1.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:3b',
        name: 'Qwen2.5 3B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5:3b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:7b',
        name: 'Qwen2.5 7B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:14b',
        name: 'Qwen2.5 14B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5:14b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:32b',
        name: 'Qwen2.5 32B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 131072,
        match: ['qwen2.5:32b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5:72b',
        name: 'Qwen2.5 72B',
        temperature: 0.6,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['qwen2.5:72b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Qwen2.5编程模型系列
      {
        id: 'qwen2.5-coder:0.5b',
        name: 'Qwen2.5 Coder 0.5B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5-coder:0.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5-coder:1.5b',
        name: 'Qwen2.5 Coder 1.5B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5-coder:1.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen2.5 Coder 3B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5-coder:3b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5-coder:7b',
        name: 'Qwen2.5 Coder 7B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5-coder:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5-coder:14b',
        name: 'Qwen2.5 Coder 14B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['qwen2.5-coder:14b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2.5-coder:32b',
        name: 'Qwen2.5 Coder 32B',
        temperature: 0.3,
        maxTokens: 16384,
        contextLength: 131072,
        match: ['qwen2.5-coder:32b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Qwen2系列
      {
        id: 'qwen2:0.5b',
        name: 'Qwen2 0.5B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['qwen2:0.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2:1.5b',
        name: 'Qwen2 1.5B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['qwen2:1.5b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2:7b',
        name: 'Qwen2 7B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['qwen2:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen2:72b',
        name: 'Qwen2 72B',
        temperature: 0.6,
        maxTokens: 32768,
        contextLength: 32768,
        match: ['qwen2:72b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Qwen第一代系列
      {
        id: 'qwen:0.5b',
        name: 'Qwen 0.5B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:0.5b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:1.8b',
        name: 'Qwen 1.8B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:1.8b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:4b',
        name: 'Qwen 4B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:4b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:7b',
        name: 'Qwen 7B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:7b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:14b',
        name: 'Qwen 14B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:14b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:32b',
        name: 'Qwen 32B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['qwen:32b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:72b',
        name: 'Qwen 72B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 32768,
        match: ['qwen:72b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'qwen:110b',
        name: 'Qwen 110B',
        temperature: 0.6,
        maxTokens: 16384,
        contextLength: 32768,
        match: ['qwen:110b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // QwQ推理模型
      {
        id: 'qwq:32b',
        name: 'QwQ 32B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 32768,
        match: ['qwq:32b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      // Llama3.3系列
      {
        id: 'llama3.3:70b',
        name: 'Llama 3.3 70B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 131072,
        match: ['llama3.3:70b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Llama3.2系列
      {
        id: 'llama3.2:1b',
        name: 'Llama 3.2 1B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['llama3.2:1b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'llama3.2:3b',
        name: 'Llama 3.2 3B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['llama3.2:3b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Llama3.2视觉模型
      {
        id: 'llama3.2-vision:11b',
        name: 'Llama 3.2 Vision 11B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['llama3.2-vision:11b'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'llama3.2-vision:90b',
        name: 'Llama 3.2 Vision 90B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 131072,
        match: ['llama3.2-vision:90b'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      // Llama3.1系列
      {
        id: 'llama3.1:8b',
        name: 'Llama 3.1 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['llama3.1:8b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'llama3.1:70b',
        name: 'Llama 3.1 70B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 131072,
        match: ['llama3.1:70b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'llama3.1:405b',
        name: 'Llama 3.1 405B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['llama3.1:405b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Llama3系列
      {
        id: 'llama3:8b',
        name: 'Llama 3 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['llama3:8b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'llama3:70b',
        name: 'Llama 3 70B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 8192,
        match: ['llama3:70b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // Llama2系列
      {
        id: 'llama2:7b',
        name: 'Llama 2 7B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 4096,
        match: ['llama2:7b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'llama2:13b',
        name: 'Llama 2 13B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 4096,
        match: ['llama2:13b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'llama2:70b',
        name: 'Llama 2 70B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 4096,
        match: ['llama2:70b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // LLaVA视觉模型系列
      {
        id: 'llava:7b',
        name: 'LLaVA 7B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 4096,
        match: ['llava:7b'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'llava:13b',
        name: 'LLaVA 13B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 4096,
        match: ['llava:13b'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'llava:34b',
        name: 'LLaVA 34B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 4096,
        match: ['llava:34b'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      // LLaVA-Llama3模型
      {
        id: 'llava-llama3:8b',
        name: 'LLaVA Llama3 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['llava-llama3:8b'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      // Mistral系列
      {
        id: 'mistral:7b',
        name: 'Mistral 7B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 32768,
        match: ['mistral:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'mistral-nemo:12b',
        name: 'Mistral Nemo 12B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['mistral-nemo:12b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'mistral-small:22b',
        name: 'Mistral Small 22B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 32768,
        match: ['mistral-small:22b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'mistral-small:24b',
        name: 'Mistral Small 24B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 32768,
        match: ['mistral-small:24b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Phi系列
      {
        id: 'phi3:3.8b',
        name: 'Phi-3 3.8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['phi3:3.8b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'phi3:14b',
        name: 'Phi-3 14B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['phi3:14b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'phi4:14b',
        name: 'Phi-4 14B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['phi4:14b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'phi4-mini-reasoning:3.8b',
        name: 'Phi-4 Mini Reasoning 3.8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['phi4-mini-reasoning:3.8b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      // CodeLlama编程模型系列
      {
        id: 'codellama:7b',
        name: 'Code Llama 7B',
        temperature: 0.1,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['codellama:7b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'codellama:13b',
        name: 'Code Llama 13B',
        temperature: 0.1,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['codellama:13b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'codellama:34b',
        name: 'Code Llama 34B',
        temperature: 0.1,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['codellama:34b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'codellama:70b',
        name: 'Code Llama 70B',
        temperature: 0.1,
        maxTokens: 16384,
        contextLength: 16384,
        match: ['codellama:70b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // MiniCPM视觉模型
      {
        id: 'minicpm-v:8b',
        name: 'MiniCPM-V 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['minicpm-v:8b'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      // TinyLlama轻量模型
      {
        id: 'tinyllama:1.1b',
        name: 'TinyLlama 1.1B',
        temperature: 0.7,
        maxTokens: 2048,
        contextLength: 2048,
        match: ['tinyllama:1.1b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // SmolLM2轻量模型系列
      {
        id: 'smollm2:135m',
        name: 'SmolLM2 135M',
        temperature: 0.7,
        maxTokens: 2048,
        contextLength: 8192,
        match: ['smollm2:135m'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'smollm2:360m',
        name: 'SmolLM2 360M',
        temperature: 0.7,
        maxTokens: 2048,
        contextLength: 8192,
        match: ['smollm2:360m'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'smollm2:1.7b',
        name: 'SmolLM2 1.7B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 8192,
        match: ['smollm2:1.7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Tulu3指令模型
      {
        id: 'tulu3:8b',
        name: 'Tulu3 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['tulu3:8b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'tulu3:70b',
        name: 'Tulu3 70B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 8192,
        match: ['tulu3:70b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // OLMo2开源模型
      {
        id: 'olmo2:7b',
        name: 'OLMo2 7B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['olmo2:7b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'olmo2:13b',
        name: 'OLMo2 13B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['olmo2:13b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // Solar Pro模型
      {
        id: 'solar-pro:22b',
        name: 'Solar Pro 22B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 16384,
        match: ['solar-pro:22b', 'solar-pro'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Dolphin指令模型
      {
        id: 'dolphin3:8b',
        name: 'Dolphin3 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['dolphin3:8b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Command R模型系列
      {
        id: 'command-r7b:7b',
        name: 'Command R7B 7B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['command-r7b:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'command-r7b-arabic:7b',
        name: 'Command R7B Arabic 7B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 131072,
        match: ['command-r7b-arabic:7b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'command-a:111b',
        name: 'Command A 111B',
        temperature: 0.7,
        maxTokens: 32768,
        contextLength: 131072,
        match: ['command-a:111b'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      // Magicoder编程模型
      {
        id: 'magicoder:7b',
        name: 'Magicoder 7B',
        temperature: 0.1,
        maxTokens: 8192,
        contextLength: 16384,
        match: ['magicoder:7b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // Mathstral数学模型
      {
        id: 'mathstral:7b',
        name: 'Mathstral 7B',
        temperature: 0.3,
        maxTokens: 8192,
        contextLength: 32768,
        match: ['mathstral:7b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      // Falcon2模型
      {
        id: 'falcon2:11b',
        name: 'Falcon2 11B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['falcon2:11b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // StableLM模型
      {
        id: 'stablelm-zephyr:3b',
        name: 'StableLM Zephyr 3B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 4096,
        match: ['stablelm-zephyr:3b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // Granite Guardian安全模型
      {
        id: 'granite3-guardian:2b',
        name: 'Granite3 Guardian 2B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 8192,
        match: ['granite3-guardian:2b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'granite3-guardian:8b',
        name: 'Granite3 Guardian 8B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['granite3-guardian:8b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // ShieldGemma安全模型
      {
        id: 'shieldgemma:2b',
        name: 'ShieldGemma 2B',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 8192,
        match: ['shieldgemma:2b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'shieldgemma:9b',
        name: 'ShieldGemma 9B',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 8192,
        match: ['shieldgemma:9b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'shieldgemma:27b',
        name: 'ShieldGemma 27B',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 8192,
        match: ['shieldgemma:27b'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      // 嵌入模型
      {
        id: 'nomic-embed-text:335m',
        name: 'Nomic Embed Text 335M',
        temperature: 0.0,
        maxTokens: 512,
        contextLength: 8192,
        match: ['nomic-embed-text:335m', 'nomic-embed-text'],
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Embedding
      },
      {
        id: 'mxbai-embed-large:335m',
        name: 'MxBai Embed Large 335M',
        temperature: 0.0,
        maxTokens: 512,
        contextLength: 8192,
        match: ['mxbai-embed-large:335m', 'mxbai-embed-large'],
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Embedding
      },
      {
        id: 'bge-m3:567m',
        name: 'BGE-M3 567M',
        temperature: 0.0,
        maxTokens: 512,
        contextLength: 8192,
        match: ['bge-m3:567m', 'bge-m3'],
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Embedding
      }
    ]
  },

  // 七牛云提供商特定模型配置
  qiniu: {
    models: []
  },

  // SiliconFlow提供商特定模型配置
  silicon: {
    models: [
      {
        id: 'Qwen/Qwen3-235B-A22B',
        name: 'Qwen/Qwen3-235B-A22B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 100_000,
        match: ['qwen3-235b-a22b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'Qwen/Qwen3-30B-A3B',
        name: 'Qwen/Qwen3-30B-A3B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 100_000,
        match: ['qwen3-30b-a3b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'Qwen/Qwen3-32B',
        name: 'Qwen/Qwen3-32B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 100_000,
        match: ['qwen3-32b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'Qwen/Qwen3-14B',
        name: 'Qwen/Qwen3-14B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 100_000,
        match: ['qwen3-14b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'Qwen/Qwen3-8B',
        name: 'Qwen/Qwen3-8B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 100_000,
        match: ['qwen3-8b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'Pro/deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3 Pro',
        temperature: 0.6,
        maxTokens: 7000,
        contextLength: 62000,
        match: ['pro/deepseek-ai/deepseek-v3'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'Pro/deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1 Pro',
        temperature: 0.6,
        maxTokens: 7000,
        contextLength: 62000,
        match: ['pro/deepseek-ai/deepseek-r1'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3',
        temperature: 0.6,
        maxTokens: 7000,
        contextLength: 62000,
        match: ['deepseek-ai/deepseek-v3'],
        vision: false,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'deepseek-ai/DeepSeek-R1',
        name: 'DeepSeek R1',
        temperature: 0.6,
        maxTokens: 7000,
        contextLength: 62000,
        match: ['deepseek-ai/deepseek-r1'],
        vision: false,
        functionCall: false,
        reasoning: true
      }
    ]
  },

  // Fireworks提供商特定模型配置
  fireworks: {
    models: []
  },

  // PPIO提供商特定模型配置
  ppio: {
    models: [
      {
        id: 'minimaxai/minimax-m1-80k',
        name: 'Minimax M1 80K',
        temperature: 0.6,
        maxTokens: 40_000,
        contextLength: 128000,
        match: ['minimaxai/minimax-m1-80k'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-0528',
        name: 'DeepSeek R1 0528',
        temperature: 1,
        maxTokens: 16000,
        contextLength: 128000,
        match: ['deepseek-r1-0528'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-v3-0324',
        name: 'DeepSeek Chat v3 0324',
        temperature: 0.6,
        maxTokens: 16000,
        contextLength: 128000,
        match: ['deepseek-chat-v3-0324'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'deepseek/deepseek-r1-distill-qwen-32b',
        name: 'DeepSeek R1 Distill Qwen 32B',
        temperature: 0.7,
        maxTokens: 8000,
        contextLength: 64000,
        match: ['deepseek-r1-distill-qwen-32b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-distill-llama-70b',
        name: 'DeepSeek R1 Distill Llama 70B',
        temperature: 0.6,
        maxTokens: 8000,
        contextLength: 32000,
        match: ['deepseek-r1-distill-llama-70b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-distill-qwen-14b',
        name: 'DeepSeek R1 Distill Qwen 14B',
        temperature: 0.7,
        maxTokens: 8000,
        contextLength: 64000,
        match: ['deepseek-r1-distill-qwen-14b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-0528-qwen3-8b',
        name: 'DeepSeek R1 0528',
        temperature: 1,
        maxTokens: 32000,
        contextLength: 128000,
        match: ['deepseek-r1-0528-qwen3-8b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-distill-llama-8b',
        name: 'DeepSeek R1 Distill Llama 8B',
        temperature: 0.6,
        maxTokens: 8000,
        contextLength: 32000,
        match: ['deepseek-r1-distill-llama-8b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-prover-v2-671b',
        name: 'Deepseek Prover V2 671B',
        temperature: 0.3,
        maxTokens: 160000,
        contextLength: 160000,
        match: ['deepseek-prover-v2-671b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-r1-turbo',
        name: 'DeepSeek R1 Turbo',
        temperature: 0.6,
        maxTokens: 16000,
        contextLength: 64000,
        match: ['deepseek-r1-turbo'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'deepseek/deepseek-v3-turbo',
        name: 'DeepSeek V3 Turbo',
        temperature: 0.6,
        maxTokens: 16000,
        contextLength: 64000,
        match: ['deepseek-v3-turbo'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'deepseek/deepseek-v3/community',
        name: 'DeepSeek V3 Community',
        temperature: 0.6,
        maxTokens: 4000,
        contextLength: 64000,
        match: ['deepseek-v3/community'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'deepseek/deepseek-r1/community',
        name: 'DeepSeek R1 Community',
        temperature: 0.6,
        maxTokens: 4000,
        contextLength: 64000,
        match: ['deepseek-r1/community'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen/qwen3-235b-a22b-fp8',
        name: 'Qwen/Qwen3-235B-A22B',
        temperature: 0.6,
        maxTokens: 20000,
        contextLength: 40960,
        match: ['qwen3-235b-a22b-fp8', 'qwen3-235b-a22b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'qwen/qwen3-30b-a3b-fp8',
        name: 'Qwen/Qwen3-30B-A3B',
        temperature: 0.6,
        maxTokens: 20000,
        contextLength: 128000,
        match: ['qwen3-30b-a3b-fp8', 'qwen3-30b-a3b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'qwen/qwen3-32b-fp8',
        name: 'Qwen/Qwen3-32B',
        temperature: 0.6,
        maxTokens: 20000,
        contextLength: 128000,
        match: ['qwen3-32b-fp8', 'qwen3-32b'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B Instruct',
        temperature: 0.6,
        maxTokens: 8000,
        contextLength: 131072,
        match: ['llama-3.3-70b-instruct'],
        vision: false,
        functionCall: false,
        reasoning: true
      }
    ]
  },

  // GitHub提供商特定模型配置
  github: {
    models: []
  },

  // GitHub Copilot提供商特定模型配置
  'github-copilot': {
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        temperature: 0.7,
        maxTokens: 4096,
        contextLength: 128000,
        match: ['gpt-4o'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        temperature: 0.7,
        maxTokens: 16384,
        contextLength: 128000,
        match: ['gpt-4o-mini'],
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        temperature: 1.0,
        maxTokens: 32768,
        contextLength: 128000,
        match: ['o1-preview'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'o1-mini',
        name: 'o1 Mini',
        temperature: 1.0,
        maxTokens: 65536,
        contextLength: 128000,
        match: ['o1-mini'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        temperature: 0.7,
        maxTokens: 8192,
        contextLength: 200000,
        match: ['claude-3-5-sonnet'],
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]
  },

  // 阿里云提供商特定模型配置, 注意匹配排序，only max/plus/turbo
  dashscope: {
    models: [
      {
        id: 'qwen-turbo-latest',
        name: 'Qwen Turbo Latest',
        temperature: 0.7,
        contextLength: 1000000,
        maxTokens: 16384,
        match: ['qwen-turbo-latest'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo-2024-11-01',
        name: 'Qwen Turbo 2024 11 01',
        temperature: 0.7,
        contextLength: 1000000,
        maxTokens: 8192,
        match: ['qwen-turbo-1101'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo-2024-09-19',
        name: 'Qwen Turbo 2024 09 19',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-turbo-0919'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo-2024-06-24',
        name: 'Qwen Turbo 2024 06 24',
        temperature: 0.7,
        contextLength: 8000,
        maxTokens: 2000,
        match: ['qwen-turbo-0624'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo-2025-04-28',
        name: 'Qwen Turbo 2025 04 28',
        temperature: 0.7,
        contextLength: 1000000,
        maxTokens: 16384,
        match: ['qwen-turbo-0428'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo-2025-02-11',
        name: 'Qwen Turbo 2025 02 11',
        temperature: 0.7,
        contextLength: 1000000,
        maxTokens: 8192,
        match: ['qwen-turbo-0211'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-turbo',
        name: 'Qwen Turbo',
        temperature: 0.7,
        contextLength: 1000000,
        maxTokens: 8192,
        match: ['qwen-turbo'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-latest',
        name: 'Qwen Plus Latest',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 16384,
        match: ['qwen-plus-latest'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-12-20',
        name: 'Qwen Plus 2024 12 20',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-1220'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-11-27',
        name: 'Qwen Plus 2024 11 27',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-1127'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-11-25',
        name: 'Qwen Plus 2024 11 25',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-1125'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-09-19',
        name: 'Qwen Plus 2024 09 19',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-0919'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-08-06',
        name: 'Qwen Plus 2024 08 06',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-0806'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2024-07-23',
        name: 'Qwen Plus 2024 07 23',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 8000,
        match: ['qwen-plus-0723'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2025-04-28',
        name: 'Qwen Plus 2025 04 28',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 16384,
        match: ['qwen-plus-0428'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2025-01-25',
        name: 'Qwen Plus 2025 01 25',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-0125'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus-2025-01-12',
        name: 'Qwen Plus 2025 01 12',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus-0112'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-plus'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max-latest',
        name: 'Qwen Max Latest',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-max-latest'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max-2024-09-19',
        name: 'Qwen Max 2024 09 19',
        temperature: 0.7,
        contextLength: 32768,
        maxTokens: 8192,
        match: ['qwen-max-0919'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max-2024-04-28',
        name: 'Qwen Max 2024 04 28',
        temperature: 0.7,
        contextLength: 8000,
        maxTokens: 2000,
        match: ['qwen-max-0428'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max-2024-04-03',
        name: 'Qwen Max 2024 04 03',
        temperature: 0.7,
        contextLength: 8000,
        maxTokens: 2000,
        match: ['qwen-max-0403'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max-2025-01-25',
        name: 'Qwen Max 2025 01 25',
        temperature: 0.7,
        contextLength: 131072,
        maxTokens: 8192,
        match: ['qwen-max-0125'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        temperature: 0.7,
        contextLength: 32768,
        maxTokens: 8192,
        match: ['qwen-max'],
        vision: false,
        functionCall: true,
        reasoning: false
      }
    ]
  },
  aihubmix: {
    models: [
      {
        id: 'deepseek-ai/DeepSeek-R1-0528',
        name: 'DeepSeek R1-0528',
        temperature: 0.6,
        maxTokens: 65536,
        contextLength: 131072,
        match: ['deepseek-ai/DeepSeek-R1-0528'],
        vision: false,
        functionCall: false,
        reasoning: true
      },

      {
        id: 'deepseek-ai/DeepSeek-V3-0324',
        name: 'DeepSeek v3-0324',
        temperature: 0.6,
        maxTokens: 65536,
        contextLength: 131072,
        match: ['deepseek-ai/DeepSeek-V3-0324'],
        vision: false,
        functionCall: false,
        reasoning: false
      }
    ]
  },
  // OpenRouter提供商特定模型配置
  openrouter: {
    models: [
      {
        id: 'deepseek-r1-0528:free',
        name: 'DeepSeek R1-0528:free',
        temperature: 0.6,
        maxTokens: 65536,
        contextLength: 131072,
        match: ['deepseek/deepseek-r1-0528:free', 'deepseek/deepseek-r1-0528-qwen3-8b:free'],
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        //对fc支持有问题，避免使用
        id: 'deepseek-chat-v3-0324:free',
        name: 'DeepSeek v3-0324:free',
        temperature: 0.6,
        maxTokens: 65536,
        contextLength: 131072,
        match: ['deepseek/deepseek-chat-v3-0324:free', 'deepseek/deepseek-chat:free'],
        vision: false,
        functionCall: false,
        reasoning: false
      }
    ]
  },

  // Grok提供商特定模型配置
  grok: {
    models: [
      {
        id: 'grok-3-mini-fast-beta',
        name: 'Grok 3 Mini Fast Beta',
        temperature: 1,
        contextLength: 120000,
        maxTokens: 100_000,
        match: ['grok-3-mini-fast', 'grok-3-mini-fast-latest', 'grok-3-mini-fast-beta'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'grok-3-mini-beta',
        name: 'Grok 3 Mini Beta',
        temperature: 1,
        contextLength: 120000,
        maxTokens: 100_000,
        match: ['grok-3-mini', 'grok-3-mini-latest', 'grok-3-mini-beta'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'grok-3-fast-beta',
        name: 'Grok 3 Fast Beta',
        temperature: 0.7,
        contextLength: 120000,
        maxTokens: 100_000,
        match: ['grok-3-fast', 'grok-3-fast-latest', 'grok-3-fast-beta'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'grok-2-vision-1212',
        name: 'Grok 2 Vision 1212',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 32000,
        match: ['grok-2-vision', 'grok-2-vision-latest', 'grok-2-vision-1212'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'grok-2-image-1212',
        name: 'Grok 2 Image 1212',
        temperature: 0.7,
        contextLength: 130_000,
        maxTokens: 100_000,
        match: ['grok-2-image', 'grok-2-image-latest', 'grok-2-image-1212'],
        vision: true,
        functionCall: false,
        reasoning: false
      },
      {
        id: 'grok-3-beta',
        name: 'Grok 3 Beta',
        temperature: 0.7,
        contextLength: 120000,
        maxTokens: 100_000,
        match: ['grok-3', 'grok-3-latest', 'grok-3-beta'],
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'grok-2-1212',
        name: 'Grok 2 1212',
        contextLength: 120000,
        temperature: 0.7,
        maxTokens: 100_000,
        match: ['grok-2', 'grok-2-latest', 'grok-2-1212'],
        vision: false,
        functionCall: true,
        reasoning: false
      }
    ]
  },

  // Azure OpenAI提供商特定模型配置
  'azure-openai': {
    models: []
  },

  // LM Studio提供商特定模型配置
  lmstudio: {
    models: []
  }
}

/**
 * 根据提供商ID和模型ID获取特定提供商的模型配置
 * @param providerId 提供商ID
 * @param modelId 模型ID
 * @returns ModelConfig | undefined 如果找到配置则返回，否则返回undefined
 */
export function getProviderSpecificModelConfig(
  providerId: string,
  modelId: string
): ModelConfig | undefined {
  // 将modelId转为小写以进行不区分大小写的匹配
  const lowerModelId = modelId.toLowerCase()

  // 检查该提供商是否存在特定配置
  const providerSetting = providerModelSettings[providerId]
  if (!providerSetting || !providerSetting.models) {
    return undefined
  }

  // 遍历该提供商的模型数组，查找匹配的模型配置
  for (const config of providerSetting.models) {
    // 检查是否有任何匹配条件符合
    if (config.match.some((matchStr) => lowerModelId.includes(matchStr.toLowerCase()))) {
      return {
        maxTokens: config.maxTokens,
        contextLength: config.contextLength,
        temperature: config.temperature, // 保持可选，某些模型不支持
        vision: config.vision || false,
        functionCall: config.functionCall || false,
        reasoning: config.reasoning || false,
        type: config.type || ModelType.Chat,
        reasoningEffort: config.reasoningEffort,
        verbosity: config.verbosity,
        maxCompletionTokens: config.maxCompletionTokens
      }
    }
  }

  // 如果没有找到匹配的配置，返回undefined
  return undefined
}
