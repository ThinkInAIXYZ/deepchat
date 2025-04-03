import { LLM_PROVIDER_BASE } from '@shared/presenter'

export const DEFAULT_PROVIDERS: LLM_PROVIDER_BASE[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    apiType: 'ollama',
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    enable: false,
    websites: {
      official: 'https://ollama.com/',
      apiKey: '',
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library',
      defaultBaseUrl: 'http://localhost:11434'
    }
  },
  {
    id: 'deepseek',
    name: 'Deepseek',
    apiType: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    enable: false,
    websites: {
      official: 'https://deepseek.com/',
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/api-docs/',
      models: 'https://platform.deepseek.com/api-docs/',
      defaultBaseUrl: 'https://api.deepseek.com/v1'
    }
  },
  {
    id: 'silicon',
    name: 'Silicon',
    apiType: 'silicon',
    apiKey: '',
    baseUrl: 'https://api.siliconflow.cn/v1',
    enable: false,
    websites: {
      official: 'https://www.siliconflow.cn/',
      apiKey: 'https://cloud.siliconflow.cn/account/ak?referrer=clxty1xuy0014lvqwh5z50i88',
      docs: 'https://docs.siliconflow.cn/',
      models: 'https://docs.siliconflow.cn/docs/model-names',
      defaultBaseUrl: 'https://api.siliconflow.cn/v1'
    }
  },
  {
    id: 'qwenlm',
    name: 'QwenLM',
    apiType: 'qwenlm',
    apiKey: '',
    baseUrl: 'https://chat.qwenlm.ai/api',
    enable: false,
    websites: {
      official: 'https://chat.qwenlm.ai',
      apiKey: 'https://chat.qwenlm.ai',
      docs: 'https://chat.qwenlm.ai',
      models: 'https://chat.qwenlm.ai',
      defaultBaseUrl: 'https://chat.qwenlm.ai/api'
    }
  },
  {
    id: 'doubao',
    name: 'Doubao',
    apiType: 'doubao',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    enable: false,
    websites: {
      official: 'https://console.volcengine.com/ark/',
      apiKey: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
      docs: 'https://www.volcengine.com/docs/82379/1182403',
      models: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint',
      defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
    }
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiType: 'minimax',
    apiKey: '',
    baseUrl: 'https://api.minimax.chat/v1',
    enable: false,
    websites: {
      official: 'https://platform.minimaxi.com/',
      apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docs: 'https://platform.minimaxi.com/document/Announcement',
      models: 'https://platform.minimaxi.com/document/Models',
      defaultBaseUrl: 'https://api.minimax.chat/v1'
    }
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    apiType: 'fireworks',
    apiKey: '',
    baseUrl: 'https://api.fireworks.ai/inference',
    enable: false,
    websites: {
      official: 'https://fireworks.ai/',
      apiKey: 'https://fireworks.ai/account/api-keys',
      docs: 'https://docs.fireworks.ai/getting-started/introduction',
      models: 'https://fireworks.ai/dashboard/models',
      defaultBaseUrl: 'https://api.fireworks.ai/inference'
    }
  },
  {
    id: 'ppio',
    name: 'PPIO',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.ppinfra.com/v3/openai',
    enable: false,
    websites: {
      official: 'https://ppinfra.com/',
      apiKey: 'https://ppinfra.com/settings/key-management',
      docs: 'https://ppinfra.com/docs/get-started/quickstart.html',
      models: 'https://ppinfra.com/model-api/console',
      defaultBaseUrl: 'https://api.ppinfra.com/v3/openai'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    enable: false,
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models',
      defaultBaseUrl: 'https://api.openai.com/v1'
    }
  },
  {
    id: 'gemini',
    name: 'Gemini',
    apiType: 'gemini',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    enable: false,
    websites: {
      official: 'https://gemini.google.com/',
      apiKey: 'https://aistudio.google.com/app/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      models: 'https://ai.google.dev/gemini-api/docs/models/gemini',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com'
    }
  },

  // {
  //   id: 'ocoolai',
  //   name: 'OCoolAI',
  //   apiType: 'ocoolai',
  //   apiKey: '',
  //   baseUrl: 'https://api.ocoolai.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://one.ocoolai.com/',
  //     apiKey: 'https://one.ocoolai.com/token',
  //     docs: 'https://docs.ooo.cool/',
  //     models: 'https://docs.ooo.cool/guides/jiage/',
  //     defaultBaseUrl: 'https://api.ocoolai.com'
  //   }
  // },
  // {
  //   id: 'together',
  //   name: 'Together',
  //   apiType: 'together',
  //   apiKey: '',
  //   baseUrl: 'https://api.tohgether.xyz',
  //   enable: false,
  //   websites: {
  //     official: 'https://www.together.ai/',
  //     apiKey: 'https://api.together.ai/settings/api-keys',
  //     docs: 'https://docs.together.ai/docs/introduction',
  //     models: 'https://docs.together.ai/docs/chat-models',
  //     defaultBaseUrl: 'https://api.tohgether.xyz'
  //   }
  // },
  {
    id: 'github',
    name: 'GitHub Models',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://models.inference.ai.azure.com',
    enable: false,
    websites: {
      official: 'https://github.com/marketplace/models',
      apiKey: 'https://github.com/settings/tokens',
      docs: 'https://docs.github.com/en/github-models',
      models: 'https://github.com/marketplace/models',
      defaultBaseUrl: 'https://models.inference.ai.azure.com'
    }
  },
  // {
  //   id: 'yi',
  //   name: 'Yi',
  //   apiType: 'yi',
  //   apiKey: '',
  //   baseUrl: 'https://api.lingyiwanwu.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://platform.lingyiwanwu.com/',
  //     apiKey: 'https://platform.lingyiwanwu.com/apikeys',
  //     docs: 'https://platform.lingyiwanwu.com/docs',
  //     models: 'https://platform.lingyiwanwu.com/docs#%E6%A8%A1%E5%9E%8B',
  //     defaultBaseUrl: 'https://api.lingyiwanwu.com'
  //   }
  // },
  // {
  //   id: 'zhipu',
  //   name: 'Zhipu',
  //   apiType: 'zhipu',
  //   apiKey: '',
  //   baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
  //   enable: false,
  //   websites: {
  //     official: 'https://open.bigmodel.cn/',
  //     apiKey: 'https://open.bigmodel.cn/usercenter/apikeys',
  //     docs: 'https://open.bigmodel.cn/dev/howuse/introduction',
  //     models: 'https://open.bigmodel.cn/modelcenter/square',
  //     defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/'
  //   }
  // },
  {
    id: 'moonshot',
    name: 'Moonshot',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    enable: false,
    websites: {
      official: 'https://moonshot.ai/',
      apiKey: 'https://platform.moonshot.cn/console/api-keys',
      docs: 'https://platform.moonshot.cn/docs/',
      models: 'https://platform.moonshot.cn/docs/intro#%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8',
      defaultBaseUrl: 'https://api.moonshot.cn/v1'
    }
  },
  // {
  //   id: 'baichuan',
  //   name: 'Baichuan',
  //   apiType: 'baichuan',
  //   apiKey: '',
  //   baseUrl: 'https://api.baichuan-ai.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://www.baichuan-ai.com/',
  //     apiKey: 'https://platform.baichuan-ai.com/console/apikey',
  //     docs: 'https://platform.baichuan-ai.com/docs',
  //     models: 'https://platform.baichuan-ai.com/price',
  //     defaultBaseUrl: 'https://api.baichuan-ai.com'
  //   }
  // },
  // {
  //   id: 'dashscope',
  //   name: 'DashScope',
  //   apiType: 'dashscope',
  //   apiKey: '',
  //   baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
  //   enable: false,
  //   websites: {
  //     official: 'https://www.aliyun.com/product/bailian',
  //     apiKey: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
  //     docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
  //     models: 'https://bailian.console.aliyun.com/model-market#/model-market',
  //     defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
  //   }
  // },
  // {
  //   id: 'stepfun',
  //   name: 'StepFun',
  //   apiType: 'stepfun',
  //   apiKey: '',
  //   baseUrl: 'https://api.stepfun.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://platform.stepfun.com/',
  //     apiKey: 'https://platform.stepfun.com/interface-key',
  //     docs: 'https://platform.stepfun.com/docs/overview/concept',
  //     models: 'https://platform.stepfun.com/docs/llm/text',
  //     defaultBaseUrl: 'https://api.stepfun.com'
  //   }
  // }

  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1/',
    enable: false,
    websites: {
      official: 'https://openrouter.ai/',
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/docs/models',
      defaultBaseUrl: 'https://openrouter.ai/api/v1/'
    }
  },
  // {
  //   id: 'groq',
  //   name: 'Groq',
  //   apiType: 'groq',
  //   apiKey: '',
  //   baseUrl: 'https://api.groq.com/openai',
  //   enable: false,
  //   websites: {
  //     official: 'https://groq.com/',
  //     apiKey: 'https://console.groq.com/keys',
  //     docs: 'https://console.groq.com/docs/quickstart',
  //     models: 'https://console.groq.com/docs/models',
  //     defaultBaseUrl: 'https://api.groq.com/openai'
  //   }
  // },

  {
    id: 'anthropic',
    name: 'Anthropic',
    apiType: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    enable: false,
    websites: {
      official: 'https://www.anthropic.com/',
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/',
      models: 'https://docs.anthropic.com/claude/docs/models-overview',
      defaultBaseUrl: 'https://api.anthropic.com'
    }
  },
  // {
  //   id: 'grok',
  //   name: 'Grok',
  //   apiType: 'grok',
  //   apiKey: '',
  //   baseUrl: 'https://api.x.ai',
  //   enable: false,
  //   websites: {
  //     official: 'https://x.ai/',
  //     apiKey: '',
  //     docs: 'https://docs.x.ai/',
  //     models: 'https://docs.x.ai/docs#getting-started',
  //     defaultBaseUrl: 'https://api.x.ai'
  //   }
  // },
  // {
  //   id: 'hyperbolic',
  //   name: 'Hyperbolic',
  //   apiType: 'hyperbolic',
  //   apiKey: '',
  //   baseUrl: 'https://api.hyperbolic.xyz',
  //   enable: false,
  //   websites: {
  //     official: 'https://app.hyperbolic.xyz',
  //     apiKey: 'https://app.hyperbolic.xyz/settings',
  //     docs: 'https://docs.hyperbolic.xyz',
  //     models: 'https://app.hyperbolic.xyz/models',
  //     defaultBaseUrl: 'https://api.hyperbolic.xyz'
  //   }
  // },
  // {
  //   id: 'mistral',
  //   name: 'Mistral',
  //   apiType: 'mistral',
  //   apiKey: '',
  //   baseUrl: 'https://api.mistral.ai',
  //   enable: false,
  //   websites: {
  //     official: 'https://mistral.ai',
  //     apiKey: 'https://console.mistral.ai/api-keys/',
  //     docs: 'https://docs.mistral.ai',
  //     models: 'https://docs.mistral.ai/getting-started/models/models_overview',
  //     defaultBaseUrl: 'https://api.mistral.ai'
  //   }
  // },
  // {
  //   id: 'jina',
  //   name: 'Jina',
  //   apiType: 'jina',
  //   apiKey: '',
  //   baseUrl: 'https://api.jina.ai',
  //   enable: false,
  //   websites: {
  //     official: 'https://jina.ai',
  //     apiKey: 'https://jina.ai/',
  //     docs: 'https://jina.ai',
  //     models: 'https://jina.ai',
  //     defaultBaseUrl: 'https://api.jina.ai'
  //   }
  // },
  // {
  //   id: 'aihubmix',
  //   name: 'AIHubMix',
  //   apiType: 'aihubmix',
  //   apiKey: '',
  //   baseUrl: 'https://aihubmix.com?aff=SJyh',
  //   enable: false,
  //   websites: {
  //     official: 'https://aihubmix.com?aff=SJyh',
  //     apiKey: 'https://aihubmix.com?aff=SJyh',
  //     docs: 'https://doc.aihubmix.com/',
  //     models: 'https://aihubmix.com/models',
  //     defaultBaseUrl: 'https://aihubmix.com?aff=SJyh'
  //   }
  // },
  // {
  //   id: 'fireworks',
  //   name: 'Fireworks',
  //   apiType: 'fireworks',
  //   apiKey: '',
  //   baseUrl: 'https://api.fireworks.ai/inference',
  //   enable: false,
  //   websites: {
  //     official: 'https://fireworks.ai/',
  //     apiKey: 'https://fireworks.ai/account/api-keys',
  //     docs: 'https://docs.fireworks.ai/getting-started/introduction',
  //     models: 'https://fireworks.ai/dashboard/models',
  //     defaultBaseUrl: 'https://api.fireworks.ai/inference'
  //   }
  // },
  // {
  //   id: 'zhinao',
  //   name: 'Zhinao',
  //   apiType: 'zhinao',
  //   apiKey: '',
  //   baseUrl: 'https://api.360.cn',
  //   enable: false,
  //   websites: {
  //     official: 'https://ai.360.com/',
  //     apiKey: 'https://ai.360.com/platform/keys',
  //     docs: 'https://ai.360.com/platform/docs/overview',
  //     models: 'https://ai.360.com/platform/limit',
  //     defaultBaseUrl: 'https://api.360.cn'
  //   }
  // },
  // {
  //   id: 'hunyuan',
  //   name: 'Hunyuan',
  //   apiType: 'hunyuan',
  //   apiKey: '',
  //   baseUrl: 'https://api.hunyuan.cloud.tencent.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://cloud.tencent.com/product/hunyuan',
  //     apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
  //     docs: 'https://cloud.tencent.com/document/product/1729/111007',
  //     models: 'https://cloud.tencent.com/document/product/1729/104753',
  //     defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com'
  //   }
  // },
  // {
  //   id: 'nvidia',
  //   name: 'NVIDIA',
  //   apiType: 'nvidia',
  //   apiKey: '',
  //   baseUrl: 'https://integrate.api.nvidia.com',
  //   enable: false,
  //   websites: {
  //     official: 'https://build.nvidia.com/explore/discover',
  //     apiKey: 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
  //     docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
  //     models: 'https://build.nvidia.com/nim',
  //     defaultBaseUrl: 'https://integrate.api.nvidia.com'
  //   }
  // },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    apiType: 'openai',
    apiKey: '',
    baseUrl: '',
    enable: false,
    websites: {
      official: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
      apiKey:
        'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
      docs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
      models: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models',
      defaultBaseUrl:
        'https://your-resource-name.openai.azure.com/openai/deployments/your-deployment-name'
    }
  }
]
