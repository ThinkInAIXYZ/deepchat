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
    id: 'qiniu',
    name: 'Qiniu',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.qnaigc.com/v1',
    enable: false,
    websites: {
      official: 'https://www.qiniu.com',
      apiKey: 'https://developer.qiniu.com/aitokenapi/12884/how-to-get-api-key',
      docs: 'https://developer.qiniu.com/aitokenapi',
      models: 'https://developer.qiniu.com/aitokenapi/12883/model-list',
      defaultBaseUrl: 'https://api.qnaigc.com/v1'
    }
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    apiType: 'silicon',
    apiKey: '',
    baseUrl: 'https://api.siliconflow.cn/v1',
    enable: false,
    websites: {
      official: 'https://www.siliconflow.cn/',
      apiKey: 'https://cloud.siliconflow.cn/account/ak',
      docs: 'https://docs.siliconflow.cn/',
      models: 'https://docs.siliconflow.cn/docs/model-names',
      defaultBaseUrl: 'https://api.siliconflow.cn/v1'
    }
  },
  // {
  //   id: 'qwenlm',
  //   name: 'QwenLM',
  //   apiType: 'qwenlm',
  //   apiKey: '',
  //   baseUrl: 'https://chat.qwenlm.ai/api',
  //   enable: false,
  //   websites: {
  //     official: 'https://chat.qwenlm.ai',
  //     apiKey: 'https://chat.qwenlm.ai',
  //     docs: 'https://chat.qwenlm.ai',
  //     models: 'https://chat.qwenlm.ai',
  //     defaultBaseUrl: 'https://chat.qwenlm.ai/api'
  //   }
  // },

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
    id: 'tokenflux',
    name: 'TokenFlux',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://tokenflux.ai/v1',
    enable: false,
    websites: {
      official: 'https://tokenflux.ai/',
      apiKey: 'https://tokenflux.ai/dashboard/api-keys',
      docs: 'https://docs.tokenflux.ai/',
      models: 'https://docs.tokenflux.ai/api-reference',
      defaultBaseUrl: 'https://tokenflux.ai/v1'
    }
  },

  {
    id: 'openai-responses',
    name: 'OpenAI Responses',
    apiType: 'openai-responses',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    enable: false,
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs/api-reference/responses',
      models: 'https://platform.openai.com/docs/models',
      defaultBaseUrl: 'https://api.openai.com/v1'
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
  {
    id: '302ai',
    name: '302.AI',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.302.ai/v1',
    enable: false,
    websites: {
      official: 'https://302.ai',
      apiKey: 'https://dash.302.ai/apis/list',
      docs: 'https://302ai.apifox.cn/doc-3704971',
      models: 'https://302.ai/pricing/',
      defaultBaseUrl: 'https://api.302.ai/v1'
    }
  },
  {
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    apiType: 'vercel-ai-gateway',
    apiKey: '',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    enable: false,
    websites: {
      official: 'https://vercel.com/ai',
      apiKey: 'https://vercel.com/dashboard',
      docs: 'https://vercel.com/docs/ai-gateway',
      models: 'https://vercel.com/docs/ai-gateway/models-and-providers',
      defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1'
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
  {
    id: 'together',
    name: 'Together',
    apiType: 'together',
    apiKey: '',
    baseUrl: 'https://api.together.xyz/v1',
    enable: false,
    websites: {
      official: 'https://www.together.ai/',
      apiKey: 'https://api.together.ai/settings/api-keys',
      docs: 'https://docs.together.ai/docs/introduction',
      models: 'https://docs.together.ai/docs/chat-models',
      defaultBaseUrl: 'https://api.together.xyz/v1'
    }
  },
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
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    apiType: 'github-copilot',
    apiKey: '',
    baseUrl: 'https://api.githubcopilot.com',
    enable: false,
    websites: {
      official: 'https://github.com/features/copilot',
      apiKey: 'https://github.com/settings/tokens',
      docs: 'https://docs.github.com/en/copilot',
      models:
        'https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-chat-in-your-ide',
      defaultBaseUrl: 'https://api.githubcopilot.com'
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
    apiType: 'openai',
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
    id: 'zhipu',
    name: 'Zhipu',
    apiType: 'zhipu',
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    enable: false,
    websites: {
      official: 'https://open.bigmodel.cn/',
      apiKey: 'https://open.bigmodel.cn/usercenter/apikeys',
      docs: 'https://docs.bigmodel.cn',
      models: 'https://open.bigmodel.cn/modelcenter/square',
      defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/'
    }
  },
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
  {
    id: 'dashscope',
    name: 'DashScope',
    apiType: 'dashscope',
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    enable: false,
    websites: {
      official: 'https://www.aliyun.com/product/bailian',
      apiKey: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
      docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
      models: 'https://bailian.console.aliyun.com/model-market#/model-market',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
    }
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    apiType: 'lmstudio',
    apiKey: '',
    baseUrl: 'http://127.0.0.1:1234/v1',
    enable: false,
    websites: {
      official: 'https://lmstudio.ai/docs/app',
      apiKey: 'https://lmstudio.ai/docs/app',
      docs: 'https://lmstudio.ai/docs/app',
      models: 'https://lmstudio.ai/models',
      defaultBaseUrl: 'http://127.0.0.1:1234/v1'
    }
  },
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
    id: 'groq',
    name: 'Groq',
    apiType: 'groq',
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    enable: false,
    websites: {
      official: 'https://groq.com/',
      apiKey: 'https://console.groq.com/keys',
      docs: 'https://console.groq.com/docs/quickstart',
      models: 'https://console.groq.com/docs/models',
      defaultBaseUrl: 'https://api.groq.com/openai/v1'
    }
  },

  {
    id: 'grok',
    name: 'Grok',
    apiType: 'grok',
    apiKey: '',
    baseUrl: 'https://api.x.ai/v1',
    enable: false,
    websites: {
      official: 'https://x.ai/',
      apiKey: 'https://console.x.ai',
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs#getting-started',
      defaultBaseUrl: 'https://api.x.ai/v1'
    }
  },
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
  {
    id: 'aihubmix',
    name: 'AIHubMix',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://aihubmix.com/v1',
    enable: false,
    websites: {
      official: 'https://aihubmix.com',
      apiKey: 'https://aihubmix.com/token',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://docs.aihubmix.com/cn/api/Model-Information',
      defaultBaseUrl: 'https://aihubmix.com/v1'
    }
  },
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
  {
    id: 'hunyuan',
    name: 'Hunyuan',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    enable: false,
    websites: {
      official: 'https://cloud.tencent.com/product/hunyuan',
      apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
      docs: 'https://cloud.tencent.com/document/product/1729/111007',
      models: 'https://cloud.tencent.com/document/product/1729/104753',
      defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1'
    }
  },
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
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    apiType: 'openai',
    apiKey: '',
    baseUrl: 'https://api-inference.modelscope.cn/v1/',
    enable: false,
    websites: {
      official: 'https://modelscope.cn/',
      apiKey: 'https://modelscope.cn/my/myaccesstoken',
      docs: 'https://modelscope.cn/docs/modelscope_agent/api_service',
      models: 'https://modelscope.cn/models',
      defaultBaseUrl: 'https://api-inference.modelscope.cn/v1/'
    }
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    apiType: 'aws-bedrock',
    apiKey: '',
    baseUrl: '',
    enable: false,
    websites: {
      official: 'https://aws.amazon.com/bedrock/',
      apiKey: 'https://console.aws.amazon.com/iam/',
      docs: 'https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html',
      models: 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
      defaultBaseUrl: ''
    }
  }
]
