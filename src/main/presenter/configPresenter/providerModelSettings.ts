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
}

// 为每个提供商创建映射对象，使用models数组包装模型配置
export const providerModelSettings: Record<string, { models: ProviderModelSetting[] }> = {
  // OpenAI提供商特定模型配置
  openai: {
    models: []
  },

  // 火山引擎(Doubao)提供商特定模型配置
  doubao: {
    models: []
  },

  // Anthropic提供商特定模型配置
  anthropic: {
    models: [
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
    models: []
  },

  // Moonshot提供商特定模型配置
  moonshot: {
    models: []
  },

  // Ollama提供商特定模型配置
  ollama: {
    models: [
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
        id: 'qwen3:32b',
        name: 'Qwen3 32B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:32b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:30b-a3b',
        name: 'Qwen3 30B A3B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:30b-a3b'],
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'qwen3:235b-a22b',
        name: 'Qwen3 235B A22B',
        temperature: 0.6,
        maxTokens: 8192,
        contextLength: 40960,
        match: ['qwen3:235b-a22b'],
        vision: false,
        functionCall: true,
        reasoning: true
      }
    ]
  },

  // 七牛云提供商特定模型配置
  qiniu: {
    models: []
  },

  // Silicon Flow提供商特定模型配置
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
        functionCall: true,
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
        functionCall: true,
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
        temperature: config.temperature || 0.7,
        vision: config.vision || false,
        functionCall: config.functionCall || false,
        reasoning: config.reasoning || false,
        type: config.type || ModelType.Chat
      }
    }
  }

  // 如果没有找到匹配的配置，返回undefined
  return undefined
}
